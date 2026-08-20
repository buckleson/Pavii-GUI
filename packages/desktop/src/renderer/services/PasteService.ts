/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FileMetadata } from './FileService';
import { getFileExtension, UPLOAD_ABORTED_ERROR, uploadFileViaHttp } from './FileService';
import { trackUpload, type UploadSource } from '@/renderer/hooks/file/useUploadState';

/**
 * Upload pasted bytes to the backend via HTTP multipart and return the absolute
 * file path stored on disk. Works the same in Electron and WebUI — the backend
 * is always reached over HTTP (the Electron preload injects `window.__backendPort`
 * so requests land on `http://127.0.0.1:<port>`; WebUI hits same-origin).
 *
 * Returns `null` when the upload is cancelled by the user (via the per-file
 * cancel button or a conversation switch); other errors propagate.
 */
async function createTempFile(
  file_name: string,
  data: Uint8Array,
  contentType: string,
  conversation_id?: string,
  source: UploadSource = 'sendbox'
): Promise<string | null> {
  const arrayBuf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const blob = new Blob([arrayBuf], { type: contentType });
  const file = new File([blob], file_name, { type: contentType });
  const controller = new AbortController();
  const tracker = trackUpload(file.size, {
    source,
    name: file_name,
    conversationId: conversation_id || undefined,
    onAbort: () => controller.abort(),
  });
  try {
    return await uploadFileViaHttp(file, conversation_id || '', tracker.onProgress, undefined, {
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.message === UPLOAD_ABORTED_ERROR) {
      return null;
    }
    throw error;
  } finally {
    tracker.finish();
  }
}

type PasteHandler = (event: React.ClipboardEvent | ClipboardEvent) => Promise<boolean>;

/**
 * Per-SendBox counter used to assign stable names to clipboard images. The
 * hook owns one instance and passes it into `handlePaste`, so sequence
 * numbers persist across multiple paste actions within the same mount.
 */
export type ImageCounter = { next: () => number };

// MIME type to file extension map
function getExtensionFromMimeType(mimeType: string): string {
  const mimeMap: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/bmp': '.bmp',
    'image/svg+xml': '.svg',
  };
  return mimeMap[mimeType] || '.png'; // Defaults to .png
}

// Browsers name clipboard images image.png / image.jpg and similar. Such names map one-to-one
// to the MIME type and carry no meaning, so they count as system defaults and we rename them.
const BROWSER_DEFAULT_IMAGE_NAME_RE = /^image\.(png|jpe?g|gif|webp|bmp|svg)$/i;
// Our own older default names, prefixed like `2024-01-02_03-04-05`.
const LEGACY_SYSTEM_GENERATED_NAME_RE = /^[a-zA-Z]?_?\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/;

function isSystemGeneratedImageName(name: string | undefined | null): boolean {
  if (!name) return true;
  return LEGACY_SYSTEM_GENERATED_NAME_RE.test(name) || BROWSER_DEFAULT_IMAGE_NAME_RE.test(name);
}

class PasteServiceClass {
  private handlers: Map<string, PasteHandler> = new Map();
  private lastFocusedComponent: string | null = null;
  private isInitialized = false;

  // Install the global paste listener
  init() {
    if (this.isInitialized) return;

    document.addEventListener('paste', this.handleGlobalPaste);
    this.isInitialized = true;
  }

  // Register a component's paste handler
  registerHandler(componentId: string, handler: PasteHandler) {
    this.handlers.set(componentId, handler);
  }

  // Unregister a component's paste handler
  unregisterHandler(componentId: string) {
    this.handlers.delete(componentId);
  }

  // Set the currently focused component
  setLastFocusedComponent(componentId: string) {
    this.lastFocusedComponent = componentId;
  }

