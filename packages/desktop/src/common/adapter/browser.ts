/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { bridge } from '@/common/platform/bridge';
import { WEBUI_DEFAULT_PORT } from '@/common/config/constants';
import type { ElectronBridgeAPI } from '@/common/types/platform/electron';

interface CustomWindow extends Window {
  electronAPI?: ElectronBridgeAPI;
  __bridgeEmitter?: { emit: (name: string, data: unknown) => void };
  __websocketReconnect?: () => void;
}

type BrowserWebSocketPayload = { name: string; data?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isBrowserWebSocketPayload(value: unknown): value is BrowserWebSocketPayload {
  return isRecord(value) && typeof value.name === 'string';
}

export function isRealtimeAuthTerminalError(payload: unknown): boolean {
  const data = getRealtimeErrorData(payload);
  if (!data) {
    return false;
  }

  const { code } = data;
  return code === 'REALTIME_AUTH_MISSING' || code === 'REALTIME_AUTH_EXPIRED';
}

function getRealtimeErrorData(payload: unknown): Record<string, unknown> | null {
  if (!isBrowserWebSocketPayload(payload) || payload.name !== 'realtime.error' || !isRecord(payload.data)) {
    return null;
  }

  return payload.data;
}

function isUnrecoverableRealtimeError(payload: unknown): boolean {
  return getRealtimeErrorData(payload)?.recoverable === false;
}

const win = window as CustomWindow;

/**
 * Adapts the Electron API for the browser, bridging renderer and main. Mirrors the injection in preload.ts.
 * */
if (win.electronAPI) {
  // Electron: talk over IPC.
  bridge.adapter({
    emit(name, data) {
      return win.electronAPI.emit(name, data);
    },
    on(emitter) {
      win.electronAPI?.on((event) => {
        try {
          const { value } = event;
          const { name, data } = JSON.parse(value);
          emitter.emit(name, data);
        } catch (e) {
          console.warn('JSON parsing error:', e);
        }
      });
    },
  });
} else {
  // Web: talk over WebSocket, reconnecting with the session cookie once logged in.
  // Web runtime bridge: ensure the socket reconnects after login so session cookie can be sent.
  // Path must be `/ws` — web-host's static-server only proxies WebSocket upgrades under /ws.
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const defaultHost = `${window.location.hostname}:${WEBUI_DEFAULT_PORT}`;
  const socketUrl = `${protocol}//${window.location.host || defaultHost}/ws`;

  type QueuedMessage = { name: string; data: unknown };

  let socket: WebSocket | null = null;
  let emitterRef: { emit: (name: string, data: unknown) => void } | null = null;
  let reconnectTimer: number | null = null;
  let reconnectDelay = 500;
  let shouldReconnect = true; // Flag to control reconnection

  const messageQueue: QueuedMessage[] = [];

  // 1. Flush the queued messages so nothing is lost across a reconnect.
  const flushQueue = () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    while (messageQueue.length > 0) {
      const queued = messageQueue.shift();
      if (queued) {
        socket.send(JSON.stringify(queued));
      }
    }
  };

  // 2. Exponential backoff, waiting for the server to accept connections after login.
  const scheduleReconnect = () => {
    if (reconnectTimer !== null || !shouldReconnect) {
      return;
    }

    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      reconnectDelay = Math.min(reconnectDelay * 2, 8000);
      connect();
    }, reconnectDelay);
  };

  // 3. Open the WebSocket, reusing an existing OPEN/CONNECTING socket.
  const connect = () => {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      socket = new WebSocket(socketUrl);
    } catch (error) {
      scheduleReconnect();
      return;
    }

    // Capture the socket created in this call so the close handler only
    // nulls the outer reference when it still points at THIS socket.
    // Without this guard, a late-firing close event from the OLD socket
    // could wipe the reference to a NEWLY created replacement socket.
    const currentSocket = socket;

    currentSocket.addEventListener('open', () => {
      reconnectDelay = 500;
      flushQueue();
    });

    currentSocket.addEventListener('message', (event: MessageEvent) => {
      if (!emitterRef) {
        return;
      }

      try {
        const payload = JSON.parse(event.data as string) as unknown;

        if (!isBrowserWebSocketPayload(payload)) {
          return;
        }

        // Answer the server heartbeat immediately, or the connection is dropped.
        // Handle server heartbeat ping - respond with pong immediately to keep connection alive
        if (payload.name === 'ping') {
          if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ name: 'pong', data: { timestamp: Date.now() } }));
          }
          return;
        }

        // Auth expired: stop reconnecting and go to the login page.
        // Handle auth expiration - stop reconnecting and redirect to login
        if (isRealtimeAuthTerminalError(payload)) {
          console.warn('[WebSocket] Authentication expired, stopping reconnection');
          shouldReconnect = false;

          // Cancel every pending reconnect timer.
          // Clear any pending reconnection timer
          if (reconnectTimer !== null) {
            window.clearTimeout(reconnectTimer);
            reconnectTimer = null;
          }

          // Close the socket and go to the login page.
          // Close the socket and redirect to login page
          socket?.close();

          // Already on the login page: redirecting again would loop forever.
          // Skip redirect if already on login page to prevent infinite reload loop
          if (window.location.pathname === '/login' || window.location.hash.includes('/login')) {
            return;
          }

          // Brief delay before navigating so the UI feedback is visible.
          // Redirect to login page after a short delay to show any UI feedback
          // Use hash navigation to stay within the SPA (HashRouter), avoiding a full
          // page reload that would land on an empty hash and cause a blank screen.
          setTimeout(() => {
            window.location.hash = '/login';
          }, 1000);

          return;
        }

        if (isUnrecoverableRealtimeError(payload)) {
          console.warn('[WebSocket] Unrecoverable realtime error, reconnecting');
          emitterRef.emit(payload.name, payload.data);
          currentSocket.close();
          return;
        }

        emitterRef.emit(payload.name, payload.data);
      } catch (error) {
        // Ignore malformed payloads
      }
    });

    currentSocket.addEventListener('close', (event: CloseEvent) => {
      // Only null the outer reference if it still points at this socket.
      if (socket === currentSocket) {
        socket = null;
      }

      scheduleReconnect();
    });

    currentSocket.addEventListener('error', () => {
      currentSocket.close();
    });
  };

  // 4. Make sure the connection is started before any send or subscribe.
  const ensureSocket = () => {
    if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
      connect();
    }
  };

  bridge.adapter({
    emit(name, data) {
      const message: QueuedMessage = { name, data };

      ensureSocket();

      if (socket && socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(JSON.stringify(message));
          return;
        } catch (error) {
          scheduleReconnect();
        }
      }

      messageQueue.push(message);
    },
    on(emitter) {
      emitterRef = emitter;
      win.__bridgeEmitter = emitter;

      ensureSocket();
    },
  });

  connect();

  // Expose reconnection control for login flow
  win.__websocketReconnect = () => {
    shouldReconnect = true;
    reconnectDelay = 500;
    connect();
  };
}
