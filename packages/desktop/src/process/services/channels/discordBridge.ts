/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import WebSocket from 'ws';
import {
  awaitTurnCompleted,
  createBridgeConversation,
  pickBridgeAssistant,
  sendBridgeMessage,
} from './backendConversationClient';
import { readChannelStore, writeChannelStore } from './channelStore';

/**
 * Discord channel bridge (Gateway).
 *
 * Mirrors the Slack bridge: the desktop app connects to Discord's Gateway
 * with a bot token (no public URL needed), answers DMs and @mentions by
 * routing them into ordinary Pavii conversations, and replies via the REST
 * API. Requires the bot's "Message Content Intent" to be enabled.
 */

export type DiscordBridgeState = {
  running: boolean;
  botUser?: string;
  error?: string;
  handledMessages: number;
};

type GatewayPayload = {
  op: number;
  d?: unknown;
  s?: number | null;
  t?: string | null;
};

export type DiscordMessageEvent = {
  id?: string;
  channel_id?: string;
  guild_id?: string;
  content?: string;
  author?: { id?: string; bot?: boolean };
  mentions?: Array<{ id?: string }>;
};

// Overridable so integration tests can stand in for Discord.
const discordApiBase = (): string => process.env.PAVII_DISCORD_API_BASE || 'https://discord.com/api/v10';
const RECONNECT_DELAY_MS = 5000;
const DISCORD_MESSAGE_LIMIT = 2000;
// GUILDS + GUILD_MESSAGES + MESSAGE_CONTENT + DIRECT_MESSAGES
const GATEWAY_INTENTS = (1 << 0) | (1 << 9) | (1 << 15) | (1 << 12);

const state: DiscordBridgeState = { running: false, handledMessages: 0 };
let socket: WebSocket | null = null;
let botToken: string | null = null;
let botUserId: string | null = null;
let stopping = false;
let reconnectTimer: NodeJS.Timeout | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let lastSequence: number | null = null;
const conversationMap = new Map<string, string>();
const channelQueues = new Map<string, Promise<void>>();

