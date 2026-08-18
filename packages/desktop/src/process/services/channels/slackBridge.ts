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
 * Slack channel bridge (Socket Mode).
 *
 * The closed aioncore engine has no Slack support, so the desktop app hosts
 * the integration itself: an app-level token opens a Socket Mode WebSocket
 * (no public URL needed), incoming DMs/mentions are routed into ordinary
 * Pavii conversations over the local backend API, and the assistant's final
 * reply is posted back with chat.postMessage.
 */

export type SlackCredentials = {
  /** Bot token, `xoxb-...` — used for Web API calls (chat.postMessage). */
  botToken: string;
  /** App-level token, `xapp-...` with connections:write — opens Socket Mode. */
  appToken: string;
};

export type SlackBridgeState = {
  running: boolean;
  botUser?: string;
  team?: string;
  error?: string;
  handledMessages: number;
};

type SlackEnvelope = {
  type?: string;
  envelope_id?: string;
  payload?: {
    event?: {
      type?: string;
      subtype?: string;
      bot_id?: string;
      user?: string;
      channel?: string;
      channel_type?: string;
      text?: string;
      ts?: string;
      thread_ts?: string;
    };
  };
  reason?: string;
};

// Overridable so integration tests can stand in for Slack's API.
const slackApiBase = (): string => process.env.PAVII_SLACK_API_BASE || 'https://slack.com/api';
const RECONNECT_DELAY_MS = 5000;

const state: SlackBridgeState = { running: false, handledMessages: 0 };
let socket: WebSocket | null = null;
let credentials: SlackCredentials | null = null;
let botUserId: string | null = null;
let stopping = false;
let reconnectTimer: NodeJS.Timeout | null = null;
/** Slack channel id → Pavii conversation id (persisted). */
const conversationMap = new Map<string, string>();
/** Serialize turns per Slack channel so replies stay ordered. */
const channelQueues = new Map<string, Promise<void>>();

