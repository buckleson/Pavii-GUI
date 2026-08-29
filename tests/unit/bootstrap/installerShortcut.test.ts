/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The desktop shortcut, guarded statically.
 *
 * `createDesktopShortcut: true` creates the icon on a fresh or manual install
 * and does nothing on auto-update, so an auto-updated install silently loses its
 * desktop icon (observed live on 2026-08-28 updating to 2.2.6 — the Start-menu
 * entry survived, the desktop one did not).
 *
 * Raising the option to "always" does NOT fix it: that branch requires
 * `keepShortcuts == "true"` (only true during an update, because
 * `allowToChangeInstallationDirectory` is set) yet is guarded by
 * `${ifNot} ${isUpdated}` — mutually exclusive, hence dead code here. The fix
 * therefore lives in our own `customInstall`.
 *
 * These assertions are structural because the behaviour they protect cannot be
 * reached by any runtime test in this repo — it needs a real Windows
 * auto-update. Before this file, shortcut behaviour had no test, no smoke
 * harness and no documentation, while uninstall/rollback/disk/verify each had
 * several.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..', '..', '..');
const nsh = readFileSync(join(ROOT, 'resources', 'windows', 'installer-update-verify.nsh'), 'utf8');

const shortcutMacro = nsh.slice(
  nsh.indexOf('!macro AIONUI_ENSURE_DESKTOP_SHORTCUT'),
  nsh.indexOf('!macroend', nsh.indexOf('!macro AIONUI_ENSURE_DESKTOP_SHORTCUT'))
);

describe('installer desktop shortcut', () => {
  it('is reachable from customInstall', () => {
    const customInstall = nsh.slice(nsh.indexOf('!macro customInstall'));

    expect(shortcutMacro, 'AIONUI_ENSURE_DESKTOP_SHORTCUT must exist').not.toHaveLength(0);
    // Declared-but-never-called is the exact failure mode that left E1020 dead.
    expect(customInstall).toContain('!insertmacro AIONUI_ENSURE_DESKTOP_SHORTCUT');
  });

  it('names the link after SHORTCUT_NAME, not PRODUCT_FILENAME', () => {
    // They differ: PRODUCT_FILENAME follows executableName ("PaviiAi"),
    // SHORTCUT_NAME follows shortcutName ("Pavii.Ai"). The uninstaller only
    // deletes the SHORTCUT_NAME path, so using the other one orphans an icon on
    // the desktop at every uninstall.
    expect(shortcutMacro).toContain('$DESKTOP\\${SHORTCUT_NAME}.lnk');
    expect(shortcutMacro).not.toContain('${PRODUCT_FILENAME}.lnk');
  });

  it('points at the real executable', () => {
    expect(shortcutMacro).toContain('$INSTDIR\\${APP_EXECUTABLE_FILENAME}');
  });

  it('only creates the shortcut when it is absent', () => {
    // Recreating unconditionally would resurrect an icon the user deliberately
    // deleted, on every single update — worse than the bug being fixed.
    const guardIndex = shortcutMacro.indexOf('${FileExists} "$DESKTOP\\${SHORTCUT_NAME}.lnk"');
    const createIndex = shortcutMacro.indexOf('CreateShortCut');

    expect(guardIndex).toBeGreaterThan(-1);
    expect(createIndex).toBeGreaterThan(guardIndex);
    // The create must sit in the ${Else}, i.e. the not-present branch.
    expect(shortcutMacro.indexOf('${Else}')).toBeLessThan(createIndex);
  });

  it('never fails the install over a shortcut', () => {
    // A shortcut is cosmetic; an otherwise good install must not abort for it.
    expect(shortcutMacro).not.toContain('AIONUI_FAIL');
    expect(shortcutMacro).toContain('result=fail');
  });

  it('sets the AppUserModelID so taskbar pinning attributes correctly', () => {
    expect(shortcutMacro).toContain('WinShell::SetLnkAUMI');
    expect(shortcutMacro).toContain('${APP_ID}');
  });
});

describe('linux desktop entry', () => {
  const yml = readFileSync(join(ROOT, 'packages', 'desktop', 'electron-builder.yml'), 'utf8');
  const linuxBlock = yml.slice(yml.indexOf('\nlinux:'), yml.indexOf('\ndeb:'));

  it('sets Categories via linux.category, the only place that works', () => {
    // electron-builder overwrites desktopMeta.Categories from `linux.category`
    // AFTER merging `desktop.entry`, so a Categories key under desktop.entry is
    // silently discarded. This app shipped Categories=Utility; while the entry
    // asked for Office too.
    expect(linuxBlock).toMatch(/^ {2}category: .*Office.*Utility/m);
    expect(linuxBlock, 'desktop.entry.Categories is ignored — set linux.category').not.toMatch(/^ {6}Categories:/m);
  });

  it('declares deb dependencies explicitly', () => {
    // Inheriting electron-builder's defaults means an upgrade could silently
    // change what the package requires.
    const debBlock = yml.slice(yml.indexOf('\ndeb:'));
    expect(debBlock).toContain('depends:');
    expect(debBlock).toContain('libgtk-3-0');
    expect(debBlock).toContain('libnss3');
  });
});
