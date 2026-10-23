/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  RECOMMENDED_TOOLS,
  type RecommendedTool,
  type RecommendedToolStatus,
} from '@/common/types/agent/recommendedTools';
import { exeName, getRecommendedToolPaths, type RecommendedToolPaths } from './paths';

/** Launcher files whose presence means the tool is installed. */
const launcherCandidates = (tool: RecommendedTool, paths: RecommendedToolPaths): string[] => {
  if (tool.runtime === 'node') {
    const shim = process.platform === 'win32' ? 'trail.cmd' : 'trail';
    return paths.npmBinDirs.map((dir) => path.join(dir, shim));
  }
  const launcher = tool.id === 'graphify' ? 'graphify-mcp' : tool.id;
  return [path.join(paths.uvToolBinDir, exeName(launcher))];
};

/** Installed state of each recommended tool; the version is the pinned one when installed. */
export function getRecommendedToolStatus(): RecommendedToolStatus[] {
  const paths = getRecommendedToolPaths();
  return RECOMMENDED_TOOLS.map((tool) => {
    const installed = launcherCandidates(tool, paths).some((file) => fs.existsSync(file));
    return installed ? { id: tool.id, installed, version: tool.version } : { id: tool.id, installed };
  });
}
