/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { ipcBridge } from '@/common';
import type {
  AgentCliCheckResult,
  AgentCliUpdateResult,
  AgentCliUpdateState,
} from '@/common/types/agent/agentCliUpdate';

/**
 * Agent CLI update state for the settings page: reads the persisted results
 * once, follows background-check pushes, and exposes manual check / update.
 */
export const useAgentCliUpdates = () => {
  const [results, setResults] = useState<Record<string, AgentCliCheckResult>>({});
  const [checkingBackend, setCheckingBackend] = useState<string | null>(null);
  const [updatingBackend, setUpdatingBackend] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    ipcBridge.agentCli.getState
      .invoke()
      .then((state) => {
        if (active && state) setResults(state.results);
      })
      .catch((error: unknown) => console.warn('[AgentCli] reading update state failed:', error));
    const unsubscribe = ipcBridge.agentCli.stateChanged.on((state: AgentCliUpdateState) => {
      setResults(state.results);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const check = useCallback(async (backend: string): Promise<AgentCliCheckResult | undefined> => {
    setCheckingBackend(backend);
    try {
      const result = await ipcBridge.agentCli.check.invoke({ backend });
      if (result) setResults((prev) => ({ ...prev, [backend]: result }));
      return result;
    } finally {
      setCheckingBackend(null);
    }
  }, []);

  const update = useCallback(async (backend: string): Promise<AgentCliUpdateResult> => {
    setUpdatingBackend(backend);
    try {
      const outcome = await ipcBridge.agentCli.update.invoke({ backend });
      const result = outcome.result;
      if (result) setResults((prev) => ({ ...prev, [backend]: result }));
      return outcome;
    } finally {
      setUpdatingBackend(null);
    }
  }, []);

  return { results, checkingBackend, updatingBackend, check, update };
};
