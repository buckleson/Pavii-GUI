/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PreviewContentType } from '@/common/types/office/preview';

/**
 * 文件扩展名到内容类型的映射配置
 * Mapping configuration from file extensions to content types
 */
export const FILE_EXTENSION_MAP: Record<PreviewContentType, readonly string[]> = {
  markdown: ['md', 'markdown', 'mdown', 'mkd'],
  html: ['html', 'htm'],
  pdf: ['pdf'],
  // Only what officecli actually renders. `.doc/.odt` moved to `unsupported`:
  // routing them here produced a failure that told the user to install officecli,
  // which does not help for a format it cannot open.
  word: ['docx'],
  ppt: ['pptx'],
  excel: ['xlsx'],
  // CSV is plain text, and officecli rejects it outright — so it reads as text
  // rather than failing in a spreadsheet renderer.
  csv: ['csv'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'tif', 'tiff', 'avif'],
  code: [], // code is the default type, no explicit mapping needed
  diff: ['diff', 'patch'],
  /**
   * Identifiable but genuinely unrenderable here — say so, and offer the escape
   * hatch, instead of failing inside a renderer that never had a chance:
   *
   * - `doc/xls/ppt` legacy Office binaries and `odt/ods/odp` ODF: officecli only
   *   handles the OOXML trio.
   * - `docm/xlsm/pptm` macro-enabled: officecli's factory claims them, but its
   *   watch path accepts only pptx/docx/xlsx, so they fail on startup instead.
   * - `heic`: Chromium has no HEVC decoder (licensing), so mapping it to `image`
   *   yields a broken-image placeholder with no explanation — strictly worse than
   *   saying it is unsupported.
   */
  unsupported: ['doc', 'xls', 'ppt', 'odt', 'ods', 'odp', 'docm', 'xlsm', 'pptm', 'heic'],
  url: [], // url type for web preview, no extension mapping
  browser: [], // browser type for in-app browser tabs, no extension mapping
};

/**
 * 从文件路径中提取文件扩展名
 * Extract file extension from file path
 *
 * @param file_path File path
 * @returns File extension in lowercase, or empty string if no extension
 *
 * @example
 * ```ts
 * getFileExtension('document.pdf') // => 'pdf'
 * getFileExtension('archive.tar.gz') // => 'gz'
 * getFileExtension('noextension') // => ''
 * getFileExtension('image.PNG') // => 'png'
 * ```
 */
export const getFileExtension = (file_path: string): string => {
  if (!file_path) return '';

  const lastDotIndex = file_path.lastIndexOf('.');
  // 没有点号，或点号在最后（如 "file."），返回空字符串
  // No dot, or dot at the end (e.g., "file."), return empty string
  if (lastDotIndex === -1 || lastDotIndex === file_path.length - 1) {
    return '';
  }

  return file_path.substring(lastDotIndex + 1).toLowerCase();
};

/**
 * 根据文件扩展名确定预览内容类型
 * Determine preview content type based on file extension
 *
 * @param file_path File path
 * @returns Preview content type
 *
 * @example
 * ```ts
 * getContentTypeByExtension('README.md') // => 'markdown'
 * getContentTypeByExtension('index.html') // => 'html'
 * getContentTypeByExtension('report.pdf') // => 'pdf'
 * getContentTypeByExtension('script.ts') // => 'code'
 * getContentTypeByExtension('image.png') // => 'image'
 * ```
 */
export const getContentTypeByExtension = (file_path: string): PreviewContentType => {
  const ext = getFileExtension(file_path);
  if (!ext) return 'code'; // No extension, default to code

  // Iterate through mapping to find matching content type
  for (const [contentType, extensions] of Object.entries(FILE_EXTENSION_MAP)) {
    if (extensions.includes(ext)) {
      return contentType as PreviewContentType;
    }
  }

  // No matching extension found, default to code
  return 'code';
};

/**
 * 检查文件是否为图片类型
 * Check if file is an image type
 *
 * @param file_path File path
 * @returns Whether it's an image
 */
export const isImageFile = (file_path: string): boolean => {
  return getContentTypeByExtension(file_path) === 'image';
};

/**
 * 检查文件是否为文本类型（可编辑）
 * Check if file is a text type (editable)
 *
 * @param file_path File path
 * @returns Whether it's a text type
 */
export const isTextFile = (file_path: string): boolean => {
  const contentType = getContentTypeByExtension(file_path);
  return ['markdown', 'html', 'code', 'csv'].includes(contentType);
};

/**
 * 检查文件是否为 Office 文档类型
 * Check if file is an Office document type
 *
 * @param file_path File path
 * @returns Whether it's an Office document
 */
export const isOfficeFile = (file_path: string): boolean => {
  const contentType = getContentTypeByExtension(file_path);
  return ['word', 'excel', 'ppt'].includes(contentType);
};
