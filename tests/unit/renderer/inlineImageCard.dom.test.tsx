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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MarkdownView from '@/renderer/components/Markdown';
import { linkifyBareImagePaths } from '@/renderer/utils/chat/inlineImagePaths';

const getImageBase64 = vi.hoisted(() => vi.fn());
const openSystem = vi.hoisted(() => vi.fn());
const showItemInFolder = vi.hoisted(() => vi.fn());

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: { getImageBase64: { invoke: getImageBase64 }, openSystem: { invoke: openSystem } },
    shell: { showItemInFolder: { invoke: showItemInFolder } },
  },
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

const copyText = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/renderer/utils/ui/clipboard', () => ({
  copyText,
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
  Message: {
    error: vi.fn(),
    // The hook form the components actually use (Arco's static helpers mount
    // via the legacy ReactDOM.render, which React 19 removed).
    useMessage: () => {
      const toast = (text: string) => {
        const node = document.createElement('div');
        node.textContent = text;
        document.body.appendChild(node);
      };
      return [{ error: toast, success: toast }, null];
    },
  },
  Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@icon-park/react', () => ({
  Copy: () => <span data-testid='copy-icon' />,
  Pic: () => <span data-testid='pic-icon' />,
  FileDisplayOne: () => <span data-testid='file-icon' />,
  FolderOpen: () => <span data-testid='folder-icon' />,
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

  it('shows the image immediately without a click, via the sandboxed endpoint', async () => {
    getImageBase64.mockResolvedValue('data:image/png;base64,abc');
    renderTransformed(`Saved at:\n${codexPath}\n`);

    // No interaction: the card loads on mount.
    await waitFor(() => {
      expect(screen.getByTestId('inline-image-shown')).toBeInTheDocument();
    });
    expect(getImageBase64).toHaveBeenCalledWith({
      path: 'C:/Users/vijay/.codex/generated_images/abc/call_x.png',
    });
    // A PLAIN img with the shadow-styled class: Arco's Image is unstyled and
    // unconstrained inside the markdown shadow root (a generated 1024x1536
    // image once painted over the whole conversation).
    const img = screen.getByTestId('inline-image-shown').querySelector('img');
    expect(img?.className).toContain('pavii-inline-media-img');
  });

  it('uses only classes the markdown shadow stylesheet actually defines', () => {
    // UnoCSS utilities and Arco's stylesheet DO NOT exist inside ShadowView's
    // shadow root — a class not defined there renders as nothing. Every
    // pavii-inline-* class the two card components use must have a rule in
    // ShadowView.tsx.
    const read = (rel: string) => readFileSync(resolve(__dirname, '../../../packages/desktop/src', rel), 'utf-8');
    const shadowCss = read('renderer/components/Markdown/ShadowView.tsx');
    const componentSource =
      read('renderer/components/media/InlineImageCard.tsx') + read('renderer/components/media/InlineFileChip.tsx');

    const used = [...new Set(componentSource.match(/pavii-inline-[a-z-]+/g) ?? [])];
    expect(used.length).toBeGreaterThan(3);
    for (const cls of used) {
      expect(shadowCss, `ShadowView.tsx must define .${cls}`).toContain(`.${cls}`);
    }
  });

  it('offers a copy-location button under the shown image, with a toast', async () => {
    getImageBase64.mockResolvedValue('data:image/png;base64,abc');
    copyText.mockResolvedValue(undefined);
    renderTransformed(`Separate cover photo saved at:\n${codexPath}\n`);

    await waitFor(() => {
      expect(screen.getByTestId('inline-image-shown')).toBeInTheDocument();
    });

    const copyBtn = screen.getByTestId('inline-image-copy');
    expect(copyBtn).toHaveTextContent('Click to copy the location');
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(screen.getByText('Image location copied to clipboard')).toBeInTheDocument();
    });
    expect(copyText).toHaveBeenCalledWith('C:/Users/vijay/.codex/generated_images/abc/call_x.png');
  });

  it('fails visibly with a retry when the read is refused', async () => {
    // A path outside the image-base64 sandbox (another drive, a deleted temp
    // file) must fail closed into an error state, not a broken <img>.
    getImageBase64.mockResolvedValue(null);
    renderTransformed(`Saved at:\n${codexPath}\n`);

    await waitFor(() => {
      expect(screen.getByText('Could not load')).toBeInTheDocument();
    });
    expect(screen.getByText('call_x.png')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();

    // Retry actually retries.
    getImageBase64.mockResolvedValue('data:image/png;base64,ok');
    fireEvent.click(screen.getByTestId('inline-image-show'));
    await waitFor(() => {
      expect(screen.getByTestId('inline-image-shown')).toBeInTheDocument();
    });
  });

  it('gives a document path an Open button that hands it to the OS', async () => {
    // Not a viewer: a docx belongs to Word. One small button beside the path,
    // opening via the existing open-system route with a local ref.
    openSystem.mockResolvedValue(undefined);
    renderTransformed('Saved the report at `C:\\Users\\v\\Documents\\report.docx` for you.');

    expect(screen.getByTestId('inline-file-chip')).toBeInTheDocument();
    expect(screen.getByText('report.docx')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('inline-file-open'));

    await waitFor(() => {
      expect(openSystem).toHaveBeenCalledWith({
        file: { kind: 'local', path: 'C:/Users/v/Documents/report.docx' },
      });
    });
  });

  it('shows a toast rather than nothing when the OS open fails', async () => {
    openSystem.mockRejectedValue(new Error('gone'));
    renderTransformed('Deck at `C:\\work\\pitch.pptx` ready.');

    fireEvent.click(screen.getByTestId('inline-file-open'));

    await waitFor(() => {
      expect(screen.getByText('Could not open the file')).toBeInTheDocument();
    });
  });

  it('reveals the file selected in the OS file manager from the "Click here" link', async () => {
    showItemInFolder.mockResolvedValue(undefined);
    renderTransformed('Report at `C:\\work\\q3\\summary.pdf` done.');

    const reveal = screen.getByTestId('inline-file-reveal');
    expect(reveal).toHaveTextContent('Click here');
    fireEvent.click(reveal);

    await waitFor(() => {
      expect(showItemInFolder).toHaveBeenCalledWith('C:/work/q3/summary.pdf');
    });
  });

  it('toasts when the file manager cannot be opened', async () => {
    showItemInFolder.mockRejectedValue(new Error('no shell'));
    renderTransformed('Report at `C:\\work\\q3\\summary.pdf` done.');

    fireEvent.click(screen.getByTestId('inline-file-reveal'));

    await waitFor(() => {
      expect(screen.getByText('Could not open File Explorer')).toBeInTheDocument();
    });
  });

  it('copies the file location and confirms with a toast', async () => {
    copyText.mockResolvedValue(undefined);
    renderTransformed('Sheet at `C:\\work\\budget.xlsx` saved.');

    fireEvent.click(screen.getByTestId('inline-file-copy'));

    await waitFor(() => {
      expect(screen.getByText('File location copied')).toBeInTheDocument();
    });
    expect(copyText).toHaveBeenCalledWith('C:/work/budget.xlsx');
  });

  it('toasts a failure when the clipboard write is refused', async () => {
    copyText.mockRejectedValueOnce(new Error('denied'));
    renderTransformed('Sheet at `C:\\work\\budget.xlsx` saved.');

    fireEvent.click(screen.getByTestId('inline-file-copy'));

    await waitFor(() => {
      expect(screen.getByText('Copy failed')).toBeInTheDocument();
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
