/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Single-target CDP channel: only the side browser's one webContents is exposed to the agent.
 *
 * Replaces Chromium's remote-debugging-port. That switch is application-wide with no
 * per-target ACL - one flip exposes the main window (preload bridge attached) to any local process. Instead:
 *   - bind 127.0.0.1 only, and require the token to connect
 *   - serve exactly one target; Target.* is answered locally by cdpTargetProtocol
 *   - everything else passes through to webContents.debugger
 *
 * Single-target CDP bridge: exposes only the in-app browser's webContents to the agent.
 * Replaces Chromium's remote-debugging-port, which is application-wide with no
 * per-target ACL and therefore also exposes the main window and its preload bridge.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { webContents, type Debugger, type WebContents } from 'electron';
import {
  SINGLE_SESSION_ID,
  buildListPayload,
  buildTargetInfo,
  buildVersionPayload,
  decideCdpCommand,
  isAcceptableSessionId,
  tokensMatch,
  type CdpRequest,
} from './cdpTargetProtocol';

const HOST = '127.0.0.1';
const WS_PATH = '/aionui-cdp';

export type CdpBridgeHandle = {
  port: number;
  token: string;
  /** null while nothing is attached. */
  attachedWebContentsId: () => number | null;
  attach: (webContentsId: number) => { ok: true } | { ok: false; reason: string };
  detach: () => void;
  close: () => Promise<void>;
};

type AttachedState = {
  contents: WebContents;
  dbg: Debugger;
  onMessage: (event: unknown, method: string, params: unknown, sessionId: string) => void;
  onDestroyed: () => void;
};

let attached: AttachedState | null = null;
let sockets = new Set<WebSocket>();

const currentTargetInfo = () => {
  if (!attached || attached.contents.isDestroyed()) return buildTargetInfo('', 'about:blank');
  return buildTargetInfo(attached.contents.getTitle(), attached.contents.getURL());
};

const broadcast = (payload: Record<string, unknown>) => {
  const text = JSON.stringify(payload);
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) ws.send(text);
  }
};

const detachInternal = () => {
  if (!attached) return;
  const { contents, dbg, onMessage, onDestroyed } = attached;
  attached = null;
  try {
    dbg.removeListener('message', onMessage);
    contents.removeListener('destroyed', onDestroyed);
    if (dbg.isAttached()) dbg.detach();
  } catch {
    // Electron throws if it is already destroyed or detached; nothing to do.
  }
};

/**
 * Attach to the given webContents.
 *
 * Both checks must error rather than "do their best":
 *  - getType() must be webview: it stops the main window (with its preload bridge) being handed over - the original design's hole.
 *  - debugger.attach() conflicts with DevTools open on the same webContents (an Electron
 *    limitation); give a readable reason instead of a raw exception.
 *
 * Both checks must fail loudly rather than degrade:
 *  - getType() must be 'webview', so the main window (with its preload bridge) can never
 *    be handed over — that is precisely the hole in the process-wide approach.
 *  - debugger.attach() conflicts with DevTools open on the same webContents (an Electron
 *    limitation); surface a readable reason instead of a raw throw.
 */
