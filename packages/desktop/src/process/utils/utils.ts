/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IDirOrFile } from '@/common/adapter/ipcBridge';
import { getPlatformServices } from '@/common/platform';
import { getEnvAwareName } from '@/common/config/appEnv';
import { existsSync, lstatSync, mkdirSync, readlinkSync, realpathSync, symlinkSync, unlinkSync } from 'fs';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
export const hasElectronAppPath = (): boolean => {
  return typeof process.versions.electron === 'string';
};

const getElectronPathOrFallback = (name: 'temp' | 'home' | 'userData'): string => {
  const paths = getPlatformServices().paths;
  switch (name) {
    case 'temp':
      return paths.getTempDir();
    case 'home':
      return paths.getHomeDir();
    case 'userData':
      return paths.getDataDir();
  }
};

export const getTempPath = () => {
  const rootPath = getElectronPathOrFallback('temp');
  return path.join(rootPath, 'aionui');
};

/**
 * Ensure CLI-safe symlink exists and return the symlink path.
 * On macOS, creates a symlink in home directory to avoid spaces in paths.
 * CLI tools like Qwen can't handle spaces in paths properly.
 *
 * Ensure the CLI-safe symlink exists and return its path.
 * On macOS a symlink is created in the home directory to avoid spaces in the path.
 * CLI tools such as Qwen cannot handle spaces in paths correctly.
 */
const ensureCliSafeSymlink = (targetPath: string, symlinkName: string): string => {
  // Only needed when the platform explicitly requires CLI-safe symlinks
  // (Electron on macOS, where userData lives under "Application Support" which contains spaces)
  if (!getPlatformServices().paths.needsCliSafeSymlinks()) {
    return targetPath;
  }

  const homePath = getElectronPathOrFallback('home');
  const symlinkPath = path.join(homePath, symlinkName);

  // Ensure symlink exists
  try {
    const stats = lstatSync(symlinkPath);
    if (stats.isSymbolicLink()) {
      // Symlink exists, verify it points to the correct location
      const target = readlinkSync(symlinkPath);
      if (target === targetPath) {
        // Ensure the target directory still exists (broken symlink if deleted, #841)
        if (!existsSync(targetPath)) {
          mkdirSync(targetPath, { recursive: true });
        }
        return symlinkPath;
      }
      // Wrong target, remove and recreate
      unlinkSync(symlinkPath);
    } else if (stats.isDirectory()) {
      // Real directory exists, don't touch it
      return targetPath;
    } else {
      // Regular file blocking the symlink path (#841), remove it
      unlinkSync(symlinkPath);
    }
  } catch {
    // Symlink doesn't exist, create it
  }

  try {
    // Ensure the target directory exists first
    if (!existsSync(targetPath)) {
      mkdirSync(targetPath, { recursive: true });
    }
    symlinkSync(targetPath, symlinkPath);
    return symlinkPath;
  } catch (error) {
    return targetPath;
  }
};

/**
 * Get data path, using CLI-safe symlink on macOS.
 * Release builds use ~/.pavii; dev builds use ~/.pavii-dev.
 * Path of the data directory; a symlink on macOS.
 * Release uses ~/.pavii; dev mode uses ~/.pavii-dev.
 */
export const getDataPath = (): string => {
  const rootPath = getElectronPathOrFallback('userData');
  const dataPath = path.join(rootPath, 'pavii');
  return ensureCliSafeSymlink(dataPath, getEnvAwareName('.pavii'));
};

/**
 * Get config path, using CLI-safe symlink on macOS.
 * Release builds use ~/.pavii-config; dev builds use ~/.pavii-config-dev.
 * Path of the config directory; a symlink on macOS.
 * Release uses ~/.pavii-config; dev mode uses ~/.pavii-config-dev.
 */
export const getConfigPath = (): string => {
  const rootPath = getElectronPathOrFallback('userData');
  const configPath = path.join(rootPath, 'config');
  return ensureCliSafeSymlink(configPath, getEnvAwareName('.pavii-config'));
};

/**
 * Resolve a user-chosen path back to its CLI-safe symlink when it matches
 * the real target of a known default path.
 * On macOS the file picker resolves symlinks, so a round-trip migration
 * (away → back) would store the real path (with spaces) instead of the
 * symlink path. This function detects that and returns the symlink path.
 *
 * When a user-picked path equals a default path's real target, return the symlink path.
 * The macOS file picker resolves symlinks, so a round-trip migration would store the real path with spaces.
 */
export const resolveCliSafePath = (inputPath: string, defaultPath: string): string => {
  try {
    const resolvedInput = realpathSync(path.resolve(inputPath));
    const resolvedDefault = realpathSync(path.resolve(defaultPath));
    if (resolvedInput === resolvedDefault) {
      return defaultPath;
    }
  } catch {
    // Path doesn't exist yet or can't be resolved — use as-is
  }
  return inputPath;
};

