/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { getManagedToolsDir, getManagedToolsPathEntries } from '@pavii/web-host';
import { getDataPath } from '@process/utils/utils';

/**
 * Folder layout for the recommended tools. Everything lives under Pavii's
 * managed-tools folder, so nothing is written to the user's home or repo.
 */
export type RecommendedToolPaths = {
  /** npm --prefix for Trail-Code (same folder as other managed npm installs). */
  npmPrefix: string;
  /** Folders where npm puts launcher shims (`trail`). */
  npmBinDirs: string[];
  /** Folder that holds the pinned uv binary (`uv` / `uv.exe`). */
  uvDir: string;
  /** UV_TOOL_DIR: uv's tool environments. */
  uvToolDir: string;
  /** UV_TOOL_BIN_DIR: launchers `headroom`, `graphify`, `graphify-mcp`. */
  uvToolBinDir: string;
  /** UV_PYTHON_INSTALL_DIR: Python builds uv downloads. */
  uvPythonDir: string;
  /** UV_CACHE_DIR. */
  uvCacheDir: string;
  /** Per-workspace code graphs (`<codeGraphsDir>/<hash>/`), outside every repo. */
  codeGraphsDir: string;
};

export function getRecommendedToolPaths(dataDir: string = getDataPath()): RecommendedToolPaths {
  const tools = getManagedToolsDir(dataDir);
  return {
    npmPrefix: tools,
    npmBinDirs: getManagedToolsPathEntries(dataDir),
    uvDir: path.join(tools, 'uv'),
    uvToolDir: path.join(tools, 'uv-tools'),
    uvToolBinDir: path.join(tools, 'uv-bin'),
    uvPythonDir: path.join(tools, 'uv-python'),
    uvCacheDir: path.join(tools, 'uv-cache'),
    codeGraphsDir: path.join(dataDir, 'code-graphs'),
  };
}

/** Executable file name on this platform (`uv` → `uv.exe` on Windows). */
export const exeName = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
