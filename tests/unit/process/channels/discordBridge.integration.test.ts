/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * End-to-end round-trip for the Discord bridge against a simulated Discord
 * (REST + Gateway) and a simulated aioncore backend: DM in → conversation
 * created → turn.completed reply → REST message back to the channel.
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
    const dir = mkdtempSync(join(tmpdir(), 'discord-bridge-int-'));
    tempDirs.push(dir);
    return dir;
  },
}));

import { startDiscordBridge, stopDiscordBridge, getDiscordBridgeState } from '@process/services/channels/discordBridge';
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

describe('discord bridge round-trip (simulated Discord + backend)', () => {
  let restServer: http.Server;
  let gatewayServer: http.Server;
  let gatewayWss: WebSocketServer;
  let backendServer: http.Server;
  let backendWss: WebSocketServer;
  let savedBackendPort: unknown;
  let savedApiBase: string | undefined;

  beforeEach(() => {
    savedBackendPort = (globalThis as JsonRecord).__backendPort;
    savedApiBase = process.env.PAVII_DISCORD_API_BASE;
  });

  afterEach(async () => {
    await stopDiscordBridge(false).catch(() => {});
    closeBridgeWs();
    gatewayWss?.close();
    backendWss?.close();
    restServer?.close();
    gatewayServer?.close();
    backendServer?.close();
    (globalThis as JsonRecord).__backendPort = savedBackendPort;
    if (savedApiBase === undefined) delete process.env.PAVII_DISCORD_API_BASE;
    else process.env.PAVII_DISCORD_API_BASE = savedApiBase;
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('answers a Discord DM with the assistant reply', async () => {
    const postedMessages: Array<{ channel: string; body: JsonRecord }> = [];
    let identifyPayload: JsonRecord | null = null;
    let gatewayUrl = '';

    // --- Simulated Discord REST ---
    restServer = http.createServer((req, res) => {
      void readBody(req).then((body) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/users/@me') {
          res.end(JSON.stringify({ id: 'BOT', username: 'pavii' }));
        } else if (req.url === '/gateway/bot') {
          res.end(JSON.stringify({ url: gatewayUrl }));
        } else if (req.url?.startsWith('/channels/') && req.method === 'POST') {
          postedMessages.push({ channel: req.url.split('/')[2], body });
          res.end(JSON.stringify({ id: 'M1' }));
        } else {
          res.writeHead(404).end(JSON.stringify({ message: 'not found' }));
        }
      });
    });
    const restPort = await listen(restServer);
    process.env.PAVII_DISCORD_API_BASE = `http://127.0.0.1:${restPort}`;

    // --- Simulated Gateway ---
    gatewayServer = http.createServer();
    gatewayWss = new WebSocketServer({ server: gatewayServer });
    const gatewayPort = await listen(gatewayServer);
    gatewayUrl = `ws://127.0.0.1:${gatewayPort}/`;

    gatewayWss.on('connection', (socket) => {
      socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 30000 } }));
      socket.on('message', (raw) => {
        const payload = JSON.parse(String(raw)) as { op: number; d?: JsonRecord };
        if (payload.op === 2) {
          identifyPayload = payload.d ?? null;
          socket.send(JSON.stringify({ op: 0, t: 'READY', s: 1, d: { user: { id: 'BOT', username: 'pavii' } } }));
          setTimeout(() => {
            socket.send(
              JSON.stringify({
                op: 0,
                t: 'MESSAGE_CREATE',
                s: 2,
                d: { channel_id: 'C1', content: 'hello agent', author: { id: 'U1' } },
              })
            );
          }, 50);
        }
      });
    });

    // --- Simulated backend ---
    backendServer = http.createServer((req, res) => {
      void readBody(req).then(() => {
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
          setTimeout(() => {
            for (const client of backendWss.clients) {
              client.send(
                JSON.stringify({
                  name: 'turn.completed',
                  data: { session_id: 'conv-1', turn_id: 't1', last_message: { content: 'Hi from Pavii' } },
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
    const state = await startDiscordBridge({ botToken: 'test-token' });
    expect(state.botUser).toBe('pavii');

    await vi.waitFor(
      () => {
        expect(postedMessages.length).toBeGreaterThan(0);
      },
      { timeout: 10_000, interval: 50 }
    );

    expect(postedMessages[0].channel).toBe('C1');
    expect(postedMessages[0].body.content).toBe('Hi from Pavii');
    expect(identifyPayload).not.toBeNull();
    expect((identifyPayload as JsonRecord | null)?.token).toBe('test-token');
    expect(getDiscordBridgeState().handledMessages).toBe(1);
    expect(getDiscordBridgeState().running).toBe(true);
  });
});
