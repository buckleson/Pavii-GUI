/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 *
 * Agent CLIs answer with bare absolute paths when they generate an image, and
 * CommonMark's escape rules then eat the backslashes (`\.codex` renders as
 * `.codex`) — so the path was mangled AND unviewable. These tests pin the
 * rewrite that turns such paths into marked markdown images.
 */
import { describe, expect, it } from 'vitest';
import { INLINE_IMAGE_ALT, linkifyBareImagePaths } from '@/renderer/utils/chat/inlineImagePaths';

describe('linkifyBareImagePaths', () => {
  it('rewrites the exact codex generated-image path shape', () => {
    const input = 'Saved at:\nC:\\Users\\vijay\\.codex\\generated_images\\01a03a89-642a-7cb0\\call_wz4qJ48GXx6.png\n';

    const out = linkifyBareImagePaths(input);

    expect(out).toContain(
      `![${INLINE_IMAGE_ALT}](<C:/Users/vijay/.codex/generated_images/01a03a89-642a-7cb0/call_wz4qJ48GXx6.png>)`
    );
    // The original backslashed form must be gone — left in place it renders
    // with its backslashes eaten by CommonMark escapes.
    expect(out).not.toContain('C:\\Users');
  });

  it('rewrites POSIX paths under real user roots', () => {
    const out = linkifyBareImagePaths('The render is at /Users/vijay/Pictures/out.jpeg now.');
    expect(out).toContain(`![${INLINE_IMAGE_ALT}](</Users/vijay/Pictures/out.jpeg>)`);
  });

  it('does not touch site-relative URL paths', () => {
    // `/images/hero.png` in prose is a web path, not a file on this machine.
    const input = 'Put it at /images/hero.png in the public folder.';
    expect(linkifyBareImagePaths(input)).toBe(input);
  });

  it('does not touch non-image extensions', () => {
    const input = 'Config lives at C:\\Users\\vijay\\.codex\\config.toml today.';
    expect(linkifyBareImagePaths(input)).toBe(input);
  });

  it('leaves fenced code blocks alone', () => {
    const input = 'Example:\n```\ncopy C:\\Users\\v\\shot.png D:\\backup\\\n```\ndone';
    expect(linkifyBareImagePaths(input)).toBe(input);
  });

  it('turns a backticked path into a card — the shape codex actually emits', () => {
    // Codex writes "Saved at:" and then the path wrapped in backticks. The
    // code-span skip silenced the card for exactly this, so the feature
    // missed its primary target (found live on the first codex image).
    const input = 'Saved at:\n`C:\\Users\\vijay\\.codex\\generated_images\\abc\\call_x.png`\n';

    const out = linkifyBareImagePaths(input);

    expect(out).toContain(`![${INLINE_IMAGE_ALT}](<C:/Users/vijay/.codex/generated_images/abc/call_x.png>)`);
    expect(out).not.toContain('`C:');
  });

  it('leaves a code span that is more than a path alone', () => {
    // A span holding a command that merely mentions a path is code, not an
    // attachment.
    const input = 'Run `copy C:\\a\\shot.png D:\\backup` yourself.';
    expect(linkifyBareImagePaths(input)).toBe(input);
  });

  it('leaves inline code spans alone', () => {
    const input = 'Run `open C:\\Users\\v\\shot.png` yourself.';
    expect(linkifyBareImagePaths(input)).toBe(input);
  });

  it('does not rewrite a path already inside a markdown destination', () => {
    const input = '![already](C:/Users/v/shot.png)';
    expect(linkifyBareImagePaths(input)).toBe(input);
  });

  it('rewrites several paths independently', () => {
    const out = linkifyBareImagePaths('First C:\\a\\one.png then C:\\b\\two.webp.');
    expect(out.match(new RegExp(INLINE_IMAGE_ALT, 'g'))).toHaveLength(2);
    expect(out).toContain('(<C:/a/one.png>)');
    expect(out).toContain('(<C:/b/two.webp>)');
  });

  it('keeps a trailing sentence period out of the path', () => {
    const out = linkifyBareImagePaths('Saved to C:\\out\\final.png.');
    expect(out).toContain('(<C:/out/final.png>)');
    expect(out).not.toContain('final.png.>');
  });

  it('passes empty and pathless content through unchanged', () => {
    expect(linkifyBareImagePaths('')).toBe('');
    expect(linkifyBareImagePaths('no paths here')).toBe('no paths here');
  });
});

describe('openable document paths', () => {
  it('turns a backticked docx path into a file chip marker', () => {
    // The user asked for exactly this: a small Open button beside the path an
    // agent prints after generating a document.
    const input = 'Saved the report at `C:\\Users\\vijay\\Documents\\report.docx` for you.';

    const out = linkifyBareImagePaths(input);

    expect(out).toContain('![pavii:inline-file](<C:/Users/vijay/Documents/report.docx>)');
  });

  it('handles bare pdf and pptx paths in prose', () => {
    const out = linkifyBareImagePaths('Deck: C:\\work\\pitch.pptx and notes at /Users/v/notes.pdf today.');
    expect(out).toContain('(<C:/work/pitch.pptx>)');
    expect(out).toContain('(</Users/v/notes.pdf>)');
    expect(out.match(/pavii:inline-file/g)).toHaveLength(2);
  });

  it('keeps images on the image card, not the file chip', () => {
    const out = linkifyBareImagePaths('Shot: C:\\a\\x.png and doc: C:\\a\\y.docx.');
    expect(out).toContain('![pavii:inline-image](<C:/a/x.png>)');
    expect(out).toContain('![pavii:inline-file](<C:/a/y.docx>)');
  });

  it('ignores source-code extensions', () => {
    // A .ts/.rs path in prose is the agent talking about code, not delivering
    // a file to open.
    const input = 'Edit C:\\repo\\src\\main.rs and C:\\repo\\app.ts first.';
    expect(linkifyBareImagePaths(input)).toBe(input);
  });
});
