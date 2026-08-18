/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * End-to-end round-trip for the Slack bridge against a simulated Slack and a
 * simulated aioncore backend: Slack DM in → conversation created → message
 * sent → turn.completed reply → chat.postMessage back to Slack.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';

const tempDirs: string[] = [];
vi.mock('@process/utils/utils', () => ({
  getConfigPath: () => {
    const dir = mkdtempSync(join(tmpdir(), 'slack-bridge-int-'));
    tempDirs.push(dir);
    return dir;
  },
}));

import { startSlackBridge, stopSlackBridge, getSlackBridgeState } from '@process/services/channels/slackBridge';
import { closeBridgeWs } from '@process/services/channels/backendConversationClient';

type JsonRecord = Record<string, unknown>;

const listen = (server: http.Server): Promise<number> =>
  new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as { port: number }).port);
    });
  });

const readBody = (req: http.IncomingMessage): Promise<JsonRecord> =>
  new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += String(chunk)));
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}') as JsonRecord);
      } catch {
        resolve({});
      }
    });
  });

describe('slack bridge round-trip (simulated Slack + backend)', () => {
  let slackServer: http.Server;
  let slackSocketServer: http.Server;
  let slackWss: WebSocketServer;
  let backendServer: http.Server;
  let backendWss: WebSocketServer;
  let savedBackendPort: unknown;
  let savedSlackBase: string | undefined;

  afterEach(async () => {
    await stopSlackBridge(false).catch(() => {});
    closeBridgeWs();
    slackWss?.close();
    backendWss?.close();
    slackServer?.close();
    slackSocketServer?.close();
    backendServer?.close();
    (globalThis as JsonRecord).__backendPort = savedBackendPort;
    if (savedSlackBase === undefined) delete process.env.PAVII_SLACK_API_BASE;
    else process.env.PAVII_SLACK_API_BASE = savedSlackBase;
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    savedBackendPort = (globalThis as JsonRecord).__backendPort;
    savedSlackBase = process.env.PAVII_SLACK_API_BASE;
  });

  it('answers a Slack DM with the assistant reply', async () => {
    const postedMessages: JsonRecord[] = [];
    const backendRequests: string[] = [];
    let socketModeUrl = '';

    // --- Simulated Slack Web API ---
    slackServer = http.createServer((req, res) => {
      void readBody(req).then((body) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/auth.test') {
          res.end(JSON.stringify({ ok: true, user_id: 'UBOT', user: 'pavii', team: 'TestTeam' }));
        } else if (req.url === '/apps.connections.open') {
          res.end(JSON.stringify({ ok: true, url: socketModeUrl }));
        } else if (req.url === '/chat.postMessage') {
          postedMessages.push(body);
          res.end(JSON.stringify({ ok: true, ts: '1.1' }));
        } else {
          res.end(JSON.stringify({ ok: false, error: 'unknown_method' }));
        }
      });
    });
    const slackApiPort = await listen(slackServer);
    process.env.PAVII_SLACK_API_BASE = `http://127.0.0.1:${slackApiPort}`;

    // --- Simulated Socket Mode endpoint ---
    slackSocketServer = http.createServer();
    slackWss = new WebSocketServer({ server: slackSocketServer });
    const slackSocketPort = await listen(slackSocketServer);
    socketModeUrl = `ws://127.0.0.1:${slackSocketPort}/`;

    const acks: JsonRecord[] = [];
    slackWss.on('connection', (socket) => {
      socket.on('message', (raw) => acks.push(JSON.parse(String(raw)) as JsonRecord));
      // Deliver a DM event shortly after connect.
      setTimeout(() => {
        socket.send(
          JSON.stringify({
            envelope_id: 'env-1',
            type: 'events_api',
            payload: {
              event: { type: 'message', channel: 'D123', channel_type: 'im', user: 'U1', text: 'hello agent' },
            },
          })
        );
      }, 50);
    });

    // --- Simulated aioncore backend (HTTP + /ws) ---
    backendServer = http.createServer((req, res) => {
      void readBody(req).then(() => {
        backendRequests.push(`${req.method} ${req.url}`);
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/api/assistants') {
          res.end(
            JSON.stringify({ success: true, data: [{ id: 'assistant-1', enabled: true, agent_status: 'online' }] })
          );
        } else if (req.url === '/api/conversations' && req.method === 'POST') {
          res.end(JSON.stringify({ success: true, data: { id: 'conv-1' } }));
        } else if (req.url?.endsWith('/runtime/ensure')) {
          res.end(JSON.stringify({ success: true, data: {} }));
        } else if (req.url === '/api/conversations/conv-1/messages' && req.method === 'POST') {
          res.end(JSON.stringify({ success: true, data: { msg_id: 'm1', turn_id: 't1' } }));
          // Emit the assistant's reply over the backend WS after the send.
          setTimeout(() => {
            for (const client of backendWss.clients) {
              client.send(
                JSON.stringify({
                  name: 'turn.completed',
                  data: { session_id: 'conv-1', turn_id: 't1', last_message: { content: 'Hi! I created your PR.' } },
                })
              );
            }
          }, 50);
        } else {
          res.end(JSON.stringify({ success: true, data: {} }));
        }
      });
    });
    backendWss = new WebSocketServer({ server: backendServer, path: '/ws' });
    const backendPort = await listen(backendServer);
    (globalThis as JsonRecord).__backendPort = backendPort;

    // --- Run the real bridge ---
    const state = await startSlackBridge({ botToken: 'xoxb-test', appToken: 'xapp-test' });
    expect(state.botUser).toBe('pavii');
    expect(state.team).toBe('TestTeam');

    // The reply should land back in Slack.
    await vi.waitFor(
      () => {
        expect(postedMessages.length).toBeGreaterThan(0);
      },
      { timeout: 10_000, interval: 50 }
    );

    expect(postedMessages[0].channel).toBe('D123');
    expect(postedMessages[0].text).toBe('Hi! I created your PR.');
    // The envelope must have been acked so Slack does not redeliver.
    expect(acks.some((ack) => ack.envelope_id === 'env-1')).toBe(true);
    // The bridge drove the real conversation APIs.
    expect(backendRequests).toContain('POST /api/conversations');
    expect(backendRequests).toContain('POST /api/conversations/conv-1/messages');
    expect(getSlackBridgeState().handledMessages).toBe(1);
  });
});
