/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Route templatising for analytics.
 *
 * The app uses a `HashRouter`, so the route lives in `location.hash`. Raw route
 * paths must never reach PostHog: `/settings/skills/detail/:skillName` carries
 * a user-imported skill name, and `/conversation/:id` and `/team/:id` are
 * stable per-user identifiers. Every path is reduced to its declared pattern,
 * and anything unrecognised becomes `/unknown` rather than passing through.
 *
 * Mirrors the route table in
 * `packages/desktop/src/renderer/components/layout/Router.tsx`.
 */

export const UNKNOWN_ROUTE = '/unknown';

/**
 * Declared route patterns, most specific first — the first match wins. Segments
 * beginning with `:` match any single segment and are emitted as the parameter
 * name, never the value.
 */
export const ROUTE_PATTERNS: readonly string[] = [
  '/login',
  '/guid',
  '/profile',
  '/assistants',
  '/scheduled',
  '/scheduled/:job_id',
  '/conversation/:id',
  '/team/:id',
  '/settings',
  '/settings/model',
  '/settings/agent',
  '/settings/agent/:id/repair',
  '/settings/assistants',
  '/settings/skills',
  '/settings/skills/import-history',
  '/settings/skills/detail/:skillName',
  '/settings/skills-hub',
  '/settings/tools',
  '/settings/capabilities',
  '/settings/capabilities/skills/import-history',
  '/settings/webui',
  '/settings/system',
  '/settings/about',
  '/settings/appearance',
  '/settings/display',
  '/settings/pet',
  '/settings/ext/:tabId',
  '/test/components',
];

const segmentsOf = (path: string): string[] => path.split('/').filter(Boolean);

/** A pattern matches when segment counts agree and every literal segment is equal. */
const patternMatches = (pattern: string[], actual: string[]): boolean =>
  pattern.length === actual.length && pattern.every((seg, i) => seg.startsWith(':') || seg === actual[i]);

/**
 * Pre-split once. Literal-only patterns are tried before parameterised ones of
 * the same length, so a literal route can never be swallowed by a `:param`.
 */
const COMPILED = ROUTE_PATTERNS.map((pattern) => ({ pattern, segments: segmentsOf(pattern) })).toSorted(
  (a, b) => a.segments.filter((s) => s.startsWith(':')).length - b.segments.filter((s) => s.startsWith(':')).length
);

/**
 * Reduce any href, hash, or path to a declared route pattern.
 *
 * Accepts a full `file://…#/settings/skills` href, a bare `#/guid`, or a plain
 * `/guid`. Query strings and nested hashes are discarded.
 */
export const normaliseRoute = (input: string | undefined | null): string => {
  if (typeof input !== 'string' || input.length === 0) return UNKNOWN_ROUTE;

  const hashIndex = input.indexOf('#');
  let path = hashIndex >= 0 ? input.slice(hashIndex + 1) : input;

  // Drop query and any trailing fragment, then normalise to a leading slash.
  path = path.split('?')[0].split('#')[0];
  if (!path.startsWith('/')) path = `/${path}`;

  const actual = segmentsOf(path);
  if (actual.length === 0) return '/';

  const hit = COMPILED.find((candidate) => patternMatches(candidate.segments, actual));
  return hit ? hit.pattern : UNKNOWN_ROUTE;
};

/** Synthetic, path-free URL for a route — replaces the real `file://` href. */
export const routeToAppUrl = (route: string, origin: string): string => `${origin}${route}`;
