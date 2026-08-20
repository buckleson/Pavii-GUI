/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { joinPath } from '@/common/chat/chatLib';
import { localFileRef } from '@/common/types/chatFile';
import type { PreviewContentType } from '@/common/types/office/preview';
import { useConversationContextSafe } from '@/renderer/hooks/context/ConversationContext';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview';
import { resolvePreviewPayload, upgradeFileRef } from '@/renderer/utils/file/previewPayload';
import { getCurrentProject } from '@/renderer/pages/conversation/explorer/currentProjectStore';
import { classifyPreviewError, type PreviewErrorKind } from '@/renderer/utils/previewError';
import { useCallback, useState } from 'react';

/**
 * Preview launch options
 */
interface PreviewLaunchOptions {
  /** Workspace-relative path */
  relativePath?: string;
  /** Fallback path (absolute or provided path) */
  originalPath?: string;
  /** File name */
  file_name?: string;
  /** Preview title */
  title?: string;
  /** Code language (for syntax highlighting) */
  language?: string;
  /** Content type */
  contentType: PreviewContentType;
  /** Whether editable */
  editable: boolean;
  /** Use this content if file read fails (editable) */
  fallbackContent?: string;
  /** Read-only diff fallback */
  diffContent?: string;
}

/**
 * 统一的预览面板打开逻辑
 * Shared preview launcher logic for components that need edit/preview buttons
 *
 * Processing flow:
 * Editable files: try reading actual file content first
 * Read failed: use fallbackContent as fallback
 * Non-editable: show diffContent (read-only)
 *
 * @returns {{ launchPreview: Function, loading: boolean }}
 */
export const usePreviewLauncher = () => {
  const conversationContext = useConversationContextSafe();
  const workspace = conversationContext?.workspace;
  const { openPreview } = usePreviewContext();
  const [loading, setLoading] = useState(false);
  const [errorKind, setErrorKind] = useState<PreviewErrorKind | null>(null);

  /**
   * Launch preview panel
   */
  const launchPreview = useCallback(
    async ({
      relativePath,
      originalPath,
      file_name,
      title,
      language,
      contentType,
      editable,
      fallbackContent,
      diffContent,
    }: PreviewLaunchOptions) => {
      setLoading(true);
      setErrorKind(null);

      // Path resolution
      // Prefer workspace + relative path to build absolute path
      const absolutePath = workspace && relativePath ? joinPath(workspace, relativePath) : undefined;
      const resolvedPath = absolutePath || originalPath || relativePath || undefined;
      // Backend-host absolute path (agent workspace file, no pe identity) → a Local
      // ChatFileRef for content I/O over /api/fs/content. Only when we have an
      // absolute-ish path to read (a bare relativePath can't resolve on the backend).
      const readPath = absolutePath || originalPath;
      // Upgraded to a project identity where possible, so a file opened from a tool
      // card and the same file opened from the explorer are one tab, and this one can
      // receive change signals too.
      const fileRef = readPath ? await upgradeFileRef(localFileRef(readPath), getCurrentProject()) : undefined;

      // Compute file name and title
      const computedFileName =
        file_name || (relativePath ? relativePath.split(/[\\/]/).pop() || relativePath : undefined);
      const previewTitle = title || computedFileName || relativePath || contentType.toUpperCase();

      // Preview metadata
      const metadata = {
        title: previewTitle,
        file_name: computedFileName || previewTitle,
        fileRef,
        file_path: resolvedPath,
        workspace,
        language,
      };

      // Optimistic preview: Show fallback content immediately if available
      let hasOpened = false;
      if (typeof fallbackContent === 'string') {
        openPreview(fallbackContent, contentType, {
          ...metadata,
          editable,
        });
        hasOpened = true;
      }

      try {
        // Try to read actual file content (override optimistic preview)
        if (fileRef) {
          try {
            // 单一判定点：取一次 metadata 拿到 size（判上限）与 lastModified（保存时的
            // If-Match 条件），超限则完全不读内容。
            // Single decision point: one metadata call yields size (ceiling check)
            // and lastModified (the save-time If-Match); oversized files are never read.
            const payload = await resolvePreviewPayload(fileRef, contentType);

            openPreview(payload.content, contentType, {
              ...metadata,
              // 超限文件只读：没有内容可编辑，也没有半截内容可被写回。
              // Oversized files are read-only: no content to edit, and no partial
              // content that could be written back over the full file.
              editable: payload.oversized ? false : editable,
              oversized: payload.oversized,
              sizeBytes: payload.sizeBytes,
              thresholdBytes: payload.thresholdBytes,
              lastModified: payload.lastModified,
            });
            return;
          } catch (error) {
            // 读取失败，如果已经显示了乐观预览，则只记录警告
            // Read failed, log warning if optimistic preview is already shown
            setErrorKind(classifyPreviewError(error));
            if (!hasOpened) {
              return;
            }
          }
        }

        // If not opened and file read failed, handle fallback cases
        if (!hasOpened) {
          // Show diff content (read-only)
          if (diffContent) {
            openPreview(diffContent, 'diff', {
              ...metadata,
              editable: false,
            });
            return;
          }
        }
      } catch (error) {
        setErrorKind(classifyPreviewError(error));
        console.error('[usePreviewLauncher] Failed to open preview:', error);
      } finally {
        setLoading(false);
      }
    },
    [workspace, openPreview]
  );

  return { launchPreview, loading, errorKind };
};

export type { PreviewLaunchOptions };
