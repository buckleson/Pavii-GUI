/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';

import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

// Import KaTeX CSS to make it available in the document
import 'katex/dist/katex.min.css';

import { openExternalUrl } from '@/renderer/utils/platform';
import classNames from 'classnames';
import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { convertLatexDelimiters } from '@renderer/utils/chat/latexDelimiters';
import LocalImageView from '@renderer/components/media/LocalImageView';
import InlineFileChip from '@renderer/components/media/InlineFileChip';
import InlineImageCard from '@renderer/components/media/InlineImageCard';
import { INLINE_FILE_ALT, INLINE_IMAGE_ALT } from '@renderer/utils/chat/inlineImagePaths';
import CodeBlock from './CodeBlock';
import LocalFileLink from './LocalFileLink';
import ShadowView from './ShadowView';
import { resolveLocalFileLinkPath, resolveLocalFileLinkReference } from './markdownUtils';
import type { LocalFileLinkReference } from './markdownUtils';

const REMARK_PLUGINS = [remarkGfm, remarkMath, remarkBreaks];

const isLocalFilePath = (src: string): boolean => {
  if (src.startsWith('http://') || src.startsWith('https://')) return false;
  if (src.startsWith('data:')) return false;
  return true;
};

type MarkdownViewProps = {
  children: string;
  hiddenCodeCopyButton?: boolean;
  codeStyle?: React.CSSProperties;
  className?: string;
  onRef?: (el?: HTMLDivElement | null) => void;
  onLocalFileLink?: (path: string, reference?: LocalFileLinkReference) => void | Promise<void>;
  /** Enable raw HTML rendering in markdown content. Use with caution — only for trusted sources. */
  allowHtml?: boolean;
};

const MarkdownView: React.FC<MarkdownViewProps> = React.memo(
  ({ hiddenCodeCopyButton, codeStyle, className, onRef, onLocalFileLink, allowHtml, children: childrenProp }) => {
    const { t } = useTranslation();

    const normalizedChildren = useMemo(() => {
      if (typeof childrenProp === 'string') {
        let text = childrenProp.replace(/file:\/\//g, '');
        text = convertLatexDelimiters(text);
        return text;
      }
      return childrenProp;
    }, [childrenProp]);

    const handleLinkClick = useCallback(
      (e: React.MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
        e.stopPropagation();
        const href = (e.currentTarget as HTMLAnchorElement).href;
        if (!href) return;
        openExternalUrl(href).catch((error: unknown) => {
          console.error(t('messages.openLinkFailed'), error);
        });
      },
      [t]
    );

    // Memoize components so React preserves component identity across re-renders.
    // Without this, every streaming update creates new function references → React
    // unmounts/remounts all custom components → hooks & DOM state are lost.
    const components = useMemo(
      () => ({
        span: ({ node: _node, className: cn, children: ch, ...rest }: Record<string, unknown>) => (
          <span {...(rest as React.HTMLAttributes<HTMLSpanElement>)} className={cn as string}>
            {ch as React.ReactNode}
          </span>
        ),
        code: (props: Record<string, unknown>) => (
          <CodeBlock
            {...(props as Parameters<typeof CodeBlock>[0])}
            codeStyle={codeStyle}
            hiddenCodeCopyButton={hiddenCodeCopyButton}
          />
        ),
        a: ({ node: _node, ...rest }: Record<string, unknown>) => {
          const anchorProps = rest as React.AnchorHTMLAttributes<HTMLAnchorElement>;
          const rawHref = typeof anchorProps.href === 'string' ? anchorProps.href : '';
          const localFileReference = resolveLocalFileLinkReference(rawHref);
          if (localFileReference) {
            return (
              <LocalFileLink reference={localFileReference} onOpen={onLocalFileLink}>
                {anchorProps.children}
              </LocalFileLink>
            );
          }
          return (
            <a {...anchorProps} href={anchorProps.href} target='_blank' rel='noreferrer' onClick={handleLinkClick} />
          );
        },
        table: ({ node: _node, ...rest }: Record<string, unknown>) => (
          <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
            <table
              {...(rest as React.TableHTMLAttributes<HTMLTableElement>)}
              style={{
                ...(rest as { style?: React.CSSProperties }).style,
                borderCollapse: 'collapse',
                border: '1px solid var(--bg-3)',
                minWidth: '100%',
              }}
            />
          </div>
        ),
        td: ({ node: _node, ...rest }: Record<string, unknown>) => (
          <td
            {...(rest as React.TdHTMLAttributes<HTMLTableCellElement>)}
            style={{
              ...(rest as { style?: React.CSSProperties }).style,
              padding: '8px',
              border: '1px solid var(--bg-3)',
              minWidth: '120px',
            }}
          />
        ),
        img: ({ node: _node, ...rest }: Record<string, unknown>) => {
          const imgProps = rest as React.ImgHTMLAttributes<HTMLImageElement>;
          // Bare-path images injected by linkifyBareImagePaths are deferred:
          // a card that loads on click, not an eager fetch for every path an
          // agent happens to mention.
          if (imgProps.alt === INLINE_IMAGE_ALT) {
            return <InlineImageCard path={decodeURIComponent(imgProps.src || '')} />;
          }
          // Document paths get the path back plus one small Open button that
          // hands the file to the OS default app.
          if (imgProps.alt === INLINE_FILE_ALT) {
            return <InlineFileChip path={decodeURIComponent(imgProps.src || '')} />;
          }
          if (isLocalFilePath(imgProps.src || '')) {
            const src = decodeURIComponent(imgProps.src || '');
            return <LocalImageView src={src} alt={imgProps.alt || ''} className={imgProps.className} />;
          }
          return <img {...imgProps} alt={imgProps.alt || ''} />;
        },
      }),
      [codeStyle, hiddenCodeCopyButton, handleLinkClick, onLocalFileLink]
    );

    const rehypePlugins = useMemo(() => (allowHtml ? [rehypeRaw, rehypeKatex] : [rehypeKatex]), [allowHtml]);

    return (
      // ph-no-capture: the shared renderer for message bodies, skill docs and
      // file previews — always user or model content.
      <div className={classNames('relative w-full ph-no-capture', className)}>
        <ShadowView>
          <div ref={onRef} className='markdown-shadow-body'>
            <ReactMarkdown
              remarkPlugins={REMARK_PLUGINS}
              rehypePlugins={rehypePlugins}
              components={components}
              urlTransform={(url) => (resolveLocalFileLinkPath(url) ? url : defaultUrlTransform(url))}
            >
              {normalizedChildren}
            </ReactMarkdown>
          </div>
        </ShadowView>
      </div>
    );
  }
);

MarkdownView.displayName = 'MarkdownView';

export default MarkdownView;
