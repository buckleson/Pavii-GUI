/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Parse file path from diff content
 *
 * Supports several diff formats:
 * - Index: path/to/file.tsx
 * - --- a/path/to/file.tsx
 * - +++ b/path/to/file.tsx
 *
 * @param diffContent The diff content
 * @returns The relative file path, or null when it cannot be parsed
 */
export function parseFilePathFromDiff(diffContent: string): string | null {
  const lines = diffContent.split('\n');

  // Try the Index: form (SVN style)
  for (const line of lines) {
    if (line.startsWith('Index: ')) {
      return line.substring(7).trim();
    }
  }

  // Try the git diff form, preferring +++ b/ because it names the new file
  for (const line of lines) {
    if (line.startsWith('+++ b/')) {
      return line.substring(6).trim();
    }
  }

  // Fall back to the --- a/ form
  for (const line of lines) {
    if (line.startsWith('--- a/')) {
      return line.substring(6).trim();
    }
  }

  return null;
}

/**
 * Extract actual file content from diff (remove metadata)
 *
 * @param diffContent The diff content
 * @returns The extracted file content, without diff markers
 */
export function extractContentFromDiff(diffContent: string): string {
  const lines = diffContent.split('\n');
  const contentLines: string[] = [];
  let inDiffBlock = false;

  for (const line of lines) {
    // Skip diff metadata lines
    if (
      line.startsWith('Index:') ||
      line.match(/^={3,}/) ||
      line.startsWith('diff --git') ||
      line.startsWith('---') ||
      line.startsWith('+++') ||
      line.startsWith('@@')
    ) {
      inDiffBlock = true;
      continue;
    }

    if (inDiffBlock) {
      // Extract added lines (remove leading +)
      if (line.startsWith('+')) {
        contentLines.push(line.substring(1));
      }
      // Skip deleted lines and context markers
      else if (line.startsWith('-') || line.startsWith('\\')) {
        continue;
      }
      // Keep empty lines too
      else {
        contentLines.push(line);
      }
    }
  }

  return contentLines.join('\n').trim();
}

/**
 * File change info including diff content
 */
export interface FileChangeInfo {
  /** File name */
  file_name: string;
  /** Full path */
  fullPath: string;
  /** Number of insertions */
  insertions: number;
  /** Number of deletions */
  deletions: number;
  /** Raw diff content */
  diff: string;
}

/**
 * Parse unified diff format, extract file info and change statistics
 *
 * @param diff Unified diff string
 * @param file_nameHint Optional filename hint when diff header is missing
 * @returns Parsed file change info
 */
export const parseDiff = (diff: string, file_nameHint?: string): FileChangeInfo => {
  const lines = diff.split('\n');

  // Extract filename
  const gitLine = lines.find((line) => line.startsWith('diff --git'));
  let file_name = file_nameHint || 'Unknown file';
  let fullPath = file_nameHint || 'Unknown file';

  if (gitLine) {
    const match = gitLine.match(/diff --git a\/(.+) b\/(.+)/);
    if (match) {
      fullPath = match[1];
      file_name = fullPath.split('/').pop() || fullPath;
    }
  } else {
    const parsedPath = parseFilePathFromDiff(diff);
    if (parsedPath) {
      fullPath = parsedPath;
      file_name = parsedPath.split(/[\\/]/).pop() || parsedPath;
    } else if (file_nameHint) {
      file_name = file_nameHint.split(/[\\/]/).pop() || file_nameHint;
      fullPath = file_nameHint;
    }
  }

  // Calculate insertions and deletions
  let insertions = 0;
  let deletions = 0;

  for (const line of lines) {
    // Skip diff header lines
    if (
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('---') ||
      line.startsWith('+++') ||
      line.startsWith('@@') ||
      line.startsWith('\\')
    ) {
      continue;
    }

    if (line.startsWith('+')) {
      insertions++;
    } else if (line.startsWith('-')) {
      deletions++;
    }
  }

  return {
    file_name,
    fullPath,
    insertions,
    deletions,
    diff,
  };
};
