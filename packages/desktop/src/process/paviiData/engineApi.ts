/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Engine HTTP helpers for `.pavii` data. Ordinary calls go through
 * `httpRequest`; calls whose body carries secrets (agent env values, MCP
 * env/headers) use {@link sensitiveRequest}, which never logs the body.
 */

import { BackendHttpError, getBaseUrl, httpRequest, isBackendHttpError } from '@/common/adapter/httpBridge';

export const engine = {
  get: <T>(path: string): Promise<T> => httpRequest<T>('GET', path),
  post: <T>(path: string, body?: unknown): Promise<T> => httpRequest<T>('POST', path, body),
  put: <T>(path: string, body?: unknown): Promise<T> => httpRequest<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown): Promise<T> => httpRequest<T>('PATCH', path, body),
  delete: <T>(path: string): Promise<T> => httpRequest<T>('DELETE', path),
};

/** Same contract as `httpRequest`, but the request and error bodies are never logged. */
export async function sensitiveRequest<T>(method: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${getBaseUrl()}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    let parsed: unknown = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // keep raw text
    }
    throw new BackendHttpError({ method, path, status: response.status, body: parsed });
  }
  if (!response.headers.get('Content-Type')?.includes('application/json')) return undefined as T;
  const json = (await response.json()) as unknown;
  if (json && typeof json === 'object' && 'data' in json) return (json as { data: T }).data;
  return json as T;
}

/** Short, secret-free description of an engine failure for logs and results. */
export function describeError(error: unknown): string {
  if (isBackendHttpError(error)) {
    return `${error.status}${error.code ? ` ${error.code}` : ''}${error.backendMessage ? `: ${error.backendMessage}` : ''}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** True when `value` is a non-null, non-array object. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `value` when it is an array, else `[]` (engine list routes may return null). */
export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
