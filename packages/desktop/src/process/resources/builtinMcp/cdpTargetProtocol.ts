/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure protocol logic of the single-target CDP relay (no Electron/socket deps, for unit testing).
 *
 * Why this layer exists: Chromium's remote-debugging-port is application-wide with no
 * per-target ACL - opening it exposes the main window (preload bridge attached) to any local process.
 * We expose only the side browser's webContents instead, but chrome-devtools-mcp connects via
 * puppeteer's browserURL flow, which treats its peer as a whole browser: it opens with
 * Target.setDiscoverTargets / setAutoAttach, then gets a sessionId via Target.attachToTarget.
 * Electron's webContents.debugger serves a single page and cannot answer those commands.
 *
 * So this impersonates a one-tab browser: Target.* is answered locally, everything else passes
 * through to the debugger. Electron's debugger supports sessionId on both directions
 * (electron.d.ts sendCommand(method, params, sessionId) and the 'message' event's sessionId),
 * so the flatten mode puppeteer wants lines up.
 *
 * Pure protocol logic for the single-target CDP bridge (no Electron or socket
 * dependency, so it can be unit-tested).
 *
 * Why this layer exists: Chromium's remote-debugging-port is application-wide with no
 * per-target ACL, so opening it exposes the main window — and its preload bridge — to
 * any local process. We narrow it to just the browser webview, but chrome-devtools-mcp
 * connects via puppeteer's browserURL, which treats the endpoint as a whole browser: it
 * sends Target.setDiscoverTargets / setAutoAttach up front and obtains a sessionId via
 * Target.attachToTarget. Electron's webContents.debugger serves a single page and cannot
 * answer those.
 *
 * So we present ourselves as a browser that happens to have exactly one tab: Target.*
 * is answered locally, everything else is forwarded to the debugger. Electron's debugger
 * supports sessionId in both directions, so puppeteer's flatten mode lines up.
 */

/** Fixed ids — there is only ever one target. */
// Internal CDP wire ids exchanged between our bridge and chrome-devtools-mcp
// within a single session. Never surfaced to users, so they keep their original
// spelling rather than risk churn in the debugger protocol handshake.
export const SINGLE_TARGET_ID = 'aionui-browser-target';
export const SINGLE_SESSION_ID = 'aionui-browser-session';
export const SINGLE_BROWSER_CONTEXT_ID = 'aionui-browser-context';

export type TargetInfo = {
  targetId: string;
  type: 'page';
  title: string;
  url: string;
  attached: boolean;
  canAccessOpener: boolean;
  browserContextId: string;
};

export type CdpRequest = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  sessionId?: string;
};

/** Answer locally / pass through to the debugger / refuse explicitly. */
export type CdpDecision =
  | { kind: 'reply'; payload: Record<string, unknown> }
  | {
      kind: 'reply-and-emit';
      payload: Record<string, unknown>;
      emit: Array<{ method: string; params: Record<string, unknown> }>;
    }
  | { kind: 'forward' }
  | { kind: 'error'; message: string };

export const buildTargetInfo = (title: string, url: string): TargetInfo => ({
  targetId: SINGLE_TARGET_ID,
  type: 'page',
  title,
  url,
  attached: true,
  canAccessOpener: false,
  browserContextId: SINGLE_BROWSER_CONTEXT_ID,
});

/**
 * The /json/version response. puppeteer's getWSEndpoint() reads only webSocketDebuggerUrl,
 * but Browser.version() uses the Browser field - provide both to avoid later errors.
 *
 * puppeteer's getWSEndpoint() only reads webSocketDebuggerUrl, but Browser.version()
 * surfaces the Browser field, so provide both.
 */
export const buildVersionPayload = (wsUrl: string, chromeVersion: string) => ({
  Browser: `Chrome/${chromeVersion}`,
  'Protocol-Version': '1.3',
  'User-Agent': `Pavii.Ai in-app browser (Chrome/${chromeVersion})`,
  'V8-Version': process.versions.v8 ?? '',
  'WebKit-Version': '',
  webSocketDebuggerUrl: wsUrl,
});

/** The /json/list response. Always exactly one page. */
export const buildListPayload = (wsUrl: string, title: string, url: string) => [
  {
    description: '',
    devtoolsFrontendUrl: '',
    id: SINGLE_TARGET_ID,
    title,
    type: 'page',
    url,
    webSocketDebuggerUrl: wsUrl,
  },
];

/**
 * Decide how an inbound command is handled.
 *
 * Key trade: Target.createTarget errors explicitly rather than being ignored. Its meaning is
 * "open a new tab", which we cannot do - but faking success by returning the one targetId would
 * leave the agent believing it opened a new page while still driving the old one, a failure mode
 * far harder to trace than an outright error. Give it a clear one.
 *
 * Deliberate choice: Target.createTarget errors out rather than silently no-oping.
 * It means "open a new tab", which we cannot do; pretending it succeeded and handing
 * back the one existing targetId would leave the agent believing it had a fresh page
 * while it kept driving the old one — a failure far harder to diagnose than an explicit
 * error.
 */
