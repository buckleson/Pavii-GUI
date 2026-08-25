/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 *
 * Click-to-view cards for bare image paths in agent replies, rendered through
 * the REAL MarkdownView (the MessageText harness mocks Markdown away, so this
 * file owns the card half of the pipeline). Same mock set as
 * markdownLocalFileLink.dom.test.tsx: jsdom has no shadow DOM worth querying,
 * so ShadowView flattens to a div.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MarkdownView from '@/renderer/components/Markdown';
import { linkifyBareImagePaths } from '@/renderer/utils/chat/inlineImagePaths';

const getImageBase64 = vi.hoisted(() => vi.fn());

vi.mock('@/common', () => ({
  ipcBridge: { fs: { getImageBase64: { invoke: getImageBase64 } } },
}));

vi.mock('@/renderer/components/Markdown/ShadowView', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/renderer/components/Markdown/CodeBlock', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <code>{children}</code>,
}));

vi.mock('@/renderer/components/media/LocalImageView', () => ({
  __esModule: true,
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} data-testid='plain-local-image' />,
}));

vi.mock('@/renderer/utils/chat/latexDelimiters', () => ({
  convertLatexDelimiters: (text: string) => text,
}));

vi.mock('@/renderer/utils/platform', () => ({
  openExternalUrl: vi.fn(),
}));

vi.mock('@/renderer/utils/ui/clipboard', () => ({
  copyText: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@arco-design/web-react', () => ({
  Button: ({
    children,
    icon,
    loading: _loading,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode; loading?: boolean }) => (
    <button type='button' {...props}>
      {icon}
      {children}
    </button>
  ),
  Image: ({ src, alt }: { src: string; alt?: string }) => <img src={src} alt={alt} data-testid='arco-image' />,
  Message: { error: vi.fn() },
  Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@icon-park/react', () => ({
  Copy: () => <span data-testid='copy-icon' />,
  Pic: () => <span data-testid='pic-icon' />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

describe('inline image cards in markdown', () => {
  const codexPath = 'C:\\Users\\vijay\\.codex\\generated_images\\abc\\call_x.png';

  beforeEach(() => {
    getImageBase64.mockReset();
  });

  const renderTransformed = (prose: string) => render(<MarkdownView>{linkifyBareImagePaths(prose)}</MarkdownView>);

  it('renders a card and defers the disk read until asked', () => {
    renderTransformed(`Saved at:\n${codexPath}\n`);

    expect(screen.getByTestId('inline-image-card')).toBeInTheDocument();
    expect(screen.getByText('call_x.png')).toBeInTheDocument();
    // Deferred means deferred: nothing is read just because a path was mentioned.
    expect(getImageBase64).not.toHaveBeenCalled();
  });

  it('loads and shows the image on click, via the sandboxed endpoint', async () => {
    getImageBase64.mockResolvedValue('data:image/png;base64,abc');
    renderTransformed(`Saved at:\n${codexPath}\n`);

    fireEvent.click(screen.getByTestId('inline-image-show'));

    await waitFor(() => {
      expect(screen.getByTestId('inline-image-shown')).toBeInTheDocument();
    });
    expect(getImageBase64).toHaveBeenCalledWith({
      path: 'C:/Users/vijay/.codex/generated_images/abc/call_x.png',
    });
  });

  it('fails visibly with a retry when the read is refused', async () => {
    // A path outside the image-base64 sandbox (another drive, a deleted temp
    // file) must fail closed into an error state, not a broken <img>.
    getImageBase64.mockResolvedValue(null);
    renderTransformed(`Saved at:\n${codexPath}\n`);

    fireEvent.click(screen.getByTestId('inline-image-show'));

    await waitFor(() => {
      expect(screen.getByText('Could not load')).toBeInTheDocument();
    });
    expect(screen.getByText('Retry')).toBeInTheDocument();

    // Retry actually retries.
    getImageBase64.mockResolvedValue('data:image/png;base64,ok');
    fireEvent.click(screen.getByTestId('inline-image-show'));
    await waitFor(() => {
      expect(screen.getByTestId('inline-image-shown')).toBeInTheDocument();
    });
  });

  it('leaves ordinary markdown images on the eager LocalImageView path', () => {
    // Only the marker alt defers; an agent that already writes real markdown
    // image syntax keeps today's behaviour.
    render(<MarkdownView>{'![chart](C:/work/chart.png)'}</MarkdownView>);

    expect(screen.getByTestId('plain-local-image')).toBeInTheDocument();
    expect(screen.queryByTestId('inline-image-card')).toBeNull();
  });
});
