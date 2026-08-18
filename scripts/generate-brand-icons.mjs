/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Generate all Pavii.Ai brand icon assets from the master logo.
 *
 * Source: resources/brand/the-logo.png (black artwork on white background).
 * The white background is converted to transparency (alpha = 255 - luminance,
 * color forced to black) so icons float on any desktop/tray/dock surface.
 *
 * Outputs:
 *   resources/app.png                                        512x512  (linux icon, tray, notifications)
 *   resources/app.ico                                        16..256  (windows)
 *   resources/app.icns                                       128..1024 (macOS, PNG-based icns)
 *   public/pwa/icon-180.png / icon-192.png / icon-512.png             (PWA / apple-touch)
 *   packages/desktop/src/renderer/assets/logos/brand/app.png 1024x1024 (login page logo)
 *   mobile/assets/images/icon.png                            1024x1024 opaque white bg (Expo/iOS)
 *
 * Usage: bun scripts/generate-brand-icons.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(ROOT, 'resources/brand/the-logo.png');

/**
 * Convert the black-on-white master into a circular badge with transparent
 * corners: pixels outside the outer ring become transparent, while the white
 * disc inside the ring stays opaque so the black mark remains visible on dark
 * desktops, docks, and taskbars.
 */
async function loadTransparentMaster() {
  const { data, info } = await sharp(SOURCE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;

  // Find the outer edge of the ring by scanning from the left edge at mid-height
  // for the first dark pixel.
  let firstDarkX = -1;
  const midRow = Math.round(cy) * width * 4;
  for (let x = 0; x < width; x++) {
    if (data[midRow + x * 4] < 128) {
      firstDarkX = x;
      break;
    }
  }
  if (firstDarkX < 0) throw new Error('Could not locate the logo ring in the master image');
  const outerRadius = cx - firstDarkX;

  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const dist = Math.hypot(x - cx, y - cy);
      // Anti-aliased circular mask: 1 inside the ring, 0 outside
      const mask = Math.max(0, Math.min(1, outerRadius + 0.5 - dist));
      // Keep the grayscale artwork as-is inside the disc
      out[i] = data[i];
      out[i + 1] = data[i + 1];
      out[i + 2] = data[i + 2];
      out[i + 3] = Math.round(255 * mask);
    }
  }
  return sharp(out, { raw: { width, height, channels: 4 } });
}

async function pngAt(master, size, { opaqueWhite = false } = {}) {
  let img = master.clone().resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } });
  if (opaqueWhite) img = img.flatten({ background: { r: 255, g: 255, b: 255 } });
  return img.png().toBuffer();
}

/** Assemble a .ico container from PNG-encoded frames. */
function buildIco(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(frames.length, 4);
  const entries = [];
  let offset = 6 + 16 * frames.length;
  for (const { size, png } of frames) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 means 256)
    e.writeUInt8(size >= 256 ? 0 : size, 1); // height
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // color planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...frames.map((f) => f.png)]);
}

/** Assemble a PNG-based .icns container. */
function buildIcns(chunks) {
  const body = chunks.map(({ type, png }) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(8 + png.length, 4);
    return Buffer.concat([head, png]);
  });
  const total = 8 + body.reduce((n, b) => n + b.length, 0);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(total, 4);
  return Buffer.concat([head, ...body]);
}

function write(relPath, buffer) {
  const abs = resolve(ROOT, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, buffer);
  console.log(`wrote ${relPath} (${buffer.length} bytes)`);
}

async function main() {
  const master = await loadTransparentMaster();

  // Plain PNG outputs
  write('resources/app.png', await pngAt(master, 512));
  // Dev-run window/dock icon (referenced by index.ts when !app.isPackaged)
  write('resources/app_dev.png', await pngAt(master, 512));
  write('public/pwa/icon-180.png', await pngAt(master, 180));
  write('public/pwa/icon-192.png', await pngAt(master, 192));
  write('public/pwa/icon-512.png', await pngAt(master, 512));
  write('packages/desktop/src/renderer/assets/logos/brand/app.png', await pngAt(master, 1024));
  // Expo/iOS app icons must be opaque
  write('mobile/assets/images/icon.png', await pngAt(master, 1024, { opaqueWhite: true }));

  // Windows .ico
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoFrames = [];
  for (const size of icoSizes) icoFrames.push({ size, png: await pngAt(master, size) });
  write('resources/app.ico', buildIco(icoFrames));

  // macOS .icns (PNG-based chunk types)
  const icnsSpec = [
    ['ic07', 128],
    ['ic08', 256],
    ['ic09', 512],
    ['ic10', 1024],
    ['ic11', 32],
    ['ic12', 64],
    ['ic13', 256],
    ['ic14', 512],
  ];
  const icnsChunks = [];
  for (const [type, size] of icnsSpec) icnsChunks.push({ type, png: await pngAt(master, size) });
  write('resources/app.icns', buildIcns(icnsChunks));

  // Small avatar data URI used by the assistant-branding display override
  const avatarPng = await pngAt(master, 128);
  const avatarModule = [
    '/**',
    ' * @license',
    ' * Copyright 2026 Team Pavii',
    ' * SPDX-License-Identifier: Apache-2.0',
    ' */',
    '',
    '// GENERATED by scripts/generate-brand-icons.mjs — do not edit by hand.',
    '/** 128x128 Pavii.Ai logo as a PNG data URI (avatar override for built-in personas). */',
    `export const PAVII_AVATAR_DATA_URI = 'data:image/png;base64,${avatarPng.toString('base64')}';`,
    '',
  ].join('\n');
  write('packages/desktop/src/common/utils/paviiAvatarDataUri.ts', Buffer.from(avatarModule));
}

main().catch((error) => {
  console.error('[generate-brand-icons] failed:', error);
  process.exitCode = 1;
});
