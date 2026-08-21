/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { ROUTE_PATTERNS, UNKNOWN_ROUTE, normaliseRoute, routeToAppUrl } from '@/common/analytics/routes';

describe('normaliseRoute', () => {
  it('is idempotent over every declared pattern', () => {
    for (const pattern of ROUTE_PATTERNS) {
      expect(normaliseRoute(pattern)).toBe(pattern);
    }
  });

  it('templatises a hash route, discarding the parameter value', () => {
    expect(normaliseRoute('#/settings/skills/detail/my-private-skill')).toBe('/settings/skills/detail/:skillName');
    expect(normaliseRoute('#/conversation/8f2c1b90-aaaa-bbbb-cccc-ddddeeeeffff')).toBe('/conversation/:id');
    expect(normaliseRoute('#/team/42')).toBe('/team/:id');
    expect(normaliseRoute('#/settings/ext/my-extension')).toBe('/settings/ext/:tabId');
    expect(normaliseRoute('#/scheduled/job-7')).toBe('/scheduled/:job_id');
    expect(normaliseRoute('#/settings/agent/local-1/repair')).toBe('/settings/agent/:id/repair');
  });

  it('extracts the route from a packaged file:// href without keeping the path', () => {
    const href = 'file:///C:/Users/alice/AppData/Local/Programs/PaviiAi/out/renderer/index.html#/settings/skills';
    const route = normaliseRoute(href);
    expect(route).toBe('/settings/skills');
    expect(route).not.toContain('alice');
    expect(route).not.toContain('file:');
  });

  it('never emits a parameter value for any sensitive input', () => {
    const inputs = [
      '#/settings/skills/detail/tax-return-helper',
      '#/conversation/private-chat-id',
      'file:///Users/alice/app.html#/team/alices-team',
    ];
    for (const input of inputs) {
      const route = normaliseRoute(input);
      expect(route).not.toMatch(/tax-return-helper|private-chat-id|alices-team|alice/);
      expect(
        route
          .split('/')
          .filter(Boolean)
          .every((seg) => !seg.includes('alice'))
      ).toBe(true);
    }
  });

  it('drops query strings', () => {
    expect(normaliseRoute('#/settings/skills?highlight=my-secret-skill')).toBe('/settings/skills');
    expect(normaliseRoute('#/settings/skills?view=import-history')).toBe('/settings/skills');
  });

  it('accepts a bare path with no hash', () => {
    expect(normaliseRoute('/guid')).toBe('/guid');
    expect(normaliseRoute('guid')).toBe('/guid');
  });

  it('returns /unknown for anything undeclared or empty', () => {
    expect(normaliseRoute('#/not/a/real/route')).toBe(UNKNOWN_ROUTE);
    expect(normaliseRoute('#/settings/skills/detail/a/b')).toBe(UNKNOWN_ROUTE);
    expect(normaliseRoute('')).toBe(UNKNOWN_ROUTE);
    expect(normaliseRoute(undefined)).toBe(UNKNOWN_ROUTE);
    expect(normaliseRoute(null)).toBe(UNKNOWN_ROUTE);
  });

  it('treats the app root as /', () => {
    expect(normaliseRoute('#/')).toBe('/');
  });

  it('prefers a literal route over a same-length parameterised one', () => {
    // '/settings/model' and '/conversation/:id' are both two segments.
    expect(normaliseRoute('#/settings/model')).toBe('/settings/model');
    expect(normaliseRoute('#/settings/tools')).toBe('/settings/tools');
  });
});

describe('routeToAppUrl', () => {
  it('joins the synthetic origin to a route', () => {
    expect(routeToAppUrl('/settings/skills', 'app://pavii')).toBe('app://pavii/settings/skills');
  });
});