async function slackApi<T extends { ok: boolean; error?: string }>(
  method: string,
  token: string,
  body?: Record<string, unknown>
): Promise<T> {
  const response = await fetch(`${slackApiBase()}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await response.json()) as T;
  if (!data.ok) throw new Error(`Slack ${method} failed: ${data.error ?? 'unknown'}`);
  return data;
}

/** Strip the bot @mention Slack injects into app_mention text. */
export function stripSlackMention(text: string, botId: string | null): string {
  if (!botId) return text.trim();
  return text.replaceAll(`<@${botId}>`, '').trim();
}

/** True for events the bridge should answer: human DMs and @mentions. */
export function isActionableSlackEvent(
  event: NonNullable<NonNullable<SlackEnvelope['payload']>['event']> | undefined,
  ownBotUserId: string | null
): boolean {
  if (!event?.type || !event.channel || !event.user) return false;
  if (event.bot_id || event.subtype) return false;
  if (ownBotUserId && event.user === ownBotUserId) return false;
  if (event.type === 'app_mention') return true;
  return event.type === 'message' && event.channel_type === 'im';
}

async function conversationFor(slackChannel: string): Promise<string> {
  const existing = conversationMap.get(slackChannel);
  if (existing) return existing;
  const assistant = await pickBridgeAssistant();
  const conversationId = await createBridgeConversation(assistant.id, `Slack ${slackChannel}`);
  conversationMap.set(slackChannel, conversationId);
  await persistMap();
  return conversationId;
}

async function persistMap(): Promise<void> {
  const store = await readChannelStore();
  store.slack = {
    ...store.slack,
    conversations: Object.fromEntries(conversationMap),
  };
  await writeChannelStore(store);
}

async function handleInbound(channel: string, text: string, threadTs?: string): Promise<void> {
  if (!credentials) return;
  const token = credentials.botToken;
  try {
    const conversationId = await conversationFor(channel);
    const reply = awaitTurnCompleted(conversationId);
    await sendBridgeMessage(conversationId, text);
    const completion = await reply;
    const message = completion.replyText.trim() || '(no reply)';
    await slackApi('chat.postMessage', token, {
      channel,
      text: message.length > 39000 ? `${message.slice(0, 39000)}\n…(truncated)` : message,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    });
    state.handledMessages += 1;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error('[SlackBridge] message handling failed:', reason);
    await slackApi('chat.postMessage', token, {
      channel,
      text: `Something went wrong handling that message: ${reason}`,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    }).catch(() => {});
  }
}

function enqueue(channel: string, work: () => Promise<void>): void {
  const previous = channelQueues.get(channel) ?? Promise.resolve();
  const next = previous.then(work, work);
  channelQueues.set(channel, next);
}

function connectSocketMode(): void {
  if (!credentials || stopping) return;
  const { appToken } = credentials;
  void slackApi<{ ok: boolean; url?: string }>('apps.connections.open', appToken)
    .then((open) => {
      if (!open.url || stopping) throw new Error('Socket Mode URL missing');
      const wsClient = new WebSocket(open.url);
      socket = wsClient;
      wsClient.on('message', (raw) => {
        let envelope: SlackEnvelope;
        try {
          envelope = JSON.parse(String(raw)) as SlackEnvelope;
        } catch {
          return;
        }
        // Ack immediately: Slack retries un-acked envelopes aggressively.
        if (envelope.envelope_id) {
          wsClient.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
        }
        if (envelope.type === 'disconnect') {
          wsClient.close();
          return;
        }
        const event = envelope.payload?.event;
        if (!isActionableSlackEvent(event, botUserId)) return;
        const text = stripSlackMention(event!.text ?? '', botUserId);
        if (!text) return;
        const channel = event!.channel!;
        const threadTs = event!.thread_ts;
        enqueue(channel, () => handleInbound(channel, text, threadTs));
      });
      const scheduleReconnect = () => {
        if (socket !== wsClient) return;
        socket = null;
        if (stopping) return;
        state.running = false;
        if (reconnectTimer) return;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connectSocketMode();
        }, RECONNECT_DELAY_MS);
        reconnectTimer.unref?.();
      };
      wsClient.on('open', () => {
        state.running = true;
        state.error = undefined;
      });
      wsClient.on('close', scheduleReconnect);
      wsClient.on('error', scheduleReconnect);
    })
    .catch((error) => {
      state.running = false;
      state.error = error instanceof Error ? error.message : String(error);
      if (!stopping) {
        if (reconnectTimer) return;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connectSocketMode();
        }, RECONNECT_DELAY_MS * 3);
        reconnectTimer.unref?.();
      }
    });
}

/** Validate tokens and open the Socket Mode connection. */
export async function startSlackBridge(creds: SlackCredentials): Promise<SlackBridgeState> {
  await stopSlackBridge();
  stopping = false;
  credentials = creds;

  const auth = await slackApi<{ ok: boolean; user_id?: string; user?: string; team?: string }>(
    'auth.test',
    creds.botToken
  );
  botUserId = auth.user_id ?? null;
  state.botUser = auth.user;
  state.team = auth.team;
  state.error = undefined;

  const store = await readChannelStore();
  conversationMap.clear();
  for (const [slackChannel, conversationId] of Object.entries(store.slack?.conversations ?? {})) {
    conversationMap.set(slackChannel, conversationId);
  }
  store.slack = { ...store.slack, credentials: creds, enabled: true };
  await writeChannelStore(store);

  connectSocketMode();
  return { ...state };
}

export async function stopSlackBridge(persist = true): Promise<void> {
  stopping = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  socket?.close();
  socket = null;
  state.running = false;
  if (persist && credentials) {
    const store = await readChannelStore();
    store.slack = { ...store.slack, enabled: false };
    await writeChannelStore(store);
  }
}

export function getSlackBridgeState(): SlackBridgeState {
  return { ...state };
}

/** Start on boot when previously enabled. */
export async function restoreSlackBridge(): Promise<void> {
  const store = await readChannelStore();
  if (store.slack?.enabled && store.slack.credentials?.appToken) {
    await startSlackBridge({
      botToken: store.slack.credentials.botToken,
      appToken: store.slack.credentials.appToken,
    }).catch((error) => {
      state.error = error instanceof Error ? error.message : String(error);
      console.warn('[SlackBridge] restore failed:', state.error);
    });
  }
}
