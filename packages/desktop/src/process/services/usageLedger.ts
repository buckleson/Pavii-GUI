/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Removes the retired local usage ledger.
 *
 * Token accounting used to live here: the renderer sent each turn's figures
 * over IPC and this module accumulated them into `usage-ledger.json`. That
 * could only ever see conversations a desktop window had open — scheduled
 * tasks, channel turns and WebUI turns were never counted — and it summed
 * numbers whose meaning differs per backend, so long sessions inflated.
 *
 * The engine records usage now, at the point every surface passes through,
 * and serves it from `GET /api/usage/ledger`. The old file cannot be migrated:
 * its totals mix inflated and under-counted figures with no per-turn record to
 * recompute from, so it is deleted rather than carried forward as history that
 * looks authoritative but is not.
 */

import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const LEDGER_FILE_NAME = 'usage-ledger.json';

/** Delete the retired ledger file. Safe to call on every start. */
export function clearLegacyUsageLedger(configDir: string): boolean {
  const file = join(configDir, LEDGER_FILE_NAME);
  if (!existsSync(file)) return false;
  try {
    unlinkSync(file);
    return true;
  } catch {
    // A locked or already-removed file is not worth failing startup over; the
    // file is unreferenced either way.
    return false;
  }
}
