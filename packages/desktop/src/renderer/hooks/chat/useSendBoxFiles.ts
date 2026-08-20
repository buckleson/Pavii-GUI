import { useCallback } from 'react';
import type { FileMetadata } from '@/renderer/services/FileService';
import { getCleanFileNames } from '@/renderer/services/FileService';
import type { FileOrFolderItem } from '@/renderer/utils/file/fileTypes';

/**
 * Build the shared setUploadFile function
 * Supports functional updates, avoiding the closure trap
 */
export const createSetUploadFile = (
  mutate: (fn: (prev: Record<string, unknown> | undefined) => Record<string, unknown>) => void,
  data: unknown
) => {
  return useCallback(
    (uploadFile: string[] | ((prev: string[]) => string[])) => {
      mutate((prev) => {
        // Derive latest upload list to keep functional updates accurate
        const previousUploadFile = Array.isArray(prev?.uploadFile) ? (prev?.uploadFile as string[]) : [];
        const newUploadFile = typeof uploadFile === 'function' ? uploadFile(previousUploadFile) : uploadFile;
        return { ...prev, uploadFile: newUploadFile };
      });
    },
    [data, mutate]
  );
};

const formatFileRef = (file_name: string): string => {
  const trimmed = file_name.trim();
  // Remove @ prefix if present (normalize)
  // @ prefix is an internal implementation detail for ACP agents
  // It will be added by the backend when needed
  // Strip the @ prefix when present
  // The @ prefix is an ACP agent implementation detail the backend adds when needed
  const normalized = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  return normalized;
};

interface UseSendBoxFilesProps {
  atPath: Array<string | FileOrFolderItem>;
  uploadFile: string[];
  setAtPath: (atPath: Array<string | FileOrFolderItem>) => void;
  setUploadFile: (uploadFile: string[] | ((prev: string[]) => string[])) => void;
}

/**
 * Note: files can be full paths, getCleanFileNames will extract filenames
 */
export const formatFilesForMessage = (files: string[]): string => {
  if (files.length > 0) {
    return getCleanFileNames(files)
      .map((v) => formatFileRef(v))
      .join(' ');
  }
  return '';
};

/**
 * Shared SendBox file handling
 * Removes the duplication between the ACP, Gemini and GUID components
 */
export const useSendBoxFiles = ({ atPath, uploadFile, setAtPath, setUploadFile }: UseSendBoxFilesProps) => {
  // Handle dropped or pasted files
  const handleFilesAdded = useCallback(
    (files: FileMetadata[]) => {
      const file_paths = files.map((file) => file.path);
      // Functional update, so it reads the latest state rather than the closure
      setUploadFile((prevUploadFile) => [...prevUploadFile, ...file_paths]);
    },
    [setUploadFile]
  );

  // Process file references in messages (format: @filename)
  const processMessageWithFiles = useCallback(
    (message: string): string => {
      if (atPath.length || uploadFile.length) {
        const cleanUploadFiles = getCleanFileNames(uploadFile).map((file_name) => formatFileRef(file_name));
        // atPath may now contain string paths or objects, need to handle separately
        const atPathStrings = atPath.map((item) => {
          if (typeof item === 'string') {
            return item;
          } else {
            return item.path;
          }
        });
        const cleanAtPaths = getCleanFileNames(atPathStrings).map((file_name) => formatFileRef(file_name));
        return cleanUploadFiles.join(' ') + ' ' + cleanAtPaths.join(' ') + ' ' + message;
      }
      return message;
    },
    [atPath, uploadFile]
  );

  // Clear the file state
  const clearFiles = useCallback(() => {
    setAtPath([]);
    setUploadFile([]);
  }, [setAtPath, setUploadFile]);

  return {
    handleFilesAdded,
    processMessageWithFiles,
    clearFiles,
  };
};
