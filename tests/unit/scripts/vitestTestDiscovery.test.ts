/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */
import { globSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import vitestConfig from '../../../vitest.config';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Directories that never hold source we ship, plus `.claude`, which checks out
 * agent worktrees. `.cache` is bun's package store: it lives inside the repo and
 * holds several hundred dependency test files, which are no more ours than the
 * ones under node_modules.
 */
const SKIP_DIRECTORIES = new Set([
  '.cache',
  '.claude',
  '.git',
  '.vite',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'release',
]);

/** Path prefixes whose tests are run by a different runner than the root vitest config. */
const OTHER_RUNNER_PREFIXES = [
  // mobile/package.json runs these with jest.
  'mobile/',
  // packages/web-host/vitest.config.ts covers this package's own tests/ directory.
  'packages/web-host/tests/',
  // Vendored upstream projects (the engine, echarts, gemini-cli-pro) that ship
  // their own suites and their own runners. We build the engine from here but do
  // not own or run its tests from this config; `cargo test` covers the Rust side.
  'the-remaa/',
  // Vendored oxlint plugin (dmmulroy/anti-slop). Its rule tests belong to the
  // upstream project and run under its own toolchain; we consume the rules only.
  'tools/oxlint/anti-slop/',
];

/** File suffixes whose tests are run by a different runner than the root vitest config. */
const OTHER_RUNNER_SUFFIXES = [
  // package.json "test:bun" runs these with `bun test`.
  '.bun.test.ts',
];

type ProjectConfig = { test?: { name?: string; include?: string[]; exclude?: string[] } };

const toPosix = (relativePath: string): string => relativePath.split(path.sep).join('/');

const isTestFile = (fileName: string): boolean =>
  fileName.endsWith('.test.ts') || fileName.endsWith('.test.tsx') || /^test_.*\.ts$/.test(fileName);

const isOwnedByAnotherRunner = (relativePath: string): boolean =>
  OTHER_RUNNER_PREFIXES.some((prefix) => relativePath.startsWith(prefix)) ||
  OTHER_RUNNER_SUFFIXES.some((suffix) => relativePath.endsWith(suffix));

/** Every test file on disk, relative to the repository root. */
function findTestFilesOnDisk(directory: string, results: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      findTestFilesOnDisk(path.join(directory, entry.name), results);
      continue;
    }
    if (entry.isFile() && isTestFile(entry.name)) {
      results.push(toPosix(path.relative(REPO_ROOT, path.join(directory, entry.name))));
    }
  }
  return results;
}

/** Every test file the root vitest config actually collects, relative to the repository root. */
function findTestFilesInConfig(): Set<string> {
  const projects = (vitestConfig.test?.projects ?? []) as ProjectConfig[];
  const collected = new Set<string>();

  for (const project of projects) {
    const include = project.test?.include ?? [];
    const exclude = project.test?.exclude ?? [];
    if (include.length === 0) continue;

    const excluded = new Set(globSync(exclude, { cwd: REPO_ROOT }).map(toPosix));
    for (const match of globSync(include, { cwd: REPO_ROOT })) {
      const relativePath = toPosix(match);
      if (!excluded.has(relativePath)) collected.add(relativePath);
    }
  }

  return collected;
}

describe('vitest test discovery', () => {
  it('collects every test file that is not owned by another runner', () => {
    const collected = findTestFilesInConfig();
    const orphans = findTestFilesOnDisk(REPO_ROOT)
      .filter((relativePath) => !isOwnedByAnotherRunner(relativePath))
      .filter((relativePath) => !collected.has(relativePath));

    expect(orphans).toEqual([]);
  });

  it('has at least one include pattern per project', () => {
    const projects = (vitestConfig.test?.projects ?? []) as ProjectConfig[];

    expect(projects.length).toBeGreaterThan(0);
    for (const project of projects) {
      expect(project.test?.include ?? []).not.toHaveLength(0);
    }
  });
});
