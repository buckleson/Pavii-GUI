/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Agent CLIs answer with bare absolute paths when they generate an image —
 * codex writes to `~/.codex/generated_images/<uuid>/call_x.png` and puts that
 * path in prose. Markdown mangles it (backslash escapes eat `\.`), and nothing
 * makes it viewable.
 *
 * This transform rewrites each bare image path into markdown-image syntax with
 * a marker alt, which the Markdown renderer shows as a click-to-view card. The
 * rewritten destination uses forward slashes and an angle-bracket destination,
 * both of which CommonMark passes through byte-for-byte —
 * `normalizeLocalFileHrefToPath` already recognises the `C:/…` form.
 */

/** Alt text marking an image node as a path-derived click-to-view card. */
export const INLINE_IMAGE_ALT = 'pavii:inline-image';

/**
 * Alt text marking a path-derived document chip: the path stays visible, with
 * an Open button that hands the file to the OS default app. Images render
 * in-app; a docx/pptx/pdf has nothing to render it, and Word already exists.
 */
export const INLINE_FILE_ALT = 'pavii:inline-file';

/**
 * Extensions worth an Open button when an agent writes such a path. Curated
 * rather than "any extension": a bare `.ts`/`.rs` path in prose is usually the
 * agent talking about code, not delivering a file.
 */
const FILE_EXT = 'pdf|docx?|pptx?|xlsx?|csv|md|txt|zip|html?';

/**
 * Windows drive paths, and POSIX paths under the roots real user files live
 * in. Bare `/anything/…` would false-positive on site-relative URL paths in
 * prose, so POSIX is deliberately root-restricted (mirrors the local-file
 * link resolver in Markdown/markdownUtils.ts).
 *
 * The character class excludes markdown/HTML-active characters and both quote
 * styles, so a path inside quotes or a link destination stops at the quote.
 * The lookbehind keeps us out of existing markdown syntax: `](dest)`, image
 * `!(`, inline code, and HTML attribute values.
 */
const IMAGE_PATH_PATTERN =
  /(?<![\w`([\]=/\\:<])((?:[A-Za-z]:[\\/]|\/(?:Users|home|tmp|private|var|mnt|root)\/)[^\s`"'<>|*?()[\]]*?\.(?:png|jpe?g|gif|webp|bmp))(?=[\s.,;:!?)]|$)/gm;

const FILE_PATH_PATTERN = new RegExp(
  String.raw`(?<![\w\x60([\]=/\\:<])((?:[A-Za-z]:[\\/]|\/(?:Users|home|tmp|private|var|mnt|root)\/)[^\s\x60"'<>|*?()[\]]*?\.(?:${FILE_EXT}))(?=[\s.,;:!?)]|$)`,
  'gm'
);

/** Fenced code blocks and inline code spans, which must never be rewritten. */
const CODE_REGION_PATTERN = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;

const normalizeSlashes = (rawPath: string): string =>
  // Forward slashes: CommonMark backslash-escapes eat `\.` and friends, so a
  // Windows path cannot survive a markdown destination in its native form.
  rawPath.replace(/\\/g, '/');

const toMarkdownImage = (rawPath: string): string => `![${INLINE_IMAGE_ALT}](<${normalizeSlashes(rawPath)}>)`;

const toMarkdownFile = (rawPath: string): string => `![${INLINE_FILE_ALT}](<${normalizeSlashes(rawPath)}>)`;

const transformSegment = (segment: string): string =>
  segment
    .replace(IMAGE_PATH_PATTERN, (match) => toMarkdownImage(match))
    .replace(FILE_PATH_PATTERN, (match) => toMarkdownFile(match));

/**
 * An inline code span whose ENTIRE content is one absolute image path.
 *
 * Codex wraps generated-image paths in backticks ("Saved at:" then a
 * backticked `C:\...\x.png`), so the code-span skip — correct for paths
 * inside code examples — silenced the card for the very output this feature
 * was built for. A span that contains nothing but a path is a path mention,
 * not code.
 */
const PURE_PATH_CODE_SPAN =
  /`\s*((?:[A-Za-z]:[\\/]|\/(?:Users|home|tmp|private|var|mnt|root)\/)[^\s`"'<>|*?()[\]]*?\.(?:png|jpe?g|gif|webp|bmp))\s*`/g;

/** Same, for openable document paths — codex backticks those identically. */
const PURE_FILE_CODE_SPAN = new RegExp(
  String.raw`\x60\s*((?:[A-Za-z]:[\\/]|\/(?:Users|home|tmp|private|var|mnt|root)\/)[^\s\x60"'<>|*?()[\]]*?\.(?:${FILE_EXT}))\s*\x60`,
  'g'
);

/**
 * Rewrite bare absolute image paths in assistant prose into marked markdown
 * images. Code fences and inline code spans pass through untouched — a path
 * inside a code example is content, not an attachment.
 */
export function linkifyBareImagePaths(content: string): string {
  if (!content) return content;

  let result = '';
  let cursor = 0;
  for (const match of content.matchAll(CODE_REGION_PATTERN)) {
    const start = match.index ?? 0;
    result += transformSegment(content.slice(cursor, start));
    const region = match[0];
    // Fenced blocks stay untouched; an INLINE span that is nothing but an
    // image path becomes a card like its bare-path twin would.
    if (!region.startsWith('```')) {
      result += region
        .replace(PURE_PATH_CODE_SPAN, (_full, path: string) => toMarkdownImage(path))
        .replace(PURE_FILE_CODE_SPAN, (_full, path: string) => toMarkdownFile(path));
    } else {
      result += region;
    }
    cursor = start + region.length;
  }
  result += transformSegment(content.slice(cursor));
  return result;
}