export const generateHashWithFullName = (fullName: string): string => {
  let hash = 0;
  for (let i = 0; i < fullName.length; i++) {
    const char = fullName.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  // Take the absolute value, convert to hex, keep the first 8 chars
  return Math.abs(hash).toString(16).padStart(8, '0'); //.slice(0, 8);
};

// Recursively read directory contents into a tree structure
export async function readDirectoryRecursive(
  dirPath: string,
  options?: {
    root?: string;
    abortController?: AbortController;
    fileService?: { shouldIgnoreFile(path: string): boolean };
    maxDepth?: number;
    search?: {
      text: string;
      onProcess?(result: { file: number; dir: number; match?: IDirOrFile }): void;
      process?: { file: number; dir: number };
    };
  }
): Promise<IDirOrFile> {
  const { root = dirPath, maxDepth = 1, fileService, search, abortController } = options || {};
  const { text: searchText, onProcess: onSearchProcess = () => {}, process = { file: 0, dir: 1 } } = search || {};

  const matchSearch = searchText ? (fullPath: string) => fullPath.includes(searchText) : (_: string) => false;

  const checkStatus = () => {
    if (abortController?.signal.aborted) throw new Error('readDirectoryRecursive aborted!');
  };

  try {
    const stats = await fs.stat(dirPath);
    if (!stats.isDirectory()) {
      return null;
    }
  } catch {
    // Directory may have been deleted (e.g. cleaned-up temp workspace)
    return null;
  }
  const result: IDirOrFile = {
    name: path.basename(dirPath),
    fullPath: dirPath,
    relativePath: path.relative(root, dirPath),
    isDir: true,
    isFile: false,
    children: [],
  };
  let searchResult = matchSearch(result.name);
  onSearchProcess({
    ...process,
    match: searchResult ? result : undefined,
  });
  if (maxDepth === 0 || searchResult) return result;
  checkStatus();
  let items: string[];
  try {
    items = await fs.readdir(dirPath);
  } catch {
    // Permission denied (EPERM/EACCES) or other fs errors — skip this directory
    return result;
  }
  checkStatus();

  for (const item of items) {
    checkStatus();
    if (item === 'node_modules') continue;
    const itemPath = path.join(dirPath, item);
    if (fileService && fileService.shouldIgnoreFile(itemPath)) continue;

    let itemStats: Awaited<ReturnType<typeof fs.stat>>;
    try {
      itemStats = await fs.stat(itemPath);
    } catch {
      // File may have been deleted between readdir and stat (race condition)
      continue;
    }
    if (itemStats.isDirectory()) {
      process.dir += 1;
      const child = await readDirectoryRecursive(itemPath, {
        ...options,
        maxDepth: searchText ? maxDepth : maxDepth - 1,
        root,
        search: {
          ...search,
          process,
          onProcess(searchResult) {
            if (searchResult.match) {
              if (!result.children.find((v) => v.fullPath === searchResult.match.fullPath)) {
                result.children.push(searchResult.match);
              }
              onSearchProcess({ ...process, match: result });
            }
          },
        },
      });
      if (child && !searchText) {
        result.children.push(child);
      }
    } else {
      const children = {
        name: item,
        relativePath: path.relative(root, itemPath),
        fullPath: itemPath,
        isDir: false,
        isFile: true,
      };
      if (!searchText) {
        result.children.push(children);
        continue;
      }
      searchResult = matchSearch(children.name);
      if (searchResult) {
        result.children.push(children);
      }
      process.file += 1;
      onSearchProcess({
        ...process,
        match: searchResult ? result : undefined,
      });
    }
  }
  result.children.sort((a, b) => {
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;
    return a.name.localeCompare(b.name);
  });
  return result;
}

/**
 * Recursively copy a directory
 * Note: includes path validation preventing copies into itself or a subdirectory, which would recurse forever (fixes the Windows cache-directory loop bug)
 */
interface CopyOptions {
  overwrite?: boolean;
}

export async function copyDirectoryRecursively(src: string, dest: string, options: CopyOptions = {}) {
  const { overwrite = true } = options;

  // Normalize paths: lowercase on Windows (case-insensitive), unchanged on Unix/macOS (case-sensitive)
  const isWindows = process.platform === 'win32';
  const normalizedSrc = isWindows ? path.resolve(src).toLowerCase() : path.resolve(src);
  const normalizedDest = isWindows ? path.resolve(dest).toLowerCase() : path.resolve(dest);

  // Prevent copying onto itself (F:\code -> F:\code)
  if (normalizedSrc === normalizedDest) {
    throw new Error(`Cannot copy directory into itself: ${src}`);
  }

  // Prevent copying into a subdirectory (F:\code -> F:\code\cache) - would recurse forever
  if (normalizedDest.startsWith(normalizedSrc + path.sep)) {
    throw new Error(`Cannot copy directory into its subdirectory: ${src} -> ${dest}`);
  }

  // Prevent copying into a parent directory (F:\code\cache -> F:\code)
  if (normalizedSrc.startsWith(normalizedDest + path.sep)) {
    throw new Error(`Cannot copy parent directory into child directory: ${src} -> ${dest}`);
  }

  if (!existsSync(dest)) {
    await fs.mkdir(dest, { recursive: true });
  }

  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      if (!existsSync(destPath)) {
        await fs.mkdir(destPath, { recursive: true });
      }
      await copyDirectoryRecursively(srcPath, destPath, options);
    } else {
      // Without overwrite, skip files that already exist at the target
      if (!overwrite && existsSync(destPath)) {
        continue;
      }
      await fs.copyFile(srcPath, destPath);
    }
  }
}

