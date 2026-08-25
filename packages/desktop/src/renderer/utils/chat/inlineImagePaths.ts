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
  /(?<![\w`([\]=/\\:])((?:[A-Za-z]:[\\/]|\/(?:Users|home|tmp|private|var|mnt|root)\/)[^\s`"'<>|*?()[\]]*?\.(?:png|jpe?g|gif|webp|bmp))(?=[\s.,;:!?)]|$)/gm;

/** Fenced code blocks and inline code spans, which must never be rewritten. */
const CODE_REGION_PATTERN = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;

const toMarkdownImage = (rawPath: string): string => {
  // Forward slashes: CommonMark backslash-escapes eat `\.` and friends, so a
  // Windows path cannot survive a markdown destination in its native form.
  const normalized = rawPath.replace(/\\/g, '/');
  return `![${INLINE_IMAGE_ALT}](<${normalized}>)`;
};

const transformSegment = (segment: string): string =>
  segment.replace(IMAGE_PATH_PATTERN, (match) => toMarkdownImage(match));

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
    result += match[0];
    cursor = start + match[0].length;
  }
  result += transformSegment(content.slice(cursor));
  return result;
}
