/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Social brand marks that @icon-park/react does not ship (it has Github and
 * Instagram, but no X, LinkedIn, Medium, or Substack — verified against its
 * icon index). Drawn as single-path inline SVGs on a 24px viewBox, filled
 * with `currentColor` so they follow the surrounding text color like the
 * icon-park glyphs beside them. Display-only.
 */

import React from 'react';

type GlyphProps = { size?: number };

/** The X (formerly Twitter) logotype. */
export const XGlyph: React.FC<GlyphProps> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
    <path d='M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z' />
  </svg>
);

/** LinkedIn "in" on the rounded square. */
export const LinkedinGlyph: React.FC<GlyphProps> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
    <path d='M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455zM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125M7.119 20.452H3.554V9h3.565zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0z' />
  </svg>
);

/** Medium's three-ellipse mark. */
export const MediumGlyph: React.FC<GlyphProps> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
    <path d='M13.54 12a6.8 6.8 0 0 1-6.77 6.82A6.8 6.8 0 0 1 0 12a6.8 6.8 0 0 1 6.77-6.82A6.8 6.8 0 0 1 13.54 12m7.42 0c0 3.54-1.51 6.42-3.38 6.42s-3.39-2.88-3.39-6.42 1.52-6.42 3.39-6.42 3.38 2.88 3.38 6.42M24 12c0 3.17-.53 5.75-1.19 5.75-.66 0-1.19-2.58-1.19-5.75s.53-5.75 1.19-5.75C23.47 6.25 24 8.83 24 12' />
  </svg>
);

/** Substack's three-bar mark (bottom bar as the open envelope). */
export const SubstackGlyph: React.FC<GlyphProps> = ({ size = 17 }) => (
  <svg width={size} height={size} viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
    <path d='M22.539 8.242H1.46V5.406h21.08zM1.46 10.812V24L12 18.11 22.54 24V10.812zM22.54 0H1.46v2.836h21.08z' />
  </svg>
);