const attachInternal = (webContentsId: number): { ok: true } | { ok: false; reason: string } => {
  const contents = webContents.fromId(webContentsId);
  if (!contents || contents.isDestroyed()) {
    return { ok: false, reason: `No live webContents with id ${webContentsId}` };
  }

  const type = contents.getType();
  if (type !== 'webview') {
    return {
      ok: false,
      reason: `Refusing to attach to webContents of type "${type}"; only the in-app browser webview may be exposed.`,
    };
  }

  if (attached?.contents.id === webContentsId) return { ok: true };
  detachInternal();

  const dbg = contents.debugger;
  try {
    if (!dbg.isAttached()) dbg.attach('1.3');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `Could not attach debugger (DevTools open on this view will block it): ${message}` };
  }

  const onMessage = (_event: unknown, method: string, params: unknown, _sessionId: string) => {
    /**
     * Stamp our fixed sessionId onto everything before forwarding.
     *
     * puppeteer uses flatten mode and routes events to page sessions by sessionId; unstamped
     * events are treated as browser-level and the Page/Runtime events are lost.
     *
     * Stamp our fixed sessionId before forwarding. puppeteer runs in flatten mode and
     * routes events to the page session by sessionId; without it these would look
     * browser-level and Page/Runtime events would be dropped.
     */
    broadcast({ method, params: params ?? {}, sessionId: SINGLE_SESSION_ID });
  };

  const onDestroyed = () => {
    detachInternal();
    broadcast({ method: 'Target.targetDestroyed', params: { targetId: currentTargetInfo().targetId } });
  };

  dbg.on('message', onMessage);
  contents.once('destroyed', onDestroyed);
  attached = { contents, dbg, onMessage, onDestroyed };
  return { ok: true };
};

/**
 * Replies must carry the inbound sessionId or page-level commands hang forever.
 *
 * puppeteer dispatches replies by sessionId (cdp/Connection.js): with one, the reply goes to
 * that CdpSession's CallbackRegistry; without one, to Connection's own. Page-level commands
 * are sent with session.send(), whose callbacks live only in the session's registry - a reply
 * that drops the sessionId lands in Connection's registry, where the id is unknown,
 * CallbackRegistry.resolve/reject silently return, and the Promise never settles.
 *
 * A command that should have failed instantly becomes a hang, surfacing later as puppeteer's
 * "XXX timed out. Increase the 'protocolTimeout' setting" - a false lead pointing at timeout
 * settings while the real cause (say, the browser panel not being open) is swallowed whole.
 *
 * Replies must echo the inbound sessionId or page-level commands hang forever.
 * puppeteer routes replies by sessionId: with one it goes to that CdpSession's
 * CallbackRegistry, without one to the Connection's own. Page-level commands are sent via
 * session.send(), so the callback lives only in the session registry; a reply missing the
 * sessionId lands in the Connection registry, which has no such id, and
 * CallbackRegistry.resolve/reject silently returns — the promise never settles.
 *
 * An immediate error therefore turns into a hang that surfaces as puppeteer's
 * "... timed out. Increase the 'protocolTimeout' setting", a misleading clue that buries the
 * real cause (e.g. the browser panel was never opened).
 */
const sendError = (ws: WebSocket, id: number | undefined, message: string, sessionId?: string) => {
  ws.send(JSON.stringify({ id: id ?? 0, error: { code: -32601, message }, sessionId }));
};

/**
 * announcedSessions is **per-connection** state and must not move to module scope: a fresh
 * connection's puppeteer holds no session objects and must receive attachedToTarget anew;
 * shared across connections, the second client never gets that event and browser.pages() stays 0.
 *
 * announcedSessions is PER-CONNECTION state and must not be hoisted to module scope: a freshly
 * connected puppeteer holds no session objects and needs attachedToTarget to build them. Sharing
 * the set across connections would starve the second client of that event, leaving
 * browser.pages() at 0 forever.
 */
