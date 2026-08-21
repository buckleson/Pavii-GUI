/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The single choke point every analytics event passes through before it leaves
 * the app — wired as posthog-js `before_send` and applied by hand in the main
 * process.
 *
 * This exists because the DOM of an AI chat app *is* the user's private data:
 * prompts, model replies, auto-generated conversation titles, workspace file
 * paths, provider API keys, agent environment variables, channel bot tokens.
 * Autocapture reads element text and attributes from the whole ancestor chain,
 * and PostHog derives `$current_url`/`$pathname` from `window.location`, which
 * in the packaged app is a `file://` install path containing the OS user name.
 *
 * Config alone cannot cover that, so this function is the guarantee and
 * `tests/unit/analytics/scrub.test.ts` is its proof. It fails **closed**: any
 * throw drops the event rather than letting an unscrubbed one through.
 */

import { ALLOWED_PROPERTY_KEYS, APP_URL_HOST, APP_URL_ORIGIN } from './config';
import { UNKNOWN_ROUTE, normaliseRoute, routeToAppUrl } from './routes';

/** Structural shape of a posthog-js `CaptureResult`; kept local so this module stays dependency-free. */
export type AnalyticsCaptureResult = {
  event: string;
  properties: Record<string, unknown>;
  $set?: Record<string, unknown>;
  $set_once?: Record<string, unknown>;
};

export const REDACTED = '<redacted>';

/** No legitimate analytics dimension is longer than this. */
const MAX_VALUE_LENGTH = 120;
const MAX_DEPTH = 4;

/**
 * Event classes dropped wholesale. Exceptions belong to Sentry, and the rest
 * carry selected text or timing detail that buys nothing here.
 */
const DROPPED_EVENTS: ReadonlySet<string> = new Set(['$copy_autocapture', '$dead_click', '$exception', '$web_vitals']);

/**
 * Keys deleted outright. `$el_text` and `$elements` are the autocapture text
 * carriers; the referrer and title keys carry the `file://` path on a desktop
 * build.
 */
const DENIED_KEYS: ReadonlySet<string> = new Set([
  '$el_text',
  '$elements',
  '$selected_content',
  '$copy_type',
  '$external_click_url',
  'attr__href',
  'title',
  '$referrer',
  '$referring_domain',
  '$initial_referrer',
  '$initial_referring_domain',
  '$search_engine',
  '$prev_pageview_pathname',
  '$raw_user_agent',
]);

/** URL-shaped keys rewritten to the synthetic origin, wherever they appear. */
const URL_KEYS: readonly string[] = ['$current_url', '$initial_current_url'];
const PATHNAME_KEYS: readonly string[] = ['$pathname', '$initial_pathname'];
const HOST_KEYS: readonly string[] = ['$host', '$initial_host'];

/**
 * Opaque identifiers PostHog generates for itself. They are high-entropy by
 * construction, so they are exempt from the entropy and length rules — but not
 * from the secret and path rules.
 */
const IDENTITY_KEYS: ReadonlySet<string> = new Set([
  'distinct_id',
  'token',
  'uuid',
  '$anon_distinct_id',
  '$device_id',
  '$insert_id',
  '$session_id',
  '$window_id',
]);

/** Provider API keys and bearer/JWT shapes. */
const SECRET_RE =
  /(sk-ant-[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{30,}|gsk_[A-Za-z0-9]{20,}|xox[abposr]-[A-Za-z0-9-]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{16,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.)/;

/** Absolute Windows/UNC/Unix paths and local URL schemes. */
const PATHY_RE =
  /([A-Za-z]:[\\/]|\\\\[^\\]+\\|\/(Users|home|Volumes|mnt|opt|private|tmp|var|Applications)\/|\b(file|blob|data):)/;

const EMAIL_RE = /[^\s@<>"']+@[^\s@<>"']+\.[A-Za-z]{2,}/;

/** A long run of opaque token characters with no spaces. */
const ENTROPY_RE = /^[A-Za-z0-9_\-+/=]{32,}$/;

type ScrubFlags = { secret: boolean; path: boolean };

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Scrub one string. Returns `REDACTED`, the original, or `undefined` to mean
 * "drop this key entirely".
 */
const scrubString = (key: string, value: string, flags: ScrubFlags): string | undefined => {
  if (SECRET_RE.test(value)) {
    flags.secret = true;
    return REDACTED;
  }
  if (PATHY_RE.test(value)) {
    flags.path = true;
    return REDACTED;
  }
  if (EMAIL_RE.test(value)) return REDACTED;

  // Structural rules apply only to our own dimensions; PostHog's `$` internals
  // and its opaque ids are sized and shaped by the SDK, not by us.
  if (key.startsWith('$') || IDENTITY_KEYS.has(key)) return value;

  if (value.includes('\n')) return undefined;
  if (value.length > MAX_VALUE_LENGTH) return undefined;
  if (ENTROPY_RE.test(value)) return REDACTED;
  return value;
};

const scrubValue = (key: string, value: unknown, flags: ScrubFlags, depth: number): unknown => {
  if (depth > MAX_DEPTH) return undefined;
  if (typeof value === 'string') return scrubString(key, value, flags);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(key, item, flags, depth + 1)).filter((item) => item !== undefined);
  }
  if (isPlainRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      const scrubbed = scrubValue(childKey, childValue, flags, depth + 1);
      if (scrubbed !== undefined) out[childKey] = scrubbed;
    }
    return out;
  }
  // Functions, symbols, undefined, class instances — nothing we ever send.
  return undefined;
};

