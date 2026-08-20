import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IMessageAcpToolCall } from '@/common/chat/chatLib';
import MessageToolGroupSummary from '@/renderer/pages/conversation/Messages/components/MessageToolGroupSummary';

vi.mock('@/renderer/components/media/LocalImageView', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('@/renderer/utils/file/download', () => ({
  downloadFileFromPath: vi.fn().mockResolvedValue(undefined),
}));

// Mirrors i18next: a missing key resolves to its `defaultValue`. Returning the
// key instead would hide whether the component passed a fallback at all.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return {
    ...actual,
    Message: { useMessage: () => [{ success: vi.fn(), error: vi.fn() }, null] },
  };
});

const toolCall = (title: string): IMessageAcpToolCall => ({
  id: `call-${title}`,
  conversation_id: 'conv-1',
  type: 'acp_tool_call',
  content: {
    sessionId: 'sess-1',
    update: {
      sessionUpdate: 'tool_call_update',
      tool_call_id: `call-${title}`,
      status: 'completed',
      title,
      kind: 'execute',
    },
  },
});

describe('Team tool names shown to the user', () => {
  it('shows the action instead of the raw Team MCP id', () => {
    render(<MessageToolGroupSummary messages={[toolCall('aionui-team_team_task_update')]} />);
    fireEvent.click(screen.getByText('View Steps · 1'));

    expect(screen.getByText('Updating task')).toBeTruthy();
    expect(screen.queryByText('aionui-team_team_task_update')).toBeNull();
  });

  it('renders no trace of the unbranded server name across a whole run', () => {
    // The four calls from the reported screenshots, rendered together.
    const messages = [
      toolCall('aionui-team_team_members'),
      toolCall('aionui-team_team_list_assistants'),
      toolCall('aionui-team_team_task_update'),
      toolCall('aionui-team_team_read_messages'),
    ];
    const { container } = render(<MessageToolGroupSummary messages={messages} />);
    fireEvent.click(screen.getByText('View Steps · 4'));

    expect(screen.getByText('Listing team members')).toBeTruthy();
    expect(screen.getByText('Listing available assistants')).toBeTruthy();
    expect(screen.getByText('Updating task')).toBeTruthy();
    expect(screen.getByText('Reading messages')).toBeTruthy();
    expect(container.textContent).not.toContain('aionui');
  });

  it('leaves a non-team tool name exactly as the agent reported it', () => {
    render(<MessageToolGroupSummary messages={[toolCall('github_create_issue')]} />);
    fireEvent.click(screen.getByText('View Steps · 1'));

    expect(screen.getByText('github_create_issue')).toBeTruthy();
  });
});