// Verify the two directories share the same filename structure
export async function verifyDirectoryFiles(dir1: string, dir2: string): Promise<boolean> {
  try {
    if (!existsSync(dir1) || !existsSync(dir2)) {
      return false;
    }

    const entries1 = await fs.readdir(dir1, { withFileTypes: true });
    const entries2 = await fs.readdir(dir2, { withFileTypes: true });

    if (entries1.length !== entries2.length) {
      return false;
    }

    entries1.sort((a, b) => a.name.localeCompare(b.name));
    entries2.sort((a, b) => a.name.localeCompare(b.name));

    for (let i = 0; i < entries1.length; i++) {
      const entry1 = entries1[i];
      const entry2 = entries2[i];

      if (entry1.name !== entry2.name || entry1.isDirectory() !== entry2.isDirectory()) {
        return false;
      }

      if (entry1.isDirectory()) {
        const path1 = path.join(dir1, entry1.name);
        const path2 = path.join(dir2, entry2.name);
        if (!(await verifyDirectoryFiles(path1, path2))) {
          return false;
        }
      }
    }

    return true;
  } catch (error) {
    console.warn('[AionUi] Error verifying directory files:', error);
    return false;
  }
}

export const copyFilesToDirectory = async (
  dir: string,
  files?: string[],
  skipCleanup = false,
  cacheDir?: string
): Promise<string[]> => {
  if (!files) return [];

  const tempDir = cacheDir ? path.join(cacheDir, 'temp') : null;
  const copiedFiles: string[] = [];
  const resolvedDir = path.resolve(dir);

  for (const file of files) {
    // Ensure the file path is absolute
    const absoluteFilePath = path.isAbsolute(file) ? file : path.resolve(file);

    // Check the source file exists
    try {
      await fs.access(absoluteFilePath);
    } catch (error) {
      console.warn(`[AionUi] Source file does not exist, skipping: ${absoluteFilePath}`);
      console.warn(`[AionUi] Original path: ${file}`);
      // Skip missing files instead of throwing
      continue;
    }

    // Skip files that are already inside the target directory to avoid duplicates
    // Skip files already inside the target directory to avoid duplicate copies
    const resolvedFile = path.resolve(absoluteFilePath);
    if (resolvedFile.startsWith(resolvedDir + path.sep)) {
      copiedFiles.push(absoluteFilePath);
      continue;
    }

    // Use original filename, only add unique suffix when destination exists
    let file_name = path.basename(absoluteFilePath);
    let destPath = path.join(dir, file_name);

    // If destination exists, add timestamp suffix to avoid overwriting
    if (existsSync(destPath)) {
      const ext = path.extname(file_name);
      const baseName = path.basename(file_name, ext);
      file_name = `${baseName}_${Date.now()}${ext}`;
      destPath = path.join(dir, file_name);
    }

    try {
      await fs.copyFile(absoluteFilePath, destPath);
      copiedFiles.push(destPath);
    } catch (error) {
      console.error(`[AionUi] Failed to copy file from ${absoluteFilePath} to ${destPath}:`, error);
      // Continue with the remaining files rather than failing outright
    }

    // Temp files are deleted once the copy completes
    if (tempDir && absoluteFilePath.startsWith(tempDir) && !skipCleanup) {
      try {
        await fs.unlink(absoluteFilePath);
      } catch (error) {
        console.warn(`Failed to cleanup temp file ${absoluteFilePath}:`, error);
      }
    }
  }

  return copiedFiles;
};

export function ensureDirectory(dirPath: string): void {
  try {
    const stats = lstatSync(dirPath);
    if (stats.isDirectory()) {
      return;
    }
    if (stats.isSymbolicLink()) {
      // Verify symlink target actually exists (#841 - broken symlink)
      if (existsSync(dirPath)) {
        return;
      }
      // Broken symlink, remove so mkdirSync can work on the real path
      unlinkSync(dirPath);
    } else {
      // Regular file blocking the directory path (#841), remove it
      unlinkSync(dirPath);
    }
  } catch {
    // Path doesn't exist, create it
  }
  mkdirSync(dirPath, { recursive: true });
}
