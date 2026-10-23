/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'node:child_process';
import { RECOMMENDED_TOOLS_ENV } from '@/common/types/agent/recommendedTools';

const OUTPUT_TAIL_LINES = 20;

export type RunResult = { code: number; output: string; timedOut: boolean };

/** Last {@link OUTPUT_TAIL_LINES} lines of `text`. */
export const tail = (text: string): string => text.trim().split(/\r?\n/).slice(-OUTPUT_TAIL_LINES).join('\n');

/** Environment for every command run for the recommended tools: telemetry and update checks off. */
export const toolEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  ...process.env,
  ...RECOMMENDED_TOOLS_ENV,
  ...extra,
});

/**
 * Run `file` with `args`. Only a Windows `.cmd` launcher (npm.cmd) gets a
 * shell, because Node refuses to spawn batch files without one; then
 * arguments with spaces are quoted, as `shell: true` joins them with spaces.
 */
export const runFile = (
  file: string,
  args: string[],
  options: { timeoutMs: number; env?: Record<string, string> }
): Promise<RunResult> =>
  new Promise((resolve) => {
    const useShell = process.platform === 'win32' && /\.cmd$/i.test(file);
    const quote = (value: string) => (useShell && value.includes(' ') ? `"${value}"` : value);
    execFile(
      quote(file),
      useShell ? args.map(quote) : args,
      {
        timeout: options.timeoutMs,
        shell: useShell,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
        env: toolEnv(options.env),
      },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
        resolve({ code, output: tail(`${String(stdout)}\n${String(stderr)}`), timedOut: Boolean(error?.killed) });
      }
    );
  });
