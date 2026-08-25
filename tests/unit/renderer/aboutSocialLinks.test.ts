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
import { ABOUT_LINK_URLS, SOCIAL_LINKS } from '@/renderer/components/settings/SettingsModal/contents/AboutModalContent';

const urlFor = (label: string): string => SOCIAL_LINKS.find((link) => link.label === label)?.url ?? '';

describe('About panel social links', () => {
  it('offers every profile the website footer lists', () => {
    expect(SOCIAL_LINKS.map((link) => link.label)).toEqual([
      'GitHub',
      'X',
      'LinkedIn',
      'Instagram',
      'Medium',
      'Substack',
    ]);
  });

  it('matches the site on the profiles it shares with it', () => {
    // Two places name the same accounts; if they drift, one of them is wrong.
    expect(urlFor('Instagram')).toBe('https://www.instagram.com/pavii.ai/');
    expect(urlFor('Medium')).toBe('https://medium.com/@pavii.ai');
    expect(urlFor('Substack')).toBe('https://substack.com/@paviiai');
  });

  it('gives every entry a distinct destination', () => {
    const urls = SOCIAL_LINKS.map((link) => link.url);
    expect(new Set(urls).size).toBe(urls.length);
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

describe('About panel text links', () => {
  it('sends each label where it says it goes, not the product landing page', () => {
    // All three used to open the same landing page whatever their label said.
    expect(ABOUT_LINK_URLS.helpDocumentation).toBe('https://www.pavii.tech/products/dev-tools/docs/');
    expect(ABOUT_LINK_URLS.updateLog).toBe('https://github.com/buckleson/Pavii-Gui-Releases/releases');
    expect(ABOUT_LINK_URLS.officialWebsite).toBe('https://www.pavii.tech/products/dev-tools/');
  });
});
