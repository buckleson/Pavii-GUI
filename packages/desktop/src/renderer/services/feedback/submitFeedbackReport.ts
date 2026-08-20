import type { FeedbackDiagnosticsContextInput } from '@/common/types/feedbackDiagnostics';
import { httpRequest } from '@/common/adapter/httpBridge';
import type { IssueReportResult } from '@/common/types/platform/electron';
import { logFeedbackReport } from './feedbackLog';
import { submitIssueReport } from './submitIssueReport';

type FeedbackLogAttachmentStatus = 'collected' | 'empty' | 'failed' | 'skipped' | 'unavailable';
type FeedbackDbDiagnosticsAttachmentStatus = 'collected' | 'empty' | 'failed' | 'skipped' | 'unavailable';
type FeedbackDiagnosticsAttachmentPayload = {
  contentType: string;
  data: Uint8Array<ArrayBuffer>;
  filename: string;
};

export type FeedbackAttachment = {
  filename: string;
  data: Uint8Array<ArrayBuffer>;
  contentType: string;
};

export type FeedbackEventTags = Record<string, string>;
export type FeedbackEventExtra = Record<string, unknown>;

export type SubmitFeedbackReportInput = {
  attachments?: FeedbackAttachment[];
  collectDbDiagnostics?: FeedbackDiagnosticsContextInput;
  collectLogs?: boolean;
  description: string;
  extra?: FeedbackEventExtra;
  flushTimeoutMs?: number;
  module: string;
  moduleLabel: string;
  tags?: FeedbackEventTags;
};

function summarizeAttachments(attachments: FeedbackAttachment[]): Array<{
  contentType: string;
  filename: string;
  size: number;
}> {
  return attachments.map((attachment) => ({
    filename: attachment.filename,
    contentType: attachment.contentType,
    size: attachment.data.byteLength,
  }));
}

function summarizeLogAttachment(
  status: FeedbackLogAttachmentStatus,
  attachment: FeedbackAttachment | null
): {
  filename?: string;
  size?: number;
  status: FeedbackLogAttachmentStatus;
} {
  if (!attachment) {
    return { status };
  }

  return {
    status,
    filename: attachment.filename,
    size: attachment.data.byteLength,
  };
}

function summarizeDbDiagnosticsAttachment(
  status: FeedbackDbDiagnosticsAttachmentStatus,
  attachment: FeedbackAttachment | null
): {
  filename?: string;
  size?: number;
  status: FeedbackDbDiagnosticsAttachmentStatus;
} {
  if (!attachment) {
    return { status };
  }

  return {
    status,
    filename: attachment.filename,
    size: attachment.data.byteLength,
  };
}

async function collectLogAttachment(): Promise<{
  attachment: FeedbackAttachment | null;
  status: FeedbackLogAttachmentStatus;
}> {
  try {
    const electronAPI = typeof window === 'undefined' ? undefined : window.electronAPI;
    if (!electronAPI?.collectFeedbackLogs) {
      return { attachment: null, status: 'unavailable' };
    }

    const logData = await electronAPI?.collectFeedbackLogs?.();
    if (!logData) {
      return { attachment: null, status: 'empty' };
    }

    return {
      attachment: {
        filename: logData.filename,
        data: new Uint8Array(logData.data),
        contentType: 'application/gzip',
      },
      status: 'collected',
    };
  } catch {
    return { attachment: null, status: 'failed' };
  }
}

async function collectDbDiagnosticsAttachment(request: FeedbackDiagnosticsContextInput): Promise<{
  attachment: FeedbackAttachment | null;
  status: FeedbackDbDiagnosticsAttachmentStatus;
}> {
  try {
    if (typeof fetch === 'undefined') {
      return { attachment: null, status: 'unavailable' };
    }

    const diagnostics = await httpRequest<unknown>('GET', buildFeedbackDiagnosticsPath(request), undefined, {
      silentStatuses: [400, 401, 403, 404, 500, 502, 503, 504],
    });
    if (!diagnostics) {
      return { attachment: null, status: 'empty' };
    }
    const payload = await encodeDiagnosticsAttachmentPayload(diagnostics);

    return {
      attachment: {
        filename: payload.filename,
        data: payload.data,
        contentType: payload.contentType,
      },
      status: 'collected',
    };
  } catch {
    return { attachment: null, status: 'failed' };
  }
}

