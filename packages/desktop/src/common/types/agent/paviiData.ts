/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared contract for `.pavii` data: the per-project session index, past CLI
 * sessions found on disk, and the portable `*.pavii` backup file.
 */

/** Where a session entry in `.pavii/sessions.json` came from. */
export type PaviiSessionSource = 'pavii' | 'claude-import' | 'codex-import';

/** One entry of `<workspace>/.pavii/sessions.json` (written by the engine). */
export type PaviiSessionEntry = {
  conversationId: string;
  title: string;
  agentId: string | null;
  backend: string | null;
  /** The CLI's own session id (Claude sessionId / Codex threadId), once known. */
  backendSessionId: string | null;
  source: PaviiSessionSource;
  /** Epoch ms. */
  createdAt: number;
  lastActiveAt: number;
};

export type PaviiSessionsFile = {
  version: 1;
  sessions: PaviiSessionEntry[];
};

/** A past Claude Code / Codex session found for a folder. */
export type ExternalSession = {
  backend: 'claude' | 'codex';
  /** Claude `sessionId` or Codex thread `id` (what the CLI resumes). */
  sessionId: string;
  title: string;
  /** Working directory the session was recorded in (equals the queried folder). */
  cwd: string;
  /** Epoch ms. */
  startedAt: number;
  updatedAt: number;
  /** Number of user + assistant text messages that an import would show. */
  messageCount: number;
  /** Set when this session was already imported into Pavii. */
  conversationId?: string;
};

export type ExternalSessionList = {
  sessions: ExternalSession[];
  /** Sources that could not be read (e.g. codex not installed), for a hint in the UI. */
  unavailable: Array<{ backend: 'claude' | 'codex'; reason: string }>;
  /** Entries from `<folder>/.pavii/sessions.json`, if present. */
  paviiSessions: PaviiSessionEntry[];
};

export type ImportExternalSessionResult =
  | { success: true; conversationId: string; importedMessages: number }
  | { success: false; error: 'not-found' | 'agent-unavailable' | 'read-failed' | 'import-failed'; message?: string };

/** Sections of a backup and how a restore went for each. */
export type PaviiBackupSection =
  | 'providers'
  | 'agents'
  | 'mcpServers'
  | 'assistants'
  | 'skills'
  | 'settings'
  | 'sessions';

export type PaviiBackupSectionSummary = {
  section: PaviiBackupSection;
  restored: number;
  skipped: number;
  failed: number;
};

/** On-disk `*.pavii` backup file. */
export type PaviiBackupFile = {
  format: 'pavii-backup';
  version: 1;
  appVersion: string;
  /** ISO timestamp. */
  createdAt: string;
  /** Pavii account uid at export time, used to detect a new login. */
  accountUid?: string;
  data: Record<PaviiBackupSection, unknown>;
  /**
   * Provider API keys, agent env-override values and MCP env/header values,
   * encrypted with the user's backup password (scrypt + AES-256-GCM, all
   * base64). Absent when no password was set; auto-saves never include it.
   */
  secrets?: { kdf: 'scrypt'; salt: string; iv: string; tag: string; ciphertext: string };
};

export type ExportBackupResult =
  | { success: true; path: string; includesSecrets: boolean }
  | { success: false; error: 'write-failed' | 'collect-failed'; message?: string };

export type ImportBackupResult =
  | { success: true; summary: PaviiBackupSectionSummary[]; secretsRestored: boolean }
  | {
      success: false;
      error: 'invalid-file' | 'unsupported-version' | 'password-required' | 'wrong-password' | 'read-failed';
      message?: string;
    };

/** Offer shown on launch when a backup exists and the profile looks fresh or the account changed. */
export type RestoreOffer = {
  path: string;
  createdAt: string;
  reason: 'empty-profile' | 'new-account';
  hasSecrets: boolean;
  /** Item counts per section in the backup, for the dialog. */
  counts: Partial<Record<PaviiBackupSection, number>>;
};
