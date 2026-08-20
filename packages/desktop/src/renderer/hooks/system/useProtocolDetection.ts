/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProtocolDetectionResponse } from '@/common/utils/protocolDetector';
import { ipcBridge } from '@/common';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Protocol detection hook configuration
 */
interface UseProtocolDetectionOptions {
  /** Debounce delay in milliseconds */
  debounceMs?: number;
  /** Whether to auto-detect */
  autoDetect?: boolean;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Whether to test all keys */
  testAllKeys?: boolean;
}

/**
 * Protocol detection hook return value
 */
interface UseProtocolDetectionResult {
  /** Whether detecting */
  isDetecting: boolean;
  /** Detection result */
  result: ProtocolDetectionResponse | null;
  /** Error message */
  error: string | null;
  /** Manually trigger detection */
  detect: (base_url: string, api_key: string) => Promise<void>;
  /** Reset state */
  reset: () => void;
}

/**
 * Protocol Detection Hook
 *
 * Used to auto-detect the protocol type used by an API endpoint
 *
 * @param base_url - Base URL
 * @param api_key - API key, or several separated by commas or newlines
 * @param options - Options
 */
export function useProtocolDetection(
  base_url: string,
  api_key: string,
  options: UseProtocolDetectionOptions = {}
): UseProtocolDetectionResult {
  const { debounceMs = 800, autoDetect = true, timeout = 10000, testAllKeys = false } = options;

  const [isDetecting, setIsDetecting] = useState(false);
  const [result, setResult] = useState<ProtocolDetectionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Debounce timer
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Request version, used to discard stale responses
  const requestVersionRef = useRef(0);

  /**
   * Execute protocol detection
   */
  const detect = useCallback(
    async (url: string, key: string) => {
      // Clear the previous timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }

      // Validate the input
      if (!url || !key) {
        setResult(null);
        setError(null);
        return;
      }

      // Bump the request version
      const currentVersion = ++requestVersionRef.current;

      setIsDetecting(true);
      setError(null);

      try {
        const detectionResult = await ipcBridge.mode.detectProtocol.invoke({
          base_url: url,
          api_key: key,
          timeout,
          testAllKeys,
        });

        // Check this is still the newest request
        if (currentVersion !== requestVersionRef.current) {
          return;
        }

        setResult(detectionResult);
        setError(null);
      } catch (e: any) {
        // Check this is still the newest request
        if (currentVersion !== requestVersionRef.current) {
          return;
        }

        setResult(null);
        setError(e.message || String(e));
      } finally {
        // Check this is still the newest request
        if (currentVersion === requestVersionRef.current) {
          setIsDetecting(false);
        }
      }
    },
    [timeout, testAllKeys]
  );

  /**
   * Reset state
   */
  const reset = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    requestVersionRef.current++;
    setIsDetecting(false);
    setResult(null);
    setError(null);
  }, []);

  /**
   * Auto-detect with debounce
   */
  useEffect(() => {
    if (!autoDetect) {
      return;
    }

    // Clear the previous timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // No valid input: reset the state
    if (!base_url || !api_key) {
      setResult(null);
      setError(null);
      return;
    }

    // Start the debounce timer
    debounceTimerRef.current = setTimeout(() => {
      void detect(base_url, api_key);
    }, debounceMs);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [base_url, api_key, autoDetect, debounceMs, detect]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      requestVersionRef.current++;
    };
  }, []);

  return {
    isDetecting,
    result,
    error,
    detect,
    reset,
  };
}

export default useProtocolDetection;
