/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Type definitions for message tool results
 * Message tool result type definitions
 */

export interface ImageGenerationResult {
  img_url?: string;
  relative_path?: string;
  error?: string;
}

export interface WriteFileResult {
  file_diff: string;
  file_name: string;
  [key: string]: unknown;
}