async function discordApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${discordApiBase()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${botToken}`,
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text().catch((): string => '');
    throw new Error(`Discord ${path} failed (${response.status}): ${body.slice(0, 200)}`);
  }
  return (await response.json().catch((): null => null)) as T;
}

/** Split a reply into Discord-sized chunks (2000 chars). */
export function chunkDiscordMessage(text: string, limit: number = DISCORD_MESSAGE_LIMIT): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    // Prefer breaking on a newline inside the window.
    const window = rest.slice(0, limit);
    const cut = window.lastIndexOf('\n') > limit / 2 ? window.lastIndexOf('\n') : limit;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

/** Strip the bot's <@id> / <@!id> mention prefix from message content. */
export function stripDiscordMention(content: string, ownBotId: string | null): string {
  if (!ownBotId) return content.trim();
  return content.replaceAll(new RegExp(`<@!?${ownBotId}>`, 'g'), '').trim();
}

/** DMs from humans, and guild messages that @mention the bot. */
export function isActionableDiscordMessage(event: DiscordMessageEvent | undefined, ownBotId: string | null): boolean {
  if (!event?.channel_id || !event.author?.id) return false;
  if (event.author.bot) return false;
  if (ownBotId && event.author.id === ownBotId) return false;
  if (!event.guild_id) return true; // DM
  return Boolean(ownBotId && event.mentions?.some((mention) => mention.id === ownBotId));
}

async function conversationFor(discordChannel: string): Promise<string> {
  const existing = conversationMap.get(discordChannel);
  if (existing) return existing;
  const assistant = await pickBridgeAssistant();
  const conversationId = await createBridgeConversation(assistant.id, `Discord ${discordChannel}`);
  conversationMap.set(discordChannel, conversationId);
  const store = await readChannelStore();
  store.discord = { ...store.discord, conversations: Object.fromEntries(conversationMap) };
  await writeChannelStore(store);
  return conversationId;
}

async function handleInbound(channelId: string, text: string): Promise<void> {
  try {
    const conversationId = await conversationFor(channelId);
    const reply = awaitTurnCompleted(conversationId);
    await sendBridgeMessage(conversationId, text);
    const completion = await reply;
    const message = completion.replyText.trim() || '(no reply)';
    for (const chunk of chunkDiscordMessage(message)) {
      await discordApi(`/channels/${channelId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: chunk }),
      });
    }
    state.handledMessages += 1;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error('[DiscordBridge] message handling failed:', reason);
    await discordApi(`/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content: `Something went wrong handling that message: ${reason.slice(0, 500)}` }),
    }).catch(() => {});
  }
}

function enqueue(channelId: string, work: () => Promise<void>): void {
  const previous = channelQueues.get(channelId) ?? Promise.resolve();
  channelQueues.set(channelId, previous.then(work, work));
}

function clearHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function scheduleReconnect(delay: number = RECONNECT_DELAY_MS): void {
  if (stopping || reconnectTimer) return;
  state.running = false;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectGateway();
  }, delay);
  reconnectTimer.unref?.();
}

async function connectGateway(): Promise<void> {
  if (!botToken || stopping) return;
  try {
    const gateway = await discordApi<{ url?: string }>('/gateway/bot');
    if (!gateway.url) throw new Error('Gateway URL missing');
    const wsClient = new WebSocket(`${gateway.url}?v=10&encoding=json`);
    socket = wsClient;

    wsClient.on('message', (raw) => {
      let payload: GatewayPayload;
      try {
        payload = JSON.parse(String(raw)) as GatewayPayload;
      } catch {
        return;
      }
      if (typeof payload.s === 'number') lastSequence = payload.s;

      switch (payload.op) {
        case 10: {
          // HELLO: start heartbeats, then identify.
          const interval = (payload.d as { heartbeat_interval?: number })?.heartbeat_interval ?? 41250;
          clearHeartbeat();
          heartbeatTimer = setInterval(() => {
            wsClient.send(JSON.stringify({ op: 1, d: lastSequence }));
          }, interval);
          heartbeatTimer.unref?.();
          wsClient.send(
            JSON.stringify({
              op: 2,
              d: {
                token: botToken,
                intents: GATEWAY_INTENTS,
                properties: { os: process.platform, browser: 'pavii', device: 'pavii' },
              },
            })
          );
          break;
        }
        case 1:
          // Server requested an immediate heartbeat.
          wsClient.send(JSON.stringify({ op: 1, d: lastSequence }));
          break;
        case 7: // reconnect request
        case 9: // invalid session
          wsClient.close();
          break;
        case 0: {
          if (payload.t === 'READY') {
            const ready = payload.d as { user?: { id?: string; username?: string } };
            botUserId = ready.user?.id ?? null;
            state.botUser = ready.user?.username;
            state.running = true;
            state.error = undefined;
          } else if (payload.t === 'MESSAGE_CREATE') {
            const event = payload.d as DiscordMessageEvent;
            if (!isActionableDiscordMessage(event, botUserId)) return;
            const text = stripDiscordMention(event.content ?? '', botUserId);
            if (!text) return;
            const channelId = event.channel_id!;
            enqueue(channelId, () => handleInbound(channelId, text));
          }
          break;
        }
        default:
          break;
      }
    });

    const onDrop = () => {
      if (socket !== wsClient) return;
      socket = null;
      clearHeartbeat();
      scheduleReconnect();
    };
    wsClient.on('close', onDrop);
    wsClient.on('error', onDrop);
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    scheduleReconnect(RECONNECT_DELAY_MS * 3);
  }
}

/** Validate the token and open the Gateway connection. */
export async function startDiscordBridge(credentials: { botToken: string }): Promise<DiscordBridgeState> {
  await stopDiscordBridge(false);
  stopping = false;
  botToken = credentials.botToken;

  const me = await discordApi<{ id?: string; username?: string }>('/users/@me');
  botUserId = me.id ?? null;
  state.botUser = me.username;
  state.error = undefined;

  const store = await readChannelStore();
  conversationMap.clear();
  for (const [channelId, conversationId] of Object.entries(store.discord?.conversations ?? {})) {
    conversationMap.set(channelId, conversationId);
  }
  store.discord = { ...store.discord, credentials: { botToken: credentials.botToken }, enabled: true };
  await writeChannelStore(store);

  await connectGateway();
  return { ...state };
}

export async function stopDiscordBridge(persist = true): Promise<void> {
  stopping = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  clearHeartbeat();
  socket?.close();
  socket = null;
  state.running = false;
  if (persist && botToken) {
    const store = await readChannelStore();
    store.discord = { ...store.discord, enabled: false };
    await writeChannelStore(store);
  }
}

export function getDiscordBridgeState(): DiscordBridgeState {
  return { ...state };
}

/** Start on boot when previously enabled. */
export async function restoreDiscordBridge(): Promise<void> {
  const store = await readChannelStore();
  if (store.discord?.enabled && store.discord.credentials?.botToken) {
    await startDiscordBridge({ botToken: store.discord.credentials.botToken }).catch((error) => {
      state.error = error instanceof Error ? error.message : String(error);
    });
  }
}
