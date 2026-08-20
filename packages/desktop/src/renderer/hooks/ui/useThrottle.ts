import type React from 'react';
import { useCallback, useEffect, useRef } from 'react';

/**
 * Throttle hook
 * @param callback The function to throttle
 * @param delay Throttle interval in milliseconds
 * @returns The throttled function
 */
function useThrottle<T extends (...args: any[]) => any>(callback: T, delay: number, deps: React.DependencyList): T {
  const lastExecTime = useRef<number>(0);
  const timeoutId = useRef<NodeJS.Timeout | null>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (timeoutId.current) {
        clearTimeout(timeoutId.current);
        timeoutId.current = null;
      }
    };
  }, []);

  const throttledFunction = useCallback(
    (...args: Parameters<T>) => {
      const now = Date.now();
      const timeSinceLastExec = now - lastExecTime.current;

      // Past the interval since the last call: run immediately
      if (timeSinceLastExec >= delay) {
        callback(...args);
        lastExecTime.current = now;
      } else {
        // Otherwise replace the pending timer
        if (timeoutId.current) {
          clearTimeout(timeoutId.current);
        }

        timeoutId.current = setTimeout(() => {
          callback(...args);
          lastExecTime.current = Date.now();
          timeoutId.current = null;
        }, delay - timeSinceLastExec);
      }
    },
    [delay, ...deps]
  );

  return throttledFunction as T;
}

export default useThrottle;