const handleSocketMessage = async (ws: WebSocket, raw: string, announcedSessions: Set<string>) => {
  let req: CdpRequest;
  try {
    req = JSON.parse(raw) as CdpRequest;
  } catch {
    return; // ignore non-JSON frames
  }

  const { id, method, params, sessionId } = req;
  if (!method) return;

  if (!isAcceptableSessionId(sessionId)) {
    sendError(ws, id, `Unknown sessionId: ${sessionId}`, sessionId);
    return;
  }

  const decision = decideCdpCommand(req, currentTargetInfo);

  if (decision.kind === 'error') {
    sendError(ws, id, decision.message, sessionId);
    return;
  }

  if (decision.kind === 'reply' || decision.kind === 'reply-and-emit') {
    ws.send(JSON.stringify({ id, result: decision.payload, sessionId }));
    if (decision.kind === 'reply-and-emit') {
      for (const evt of decision.emit) {
        /**
         * Announce attachedToTarget once per sessionId - announcing again makes puppeteer swap the
         * session object and orphan the caller's handle.
         *
         * constructing a new CdpSession (see puppeteer's cdp/Connection.js).
         * It never checks whether the sessionId already exists, so a second announcement overwrites
         * the old object with a brand-new one carrying an empty CallbackRegistry.
         *
         * That is the lethal part: setAutoAttach announced once, attachToTarget announces again, and
         * the handle held by the caller (TargetManager / anything holding a CDPSession) now points at
         * the replaced object. Its send()s register ids in the old registry while replies route by
         * sessionId to the new object's registry - unknown id, resolve/reject silently return,
         * the Promise never settles, and it all surfaces as protocolTimeout.
         *
         * Real Chrome never re-announces an attached session, so this problem is unique to this impersonation layer.
         *
         * Announce attachedToTarget at most once per sessionId: re-announcing makes puppeteer
         * swap out the session object and orphans handles the caller already holds.
         *
         * On attachedToTarget, puppeteer's Connection.onMessage unconditionally constructs a
         * new CdpCDPSession and does `#sessions.set(sessionId, session)` — it never checks
         * whether that sessionId already exists, so a second announcement replaces the old
         * object with a fresh one carrying an EMPTY CallbackRegistry.
         *
         * That is the fatal part: setAutoAttach already announced once, so announcing again on
         * attachToTarget leaves the caller holding the replaced object. Commands it sends
         * register their id in the old registry, while replies are routed by sessionId into the
         * new object's registry, which has no such id — resolve/reject silently returns and the
         * promise never settles, surfacing later as a protocolTimeout.
         *
         * Real Chrome does not re-announce an already-attached session, so this is specific to
         * this emulation layer.
         */
        if (evt.method === 'Target.attachedToTarget') {
          const announcedId = (evt.params as { sessionId?: string }).sessionId;
          if (typeof announcedId === 'string') {
            if (announcedSessions.has(announcedId)) continue;
            announcedSessions.add(announcedId);
          }
        }
        ws.send(JSON.stringify({ method: evt.method, params: evt.params }));
      }
    }
    return;
  }

  // forward
  if (!attached || attached.contents.isDestroyed()) {
    /**
     * Spell out "what to do", because the agent cannot fix this itself: attach is only triggered
     * by the renderer's webview dom-ready report (WebviewHost.tsx), and Target.createTarget is explicitly refused.
     * So this message must tell the user to open the browser panel, or the agent just keeps hitting the same wall.
     *
     * Say what to do about it: the agent cannot fix this itself. Attachment is only
     * triggered by the renderer reporting its webContents id on dom-ready
     * (WebviewHost.tsx), and Target.createTarget is explicitly refused — so this message
     * has to point at opening the browser panel, or the agent just retries into the same wall.
     */
    sendError(
      ws,
      id,
      'The in-app browser is not currently attached. Open the browser panel in Pavii.Ai so a page is available to control.',
      sessionId
    );
    return;
  }

  try {
    const result = await attached.dbg.sendCommand(method, params ?? {});
    ws.send(JSON.stringify({ id, result: result ?? {}, sessionId }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ws.send(JSON.stringify({ id, error: { code: -32000, message }, sessionId }));
  }
};

const writeJson = (res: ServerResponse, body: unknown) => {
  const text = JSON.stringify(body);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8', 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
};

/**
 * Start the channel. Returns a handle the main process uses to re-attach on browser tab switches.
 *
 * The token guards only the WebSocket leg, not HTTP discovery - a design forced by observation:
 * puppeteer takes browserURL and runs `new URL('/json/version', browserURL)`; the absolute
 * path drops the whole query, so a token in browserURL's ?token= never reaches the server and
 * only gets puppeteer walled off by its own 403.
 *
 * Hence two layers:
 *  - HTTP discovery (/json/version, /json/list) skips the token check and returns a tokened ws URL.
 *  - The WebSocket leg enforces the token; all actual control flows through it.
 *
 * The threat model, honestly: discovery is unauthenticated and hands out the token, so any
 * same-user process that finds the port can GET the token and connect. The token therefore
 * **blocks blind connections** (no port / never read discovery -> 403), and is **not identity proof** - it cannot show the peer is the MCP we spawned.
 * Against local processes, the only real barrier is the ephemeral port that listen(0) assigns.
 *
 * That matches Chrome's native remote-debugging-port /json/version - no regression. The real
 * win is elsewhere: only the side browser's webview is exposed, never the main window (see
 * attachInternal's getType() check). Treating same-user local processes as trusted is the explicit assumption.
 *
 * The token guards only the WebSocket leg, not HTTP discovery — a design forced by testing:
 * puppeteer runs `new URL('/json/version', browserURL)`, and an absolute path discards the
 * entire query string, so a token on browserURL never reaches the server and would only make
 * puppeteer trip over its own 403.
 *
 * Hence two tiers:
 *  - HTTP discovery (/json/version, /json/list) is unauthenticated and its response carries
 *    a tokened ws address.
 *  - The WebSocket enforces the token; all actual control flows there.
 *
 * ⚠️ Be honest about the threat model: because discovery is unauthenticated and hands the
 * token out, any process running as the same user can scan this port and retrieve the token
 * with one GET, then connect. The token therefore **prevents blind connections** (anything
 * that has not read discovery gets a 403); it is **not proof of identity** and cannot show
 * the peer is the MCP we spawned. Against local processes the only real barrier is the
 * ephemeral, OS-assigned listen(0) port.
 *
 * This matches Chrome's own remote-debugging-port /json/version and is not a regression. The
 * real gain of this design lies elsewhere: only the in-app browser webview is exposed and the
 * main window never is (see the getType() check in attachInternal). Treating same-user local
 * processes as inside the trust boundary is an explicit assumption here.
 */
export const startCdpBridge = async (): Promise<CdpBridgeHandle> => {
  const token = randomBytes(24).toString('hex');

  const httpServer: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${HOST}`);
    const wsUrl = `ws://${HOST}:${port}${WS_PATH}?token=${token}`;
    const info = currentTargetInfo();

    if (url.pathname === '/json/version') {
      writeJson(res, buildVersionPayload(wsUrl, process.versions.chrome ?? '0.0.0.0'));
      return;
    }
    if (url.pathname === '/json/list' || url.pathname === '/json') {
      writeJson(res, buildListPayload(wsUrl, info.title, info.url));
      return;
    }
    res.writeHead(404).end('not found');
  });

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${HOST}`);
    if (url.pathname !== WS_PATH || !tokensMatch(token, url.searchParams.get('token') ?? '')) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.add(ws);
      const announcedSessions = new Set<string>();
      ws.on('message', (data) => void handleSocketMessage(ws, data.toString(), announcedSessions));
      ws.on('close', () => sockets.delete(ws));
      ws.on('error', () => sockets.delete(ws));
    });
  });

  const port = await new Promise<number>((resolve, reject) => {
    httpServer.once('error', reject);
    // Port 0 lets the OS pick a free port so we cannot collide with another service.
    httpServer.listen(0, HOST, () => {
      const addr = httpServer.address();
      if (addr && typeof addr === 'object') resolve(addr.port);
      else reject(new Error('Could not determine bridge port'));
    });
  });

  return {
    port,
    token,
    attachedWebContentsId: () => (attached && !attached.contents.isDestroyed() ? attached.contents.id : null),
    attach: attachInternal,
    detach: detachInternal,
    close: async () => {
      detachInternal();
      for (const ws of sockets) ws.close();
      sockets = new Set();
      await new Promise<void>((resolve) => {
        wss.close(() => httpServer.close(() => resolve()));
      });
    },
  };
};
