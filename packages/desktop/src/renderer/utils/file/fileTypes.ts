import type { ChatFileRef } from '@/common/types/chatFile';

export type FileOrFolderItem = {
  path: string; // Absolute path
  name: string; // File name (may be cleaned for display)
  isFile: boolean; // Whether it is a file
  relativePath?: string; // Relative path to workspace (for sending to Agent)
  /**
   * Source-tagged file ref for the send path. When present (files added from the
   * project Explorer tree), the item is sent as this ref and the front-end does
   * NOT build an absolute path — the backend resolves `{pe_id, relative_path}` at
   * the edge. When absent (uploads, OS-picker `@` mentions), the item is sent as
   * an `upload` ref built from `path`. See {@link ChatFileRef}.
   */
  chatRef?: ChatFileRef;
};
