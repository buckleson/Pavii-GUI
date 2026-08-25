/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Display-level branding for tool identifiers in chat.
 *
 * Builtin MCP ids keep their stored `aionui-` names — renaming them would
 * orphan saved configurations — but those ids surface in several chat rows:
 * tool titles, descriptions, permission questions and the expanded input
 * dump. This applies the SAME display convention `skillBranding` already
 * established (`aionui-` → `pavii-`), plus a friendly name for the builtin
 * image tool, at render time only. The stored values never change.
 */

const IMAGE_GEN_ID = /\baionui-image-generation\b/g;
const AIONUI_ID_PREFIX = /\baionui([-_])/g;

/** Rebrand tool ids inside a display string; safe on undefined/empty. */
export function brandToolText(text: string | undefined | null): string {
  if (!text) return '';
  return text.replace(IMAGE_GEN_ID, 'image-generation').replace(AIONUI_ID_PREFIX, 'pavii$1');
}

/** Friendly label for a tool name; falls back to the rebranded id. */
export function brandToolLabel(name: string | undefined | null): string {
  if (!name) return '';
  if (IMAGE_GEN_ID.test(name)) {
    IMAGE_GEN_ID.lastIndex = 0;
    return name
      .replace(IMAGE_GEN_ID, 'Image Generation')
      .replace(/^Image Generation[-_:]?/, 'Image Generation ')
      .trim();
  }
  IMAGE_GEN_ID.lastIndex = 0;
  return brandToolText(name);
}
