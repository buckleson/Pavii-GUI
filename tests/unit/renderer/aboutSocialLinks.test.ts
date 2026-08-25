/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 *
 * The site footer shipped two social links that did not work for visitors: one
 * pointed at a LinkedIn ADMIN dashboard, which only the page's own admins can
 * open, and one at x.com's homepage rather than a profile. These assertions
 * keep the same mistakes out of the desktop About panel.
 */
import { describe, expect, it } from 'vitest';
import { SOCIAL_LINKS } from '@/renderer/components/settings/SettingsModal/contents/AboutModalContent';

const urlFor = (label: string): string => SOCIAL_LINKS.find((link) => link.label === label)?.url ?? '';

describe('About panel social links', () => {
  it('offers GitHub, X and LinkedIn', () => {
    expect(SOCIAL_LINKS.map((link) => link.label)).toEqual(['GitHub', 'X', 'LinkedIn']);
  });

  it('sends X to the profile rather than the site front door', () => {
    // `https://x.com` on its own drops the visitor on their own timeline.
    expect(urlFor('X')).toBe('https://x.com/Bucklesongroup');
  });

  it('sends LinkedIn to the public company page, never the admin dashboard', () => {
    const url = urlFor('LinkedIn');
    expect(url).toBe('https://www.linkedin.com/company/thepavii/');
    // `/admin/dashboard/` is admin-only and leaks the page's internal id;
    // `?viewAsMember=true` is an admin preview affordance and means nothing to
    // anyone else.
    expect(url).not.toContain('admin');
    expect(url).not.toContain('viewAsMember');
  });

  it('gives every entry an absolute https destination', () => {
    for (const link of SOCIAL_LINKS) {
      expect(link.url, link.label).toMatch(/^https:\/\//);
      expect(() => new URL(link.url), link.label).not.toThrow();
    }
  });
});
