/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * The renderer cannot import the main-process catalog, so it keeps its own
 * list of updatable backends. These tests keep the two in sync.
 */

import { describe, expect, it } from 'vitest';
import { CLI_CATALOG, findCatalogEntry } from '@process/agentCli/cliCatalog';
import { AGENT_CLI_UPDATE_BACKENDS } from '@/common/types/agent/agentCliUpdate';

describe('agent CLI catalog', () => {
  it('lists exactly the backends the renderer offers update controls for', () => {
    expect([...AGENT_CLI_UPDATE_BACKENDS].sort()).toEqual(CLI_CATALOG.map((entry) => entry.backend).sort());
  });

  it('includes Qwen Code and OpenClaw as npm CLIs that are not auto-checked at launch', () => {
    expect(findCatalogEntry('qwen')).toMatchObject({ npmPackage: '@qwen-code/qwen-code', autoCheck: false });
    expect(findCatalogEntry('openclaw')).toMatchObject({ npmPackage: 'openclaw', autoCheck: false });
    expect(AGENT_CLI_UPDATE_BACKENDS).toEqual(expect.arrayContaining(['qwen', 'openclaw']));
  });

  it('finds an entry by backend id', () => {
    expect(findCatalogEntry('codex')?.binary).toBe('codex');
  });

  it('returns undefined for unknown or missing backend ids', () => {
    expect(findCatalogEntry('aionrs')).toBeUndefined();
    expect(findCatalogEntry(undefined)).toBeUndefined();
  });
});