function buildFeedbackDiagnosticsPath(request: FeedbackDiagnosticsContextInput): string {
  const params = new URLSearchParams();
  appendQueryParam(params, 'route_at_open', request.routeAtOpen);
  appendQueryParam(params, 'route_at_submit', request.routeAtSubmit);
  appendQueryParam(params, 'selected_module', request.selectedModule);
  appendQueryParam(params, 'profiles', request.explicitProfiles?.join(','));
  appendQueryParam(params, 'conversation_id', request.explicitContext?.conversationId);
  appendQueryParam(params, 'provider_id', request.explicitContext?.providerId);
  appendQueryParam(params, 'agent_id', request.explicitContext?.agentId);
  appendQueryParam(params, 'team_id', request.explicitContext?.teamId);
  appendQueryParam(params, 'mcp_server_id', request.explicitContext?.mcpServerId);

  const query = params.toString();
  return query ? `/api/system/diagnostics/feedback-report?${query}` : '/api/system/diagnostics/feedback-report';
}

function appendQueryParam(params: URLSearchParams, key: string, value: string | undefined): void {
  const trimmed = value?.trim();
  if (trimmed) {
    params.set(key, trimmed);
  }
}

async function encodeDiagnosticsAttachmentPayload(value: unknown): Promise<FeedbackDiagnosticsAttachmentPayload> {
  const data = new TextEncoder().encode(JSON.stringify(value, null, 2));
  try {
    if (typeof CompressionStream !== 'function') {
      return {
        filename: 'db-diagnostics.json',
        data,
        contentType: 'application/json',
      };
    }

    const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    return {
      filename: 'db-diagnostics.json.gz',
      data: compressed,
      contentType: 'application/gzip',
    };
  } catch {
    return {
      filename: 'db-diagnostics.json',
      data,
      contentType: 'application/json',
    };
  }
}

function normalizeDescription(description: string): string {
  return description.trim().replace(/\s+/g, ' ');
}

export async function submitFeedbackReport(input: SubmitFeedbackReportInput): Promise<IssueReportResult> {
  const attachments = [...(input.attachments ?? [])];
  let result: IssueReportResult;
  let logAttachmentStatus: FeedbackLogAttachmentStatus = input.collectLogs ? 'empty' : 'skipped';
  let logAttachment: FeedbackAttachment | null = null;
  let dbDiagnosticsAttachmentStatus: FeedbackDbDiagnosticsAttachmentStatus = input.collectDbDiagnostics
    ? 'empty'
    : 'skipped';
  let dbDiagnosticsAttachment: FeedbackAttachment | null = null;

  try {
    if (input.collectLogs) {
      const collectedLogAttachment = await collectLogAttachment();
      logAttachmentStatus = collectedLogAttachment.status;
      logAttachment = collectedLogAttachment.attachment;
      if (logAttachment) {
        attachments.unshift(logAttachment);
      }
    }

    if (input.collectDbDiagnostics) {
      const collectedDbDiagnosticsAttachment = await collectDbDiagnosticsAttachment(input.collectDbDiagnostics);
      dbDiagnosticsAttachmentStatus = collectedDbDiagnosticsAttachment.status;
      dbDiagnosticsAttachment = collectedDbDiagnosticsAttachment.attachment;
      if (dbDiagnosticsAttachment) {
        attachments.unshift(dbDiagnosticsAttachment);
      }
    }

    const normalizedDescription = normalizeDescription(input.description);
    const extraLines = Object.entries({ ...input.tags, ...input.extra })
      .filter(([, value]) => value !== undefined && value !== null && String(value).trim())
      .map(([key, value]) => `- **${key}**: ${String(value)}`);
    const description = extraLines.length
      ? `${normalizedDescription}\n\n<details><summary>Context</summary>\n\n${extraLines.join('\n')}\n\n</details>`
      : normalizedDescription;

    result = await submitIssueReport({
      attachments,
      description,
      module: input.module,
      moduleLabel: input.moduleLabel,
    });

    logFeedbackReport('info', 'submitted', {
      module: input.module,
      mode: result.mode,
      issueUrl: result.issueUrl,
      bundleDir: result.bundleDir,
      collectLogs: Boolean(input.collectLogs),
      logAttachment: summarizeLogAttachment(logAttachmentStatus, logAttachment),
      dbDiagnosticsAttachment: summarizeDbDiagnosticsAttachment(dbDiagnosticsAttachmentStatus, dbDiagnosticsAttachment),
      attachmentCount: attachments.length,
      attachments: summarizeAttachments(attachments),
      tagKeys: Object.keys(input.tags ?? {}),
    });

    return result;
  } catch (error) {
    logFeedbackReport('error', 'failed', {
      module: input.module,
      collectLogs: Boolean(input.collectLogs),
      logAttachment: summarizeLogAttachment(logAttachmentStatus, logAttachment),
      dbDiagnosticsAttachment: summarizeDbDiagnosticsAttachment(dbDiagnosticsAttachmentStatus, dbDiagnosticsAttachment),
      attachmentCount: attachments.length,
      attachments: summarizeAttachments(attachments),
      error,
    });
    throw error;
  }
}

export { logFeedbackReport } from './feedbackLog';
