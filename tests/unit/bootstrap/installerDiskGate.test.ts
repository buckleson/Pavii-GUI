/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The E1020 free-space gate, guarded statically.
 *
 * E1020 shipped for months as a define nothing ever raised: no code anywhere
 * measured disk space, so running out of it surfaced as whatever failed first
 * — usually E1010 "could not extract", which reads as a corrupt download and
 * sends the user to re-download when the real fix is to free space.
 *
 * A declared-but-unreachable error code is invisible to every runtime test, so
 * these assertions are deliberately structural: they fail if the gate is
 * defined but never inserted, or inserted somewhere that runs after the
 * installation has already been mutated.
 *
 * The behavioural half (which branch runs, and that an unmeasurable drive
 * fails OPEN) needs makensis and lives in scripts/smoke-installer-disk-gate.js.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WINDOWS_DIR = resolve(__dirname, '..', '..', '..', 'resources', 'windows');
const read = (name: string) => readFileSync(join(WINDOWS_DIR, name), 'utf8');

describe('installer free-space gate (E1020)', () => {
  it('raises the code it declares', () => {
    const errors = read('installer-errors-sentry.nsh');

    expect(errors).toContain('!define AIONUI_E_DISK_INSUFFICIENT "E1020"');
    // The point of the whole change: the code must be reachable, not merely declared.
    expect(errors).toContain('${AIONUI_E_DISK_INSUFFICIENT} \\');
    expect(errors).toMatch(/!macro AIONUI_ASSERT_FREE_SPACE/);
    expect(errors).toMatch(/!macro AIONUI_MEASURE_FREE_MB/);
  });

  it('declares a threshold that covers a full payload', () => {
    const errors = read('installer-errors-sentry.nsh');
    const match = /!define AIONUI_MIN_FREE_MB (\d+)/.exec(errors);

    expect(match, 'AIONUI_MIN_FREE_MB must be defined').not.toBeNull();
    // A complete install measured 1022 MB on 2026-08-28. A threshold below that
    // cannot protect the extraction it is guarding.
    expect(Number(match![1])).toBeGreaterThanOrEqual(1022);
  });

  it('runs before the installation is mutated', () => {
    const remove = read('installer-remove-registry.nsh');

    const macroStart = remove.indexOf('!macro customRemoveFiles');
    const gate = remove.indexOf('AIONUI_ASSERT_FREE_SPACE', macroStart);
    // The snapshot rename is the first irreversible step; failing after it
    // costs the user their working install, which is the whole scenario this
    // gate exists to prevent.
    const firstMutation = remove.indexOf('Rename "$INSTDIR"', macroStart);

    expect(macroStart).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(macroStart);
    expect(firstMutation).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(firstMutation);
  });

  it('fails open when the drive cannot be measured', () => {
    const errors = read('installer-errors-sentry.nsh');
    const macro = errors.slice(
      errors.indexOf('!macro AIONUI_ASSERT_FREE_SPACE'),
      errors.indexOf('!macroend', errors.indexOf('!macro AIONUI_ASSERT_FREE_SPACE'))
    );

    // An empty reading must log and continue. If this branch ever raised
    // E1020, a broken PowerShell would block installs that would have worked.
    const emptyBranch = macro.slice(macro.indexOf('$AionUiFreeMb == ""'), macro.indexOf('${ElseIf}'));
    expect(emptyBranch).toContain('result=unknown');
    expect(emptyBranch).not.toContain('AIONUI_FAIL');
  });

  it('tells the user the numbers, not just that something went wrong', () => {
    const messages = read('installer-messages.nsh');
    const errors = read('installer-errors-sentry.nsh');

    expect(messages).toContain('AIONUI_MSG_DISK_INSUFFICIENT_EN');
    expect(messages).toContain('AIONUI_MSG_DISK_INSUFFICIENT_ACTION_EN');
    // Diagnostics carry the runtime free figure and the requirement, so the
    // dialog says how short the drive actually is.
    expect(errors).toContain('Free space: $AionUiFreeMb MB');
    expect(errors).toContain('Required: ${AIONUI_MIN_FREE_MB} MB');
  });

  it('reports free space when extraction fails, so disk-full is not read as a bad download', () => {
    const observability = read('installer-observability.nsh');
    const macro = observability.slice(observability.indexOf('!macro AIONUI_LOG_EXTRACT_RESULT'));

    expect(macro).toContain('AIONUI_MEASURE_FREE_MB');
    expect(macro).toContain('freeMb=$AionUiFreeMb');
  });
});
