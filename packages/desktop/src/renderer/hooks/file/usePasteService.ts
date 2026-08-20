import type { FileMetadata } from '@/renderer/services/FileService';
import type { UploadSource } from '@/renderer/hooks/file/useUploadState';
import type { ImageCounter } from '@/renderer/services/PasteService';
import { PasteService } from '@/renderer/services/PasteService';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Message } from '@arco-design/web-react';
import { uuid } from '@renderer/utils/common';

interface UsePasteServiceProps {
  supportedExts: string[];
  onFilesAdded?: (files: FileMetadata[]) => void;
  onTextPaste?: (text: string) => void;
  /** Conversation ID for WebUI file uploads */
  conversation_id?: string;
  source?: UploadSource;
}

/**
 * Shared PasteService integration hook
 * Gives every component the same paste handling
 */
export const usePasteService = ({
  supportedExts,
  onFilesAdded,
  onTextPaste,
  conversation_id,
  source = 'sendbox',
}: UsePasteServiceProps) => {
  const { t } = useTranslation();
  const componentId = useRef('paste-service-' + uuid(4)).current;

  // Pasted-image counter kept across handlePaste calls. Its lifetime is the hook instance, i.e.
  // one SendBox mount, so each SendBox counts independently and a remount resets to zero, which is acceptable.
  const pastedImageCounter = useRef(0);
  const imageCounter = useMemo<ImageCounter>(
    () => ({
      next: () => ++pastedImageCounter.current,
    }),
    []
  );

  // Shared paste event handling
  const handlePaste = useCallback(
    async (event: React.ClipboardEvent) => {
      // Files present: prevent the default immediately
      const files = event.clipboardData?.files;
      if (files && files.length > 0) {
        event.preventDefault();
        event.stopPropagation();
      }

      try {
        const handled = await PasteService.handlePaste(
          event,
          supportedExts,
          onFilesAdded || (() => {}),
          onTextPaste,
          conversation_id,
          source,
          imageCounter
        );
        if (handled && (!files || files.length === 0)) {
          // Also prevent the default when a non-file paste was handled (plain text, say)
          event.preventDefault();
          event.stopPropagation();
        }
        return handled;
      } catch (err) {
        Message.error(t('common.fileAttach.failed'));
        return false;
      }
    },
    [conversation_id, source, supportedExts, onFilesAdded, onTextPaste, imageCounter, t]
  );

  // Focus handling
  const handleFocus = useCallback(() => {
    PasteService.setLastFocusedComponent(componentId);
  }, [componentId]);

  // Register the paste handler
  useEffect(() => {
    PasteService.init();
    PasteService.registerHandler(componentId, handlePaste);

    return () => {
      PasteService.unregisterHandler(componentId);
    };
  }, [componentId, handlePaste]);

  return {
    onFocus: handleFocus,
    onPaste: handlePaste,
  };
};
