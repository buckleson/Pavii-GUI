/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Maps the HTTP control-plane `ProjectDetailDto` (roots metadata) into the
 * projection layer's `RootRef[]`. Pure: no I/O, no React — so the display-title
 * fallback and status/role passthrough are unit-testable in isolation. The
 * backend already sorts `entries` by `order_index`; order is preserved here.
 */

import type { ProjectDetailDto, ProjectEntryDto } from '@/common/types/project';

import type { RootRef } from './explorerModel';

/**
 * Human basename of a display path, tolerant of both `/` and `\` separators and
 * trailing slashes (display_path is human-facing, not a protocol path).
 */
const basename = (displayPath: string): string => {
  const trimmed = displayPath.replace(/[\\/]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
};

/** Engine-minted temporary-workspace dir names (old and rebranded prefixes). */
const TEMP_WORKSPACE_NAME = /^(aionrs|pavii)-temp-/;

/**
 * One entry → RootRef. Title precedence: user `display_name` → basename of the
 * `display_path` → `pe_id` (last-resort, never empty). `role` / `runtime_status`
 * pass through onto the root node for pinning + status display.
 *
 * Workspace roots named by the engine's temp-dir generator (`aionrs-temp-<id>`
 * / `pavii-temp-<id>`) are display-renamed: the caller can supply a localized
 * "Temporary space" label (same wording the sider uses); without one the old
 * prefix is still scrubbed to the Pavii spelling.
 */
export const entryToRootRef = (entry: ProjectEntryDto, temporaryWorkspaceLabel?: string): RootRef => {
  const rawTitle = entry.display_name?.trim() || basename(entry.display_path) || entry.pe_id;
  const title =
    entry.role === 'workspace' && TEMP_WORKSPACE_NAME.test(rawTitle)
      ? temporaryWorkspaceLabel || rawTitle.replace(/^aionrs-temp-/, 'pavii-temp-')
      : rawTitle;
  return {
    pe_id: entry.pe_id,
    title,
    role: entry.role,
    runtimeStatus: entry.runtime_status,
  };
};

/** Full project detail → ordered pe roots for the projection. */
export const toRootRefs = (detail: ProjectDetailDto, temporaryWorkspaceLabel?: string): RootRef[] =>
  detail.explorer.entries.map((entry) => entryToRootRef(entry, temporaryWorkspaceLabel));