export const decideCdpCommand = (req: CdpRequest, getTargetInfo: () => TargetInfo): CdpDecision => {
  const method = req.method ?? '';

  switch (method) {
    /**
     * With discover:true, Chromium immediately backfills targetCreated for existing targets.
     * puppeteer builds its Target objects from that event and waits in initialize() without it.
     *
     * With discover:true Chromium backfills targetCreated for existing targets.
     * puppeteer builds its Target objects from that event and would otherwise hang
     * inside initialize().
     */
    case 'Target.setDiscoverTargets': {
      const discover = req.params?.discover === true;
      if (!discover) return { kind: 'reply', payload: {} };
      return {
        kind: 'reply-and-emit',
        payload: {},
        emit: [{ method: 'Target.targetCreated', params: { targetInfo: getTargetInfo() } }],
      };
    }

    case 'Target.setAutoAttach': {
      /**
       * Only the browser-level setAutoAttach backfills attachedToTarget.
       *
       * The infinite loop hit in practice: on attachedToTarget, puppeteer sends setAutoAttach again
       * for the new session (recursively attaching children); backfilling on every one gives
       * setAutoAttach -> attachedToTarget -> setAutoAttach ... forever,
       * and the connection never finishes initializing. The sessionId-carrying call means "asking the
       * page session about children" - we expose no iframes/workers, so answer empty.
       *
       * Only the browser-level setAutoAttach backfills attachedToTarget. Testing hit an
       * infinite loop: on receiving attachedToTarget puppeteer issues another setAutoAttach
       * on the new session (to recurse into sub-targets), so backfilling on every call
       * produced setAutoAttach → attachedToTarget → setAutoAttach … forever and the
       * connection never finished initialising. The call carrying a sessionId means "list
       * sub-targets within the page session"; we expose none, so an empty ack is correct.
       */
      const isBrowserLevel = req.sessionId === undefined || req.sessionId === '';
      if (!isBrowserLevel) return { kind: 'reply', payload: {} };

      /**
       * attachedToTarget must be backfilled proactively or puppeteer never recognizes the page.
       *
       * puppeteer's TargetManager.getAvailableTargets() returns
       * #attachedTargetsByTargetId - only attached targets count, and "attached" is established
       * solely by the attachedToTarget event. targetCreated only reaches the discovered list,
       * so sending targetCreated alone leaves browser.pages() at 0.
       *
       * The filter's {type:'page', exclude:true} reads like "don't auto-attach pages", but that
       * governs pages opened later at runtime; for pages already existing at connect time, real
       * Chrome backfills attachedToTarget during setAutoAttach. Our resident page is the latter.
       *
       * We must proactively emit attachedToTarget or puppeteer never recognises the page:
       * getAvailableTargets() returns #attachedTargetsByTargetId, and only the
       * attachedToTarget event establishes attachment. targetCreated merely populates the
       * discovered list, so emitting it alone leaves browser.pages() at 0.
       *
       * The {type:'page', exclude:true} filter looks like "do not auto-attach pages", but
       * that governs pages opened later; for pages already present at connect time real
       * Chrome backfills attachedToTarget during setAutoAttach. Our persistent page is that
       * case.
       */
      return {
        kind: 'reply-and-emit',
        payload: {},
        emit: [
          {
            method: 'Target.attachedToTarget',
            params: { sessionId: SINGLE_SESSION_ID, targetInfo: getTargetInfo(), waitingForDebugger: false },
          },
        ],
      };
    }

    case 'Target.getTargets':
      return { kind: 'reply', payload: { targetInfos: [getTargetInfo()] } };

    case 'Target.getTargetInfo':
      return { kind: 'reply', payload: { targetInfo: getTargetInfo() } };

    case 'Target.getBrowserContexts':
      return { kind: 'reply', payload: { browserContextIds: [SINGLE_BROWSER_CONTEXT_ID] } };

    /**
     * Only our single target may be attached; any other id errors rather than forwarding to a session that does not exist.
     * The attachedToTarget event carries the sessionId that flatten-mode puppeteer routes subsequent commands by.
     *
     * Only our single target may be attached; any other id errors out instead of being
     * routed to a session that does not exist. The attachedToTarget event carries the
     * sessionId that puppeteer uses to route later commands in flatten mode.
     */
    case 'Target.attachToTarget': {
      const requested = req.params?.targetId;
      if (typeof requested === 'string' && requested !== SINGLE_TARGET_ID) {
        return { kind: 'error', message: `No such target id: ${requested}` };
      }
      return {
        kind: 'reply-and-emit',
        payload: { sessionId: SINGLE_SESSION_ID },
        emit: [
          {
            method: 'Target.attachedToTarget',
            params: { sessionId: SINGLE_SESSION_ID, targetInfo: getTargetInfo(), waitingForDebugger: false },
          },
        ],
      };
    }

    case 'Target.detachFromTarget':
    case 'Target.closeTarget':
      // Closing the in-app browser is not the agent's call; acknowledge and do nothing.
      return { kind: 'reply', payload: {} };

    case 'Target.createTarget':
      return {
        kind: 'error',
        message: 'Pavii.Ai in-app browser exposes a single fixed tab; Target.createTarget is not supported.',
      };

    case 'Target.createBrowserContext':
    case 'Target.disposeBrowserContext':
      return { kind: 'error', message: 'Pavii.Ai in-app browser does not support multiple browser contexts.' };

    /**
     * Browser.close would terminate the whole app; never let the agent reach it.
     */
    case 'Browser.close':
      return { kind: 'error', message: 'Browser.close is not permitted against the Pavii.Ai in-app browser.' };

    default:
      return { kind: 'forward' };
  }
};

/**
 * Decide whether an inbound sessionId is acceptable.
 *
 * Empty sessionId = browser-level command; our fixed session = page-level. Everything else is
 * refused rather than treated as browser-level - waving it through makes a misrouted command look successful.
 *
 * An empty sessionId means a browser-level command; our fixed session means page level.
 * Anything else is rejected rather than quietly treated as browser-level, since letting
 * it through would make a misrouted command look like it succeeded.
 */
export const isAcceptableSessionId = (sessionId: string | undefined): boolean =>
  sessionId === undefined || sessionId === '' || sessionId === SINGLE_SESSION_ID;

/** Constant-time compare so token prefixes do not leak. */
export const tokensMatch = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
};