/**
 * Apply the key allowlist and the value rules to one property bag.
 * `$`-prefixed keys bypass the allowlist (they are PostHog's own) but still get
 * their values scrubbed.
 */
const scrubBag = (bag: Record<string, unknown>, flags: ScrubFlags): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(bag)) {
    if (DENIED_KEYS.has(key)) continue;
    if (!key.startsWith('$') && !ALLOWED_PROPERTY_KEYS.has(key) && !IDENTITY_KEYS.has(key)) continue;
    const scrubbed = scrubValue(key, value, flags, 0);
    if (scrubbed !== undefined) out[key] = scrubbed;
  }
  return out;
};

/** Prefer the explicit `route` our own pageview sets; fall back to the real URL. */
const resolveRoute = (properties: Record<string, unknown>): string => {
  const explicit = properties.route;
  if (typeof explicit === 'string' && explicit.length > 0) return normaliseRoute(explicit);
  const currentUrl = properties.$current_url;
  if (typeof currentUrl === 'string' && currentUrl.length > 0) return normaliseRoute(currentUrl);
  return UNKNOWN_ROUTE;
};

/** Overwrite every URL-shaped key with the synthetic, path-free equivalent. */
const applyUrlIdentity = (bag: Record<string, unknown> | undefined, route: string): void => {
  if (!bag) return;
  const appUrl = routeToAppUrl(route, APP_URL_ORIGIN);
  for (const key of URL_KEYS) if (key in bag) bag[key] = appUrl;
  for (const key of PATHNAME_KEYS) if (key in bag) bag[key] = route;
  for (const key of HOST_KEYS) if (key in bag) bag[key] = APP_URL_HOST;
};

const scrubUnsafe = (result: AnalyticsCaptureResult): AnalyticsCaptureResult | null => {
  if (DROPPED_EVENTS.has(result.event)) return null;

  const flags: ScrubFlags = { secret: false, path: false };
  const route = resolveRoute(result.properties ?? {});

  const properties = scrubBag(result.properties ?? {}, flags);
  const set = result.$set ? scrubBag(result.$set, flags) : undefined;
  const setOnce = result.$set_once ? scrubBag(result.$set_once, flags) : undefined;

  // `$elements_chain` needs no special case: once text and attributes are
  // masked it is tag/class shape, and a dynamically built class name carrying a
  // path or a key is caught by the value rules above like any other string.

  // Last, so the synthetic values cannot be caught by the path rule above.
  applyUrlIdentity(properties, route);
  applyUrlIdentity(set, route);
  applyUrlIdentity(setOnce, route);

  // Surfaced in PostHog so a leak upstream is alertable rather than silent.
  if (flags.secret) properties.$scrub_secret_hit = true;
  if (flags.path) properties.$scrub_path_hit = true;

  return {
    ...result,
    properties,
    ...(set ? { $set: set } : {}),
    ...(setOnce ? { $set_once: setOnce } : {}),
  };
};

/**
 * Scrub an event, or drop it. Never throws: a bug here must lose data, not leak
 * it.
 */
export const scrubEvent = <T extends AnalyticsCaptureResult>(result: T | null): T | null => {
  if (!result) return null;
  try {
    return scrubUnsafe(result) as T | null;
  } catch {
    return null;
  }
};