  // Global paste event handler
  private handleGlobalPaste = async (event: ClipboardEvent) => {
    // When the paste target is editable (input/textarea/contentEditable), leave it to the browser so other inputs are not hijacked
    if (this.shouldAllowNativePaste(event)) {
      return;
    }

    if (!this.lastFocusedComponent) return;

    const handler = this.handlers.get(this.lastFocusedComponent);
    if (handler) {
      const handled = await handler(event);
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
  };

  private shouldAllowNativePaste(event: ClipboardEvent): boolean {
    const target = event.target;
    if (!target || !(target instanceof Element)) {
      return false;
    }

    const editableElement = target.closest('input, textarea, [contenteditable]');
    if (!editableElement) {
      return false;
    }

    if (editableElement instanceof HTMLInputElement || editableElement instanceof HTMLTextAreaElement) {
      return true;
    }

    if (editableElement instanceof HTMLElement) {
      if (editableElement.isContentEditable) {
        return true;
      }
      const attr = editableElement.getAttribute('contenteditable');
      return !!attr && attr.toLowerCase() !== 'false';
    }

    return false;
  }

  // Shared paste handling
  async handlePaste(
    event: React.ClipboardEvent | ClipboardEvent,
    supportedExts: string[],
    onFilesAdded: (files: FileMetadata[]) => void,
    onTextPaste?: (text: string) => void,
    conversation_id?: string,
    source: UploadSource = 'sendbox',
    imageCounter?: ImageCounter
  ): Promise<boolean> {
    // Stop propagation immediately so the global listener does not handle it twice
    event.stopPropagation();
    const clipboardText = event.clipboardData?.getData('text');
    const files = event.clipboardData?.files;
    // If caller passes an empty array, treat it as "allow all file types"
    const allowAll = !supportedExts || supportedExts.length === 0;

    // Files take precedence over text, so pasting a file does not also insert its name
    if (files && files.length > 0) {
      // Handle the files and skip text handling
      const fileList: FileMetadata[] = [];
      const usedFileNames = new Set<string>();
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const file_path = (file as File & { path?: string }).path;

        // Check for a file path (under Electron a File carries an extra path property)

        if (!file_path && file.type.startsWith('image/')) {
          // A clipboard image; check the type is supported
          const fileExt = getFileExtension(file.name) || getExtensionFromMimeType(file.type);

          if (allowAll || supportedExts.includes(fileExt)) {
            try {
              const arrayBuffer = await file.arrayBuffer();
              const uint8Array = new Uint8Array(arrayBuffer);

              // Generate a concise filename; replace system-generated default names.
              // Clipboard images usually carry a MIME default name like `image.png`, so prefer the caller's
              // incrementing imageCounter (unique across repeated pastes) and fall back to a timestamp
              // when no counter is supplied.
              const isSystemGenerated = isSystemGeneratedImageName(file.name);
              let file_name: string;
              if (!isSystemGenerated && file.name) {
                file_name = file.name;
              } else if (imageCounter) {
                file_name = `image-${imageCounter.next()}${fileExt}`;
              } else {
                const now = new Date();
                const timeStr = `${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;
                file_name = `pasted_image_${timeStr}${fileExt}`;
              }
              // Ensure unique filename within the same paste batch to prevent
              // collisions when multiple images are pasted simultaneously
              if (usedFileNames.has(file_name)) {
                const extIdx = file_name.lastIndexOf('.');
                const baseName = extIdx > 0 ? file_name.slice(0, extIdx) : file_name;
                const ext = extIdx > 0 ? file_name.slice(extIdx) : fileExt;
                let counter = 2;
                while (usedFileNames.has(`${baseName}_${counter}${ext}`)) {
                  counter++;
                }
                file_name = `${baseName}_${counter}${ext}`;
              }
              usedFileNames.add(file_name);

              // Upload to the backend and get an absolute path back (both Electron and WebUI use HTTP multipart)
              const tempPath = await createTempFile(file_name, uint8Array, file.type, conversation_id, source);

              if (tempPath) {
                fileList.push({
                  name: file_name,
                  path: tempPath,
                  size: file.size,
                  type: file.type,
                  lastModified: Date.now(),
                });
              }
            } catch (error) {
              if (error instanceof Error && error.message === 'FILE_TOO_LARGE') {
                throw error;
              }
              console.error('Failed to create the temp file:', error);
            }
          } else {
            // Unsupported type: skip without erroring and let later filtering deal with it
            console.warn(`Unsupported image type: ${file.type}, extension: ${fileExt}`);
          }
        } else if (file_path) {
          // Files that have a path (copied or dragged from a file manager)
          // Check the file type is supported
          const fileExt = getFileExtension(file.name);

          if (allowAll || supportedExts.includes(fileExt)) {
            // Upload rather than pass the raw device path: the chat send contract
            // sends attachments as `upload` refs and the backend rejects any path
            // outside its managed upload directory. Upload the blob to get a
            // managed path (createTempFile → /api/fs/upload, temp_dir/aionui/...).
            try {
              const arrayBuffer = await file.arrayBuffer();
              const uint8Array = new Uint8Array(arrayBuffer);
              let file_name = file.name;
              if (usedFileNames.has(file_name)) {
                const extIdx = file_name.lastIndexOf('.');
                const baseName = extIdx > 0 ? file_name.slice(0, extIdx) : file_name;
                const ext = extIdx > 0 ? file_name.slice(extIdx) : fileExt;
                let counter = 2;
                while (usedFileNames.has(`${baseName}_${counter}${ext}`)) {
                  counter++;
                }
                file_name = `${baseName}_${counter}${ext}`;
              }
              usedFileNames.add(file_name);

              const tempPath = await createTempFile(
                file_name,
                uint8Array,
                file.type || 'application/octet-stream',
                conversation_id,
                source
              );
              if (tempPath) {
                fileList.push({
                  name: file_name,
                  path: tempPath,
                  size: file.size,
                  type: file.type,
                  lastModified: Date.now(),
                });
              }
            } catch (error) {
              if (error instanceof Error && error.message === 'FILE_TOO_LARGE') {
                throw error;
              }
              console.error('Failed to upload the pasted file:', error);
            }
          } else {
            // Unsupported file type
            console.warn(`Unsupported file type: ${file.name}, extension: ${fileExt}`);
          }
        } else if (!file.type.startsWith('image/')) {
          // Non-image files without a path (copied from a file manager)
          const fileExt = getFileExtension(file.name);

          if (allowAll || supportedExts.includes(fileExt)) {
            // Copy-pasted files need a temp file created for them
            try {
              const arrayBuffer = await file.arrayBuffer();
              const uint8Array = new Uint8Array(arrayBuffer);

              // Ensure unique filename within the same paste batch
              let file_name = file.name;
              if (usedFileNames.has(file_name)) {
                const extIdx = file_name.lastIndexOf('.');
                const baseName = extIdx > 0 ? file_name.slice(0, extIdx) : file_name;
                const ext = extIdx > 0 ? file_name.slice(extIdx) : fileExt;
                let counter = 2;
                while (usedFileNames.has(`${baseName}_${counter}${ext}`)) {
                  counter++;
                }
                file_name = `${baseName}_${counter}${ext}`;
              }
              usedFileNames.add(file_name);

              const tempPath = await createTempFile(
                file_name,
                uint8Array,
                file.type || 'application/octet-stream',
                conversation_id,
                source
              );
              if (tempPath) {
                fileList.push({
                  name: file_name,
                  path: tempPath,
                  size: file.size,
                  type: file.type,
                  lastModified: Date.now(),
                });
              }
            } catch (error) {
              if (error instanceof Error && error.message === 'FILE_TOO_LARGE') {
                throw error;
              }
              console.error('Failed to create the temp file:', error);
            }
          } else {
            console.warn(`Unsupported file type: ${file.name}, extension: ${fileExt}`);
          }
        }
      }

      // Always return true after handling files, which prevents the text insert
      if (fileList.length > 0) {
        onFilesAdded(fileList);
      }
      return true; // Prevent the default so the file name is not inserted as text
    }

    // Plain-text paste (only when no files are present)
    if (clipboardText && (!files || files.length === 0)) {
      // On iOS let Safari handle plain-text paste itself, avoiding paste-menu and keyboard jitter
      const isIOS = typeof navigator !== 'undefined' && /iP(hone|ad|od)/.test(navigator.userAgent);
      if (isIOS) {
        return false;
      }
      if (onTextPaste) {
        // Strip redundant newlines, especially trailing ones
        const cleanedText = clipboardText.replace(/\n\s*$/, '');
        onTextPaste(cleanedText);
        return true; // Handled: prevent the default
      }
      return false; // No callback, so allow the default
    }

    return false;
  }

  // Release resources
  destroy() {
    if (this.isInitialized) {
      document.removeEventListener('paste', this.handleGlobalPaste);
      this.handlers.clear();
      this.lastFocusedComponent = null;
      this.isInitialized = false;
    }
  }
}

// Export the singleton instance
export const PasteService = new PasteServiceClass();
