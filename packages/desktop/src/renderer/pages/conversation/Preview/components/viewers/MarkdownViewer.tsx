/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { joinPath } from '@/common/chat/chatLib';
import { ipcBridge } from '@/common';
import LocalFileLink from '@/renderer/components/Markdown/LocalFileLink';
import { resolveLocalFileLinkReference } from '@/renderer/components/Markdown/markdownUtils';
import { useTextSelection } from '@/renderer/hooks/ui/useTextSelection';
import 'katex/dist/katex.min.css';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import remarkBreaks from 'remark-breaks';
import { Streamdown, defaultRehypePlugins, defaultRemarkPlugins } from 'streamdown';
import MarkdownEditor from '../editors/MarkdownEditor';
import SelectionToolbar from '../renderers/SelectionToolbar';
import { useContainerScroll, useContainerScrollTarget } from '../../hooks/useScrollSyncHelpers';
import { useLocalFilePreview, useThemeDetection } from '../../hooks';
import { getMarkdownShikiThemes, getMermaidTheme } from '../../theme';
import { convertLatexDelimiters } from '@/renderer/utils/chat/latexDelimiters';

interface MarkdownPreviewProps {
  content: string; // Markdown content
  viewMode?: 'source' | 'preview'; // External view mode
  onViewModeChange?: (mode: 'source' | 'preview') => void; // View mode change callback (kept for call-site compatibility, currently unused)
  onContentChange?: (content: string) => void; // Content change callback
  containerRef?: React.RefObject<HTMLDivElement>; // Container ref for scroll sync
  onScroll?: (scrollTop: number, scrollHeight: number, clientHeight: number) => void; // Scroll callback
  file_path?: string; // Absolute file path of current markdown
  workspace?: string;
}

const isDataOrRemoteUrl = (value?: string): boolean => {
  if (!value) return false;
  return /^(https?:|data:|blob:|file:)/i.test(value);
};

const isAbsoluteLocalPath = (value?: string): boolean => {
  if (!value) return false;
  return /^([a-zA-Z]:\\|\\\\|\/)/.test(value);
};

interface MarkdownImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  baseDir?: string;
  workspace?: string;
}

const useImageResolverCache = () => {
  const cacheRef = useRef(new Map<string, string>());
  const inflightRef = useRef(new Map<string, Promise<string>>());

  const resolve = useCallback((key: string, loader: () => Promise<string>): Promise<string> => {
    const cache = cacheRef.current;
    if (cache.has(key)) {
      return Promise.resolve(cache.get(key)!);
    }

    const inflight = inflightRef.current;
    if (inflight.has(key)) {
      return inflight.get(key)!;
    }

    const promise = loader()
      .then((result) => {
        cache.set(key, result);
        return result;
      })
      .finally(() => {
        inflight.delete(key);
      });

    inflight.set(key, promise);
    return promise;
  }, []);

  return resolve;
};

const MarkdownImage: React.FC<MarkdownImageProps> = ({ src, alt, baseDir, workspace, ...props }) => {
  const [resolvedSrc, setResolvedSrc] = useState<string | undefined>(undefined);
  const resolveImage = useImageResolverCache();

  useEffect(() => {
    let cancelled = false;

    const loadImage = () => {
      if (!src) {
        setResolvedSrc(undefined);
        return;
      }

      if (isDataOrRemoteUrl(src)) {
        if (/^https?:/i.test(src)) {
          resolveImage(src, () => ipcBridge.fs.fetchRemoteImage.invoke({ url: src }))
            .then((dataUrl) => {
              if (!cancelled) {
                setResolvedSrc(dataUrl);
              }
            })
            .catch((error) => {
              console.error('[MarkdownPreview] Failed to fetch remote image:', src, error);
              if (!cancelled) {
                setResolvedSrc(src);
              }
            });
          return;
        }
        setResolvedSrc(src);
        return;
      }

      const normalizedBase = baseDir ? baseDir.replace(/\\/g, '/') : undefined;
      const cleanedSrc = src.replace(/\\/g, '/');
      const absolutePath = isAbsoluteLocalPath(cleanedSrc)
        ? cleanedSrc
        : normalizedBase
          ? joinPath(normalizedBase, cleanedSrc)
          : cleanedSrc;

      if (!absolutePath) {
        setResolvedSrc(src);
        return;
      }

      resolveImage(absolutePath, async () => {
        const dataUrl = await ipcBridge.fs.getImageBase64.invoke({ path: absolutePath, workspace });
        return dataUrl ?? src;
      })
        .then((dataUrl) => {
          if (!cancelled) {
            setResolvedSrc(dataUrl);
          }
        })
        .catch((error) => {
          console.error('[MarkdownPreview] Failed to load local image:', { src, absolutePath, error });
          if (!cancelled) {
            setResolvedSrc(src);
          }
        });
    };

    loadImage();

    return () => {
      cancelled = true;
    };
  }, [src, baseDir, resolveImage, workspace]);

  if (!resolvedSrc) {
    return alt ? <span>{alt}</span> : null;
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      referrerPolicy='no-referrer'
      crossOrigin='anonymous'
      style={{ maxWidth: '100%', width: 'auto', height: 'auto', display: 'block', objectFit: 'contain' }}
      {...props}
    />
  );
};

const encodeHtmlAttribute = (value: string) => value.replace(/&(?!#?[a-z0-9]+;)/gi, '&amp;');

const rewriteExternalMediaUrls = (markdown: string): string => {
  const githubWikiRegex = /https:\/\/github\.com\/([^/]+)\/([^/]+)\/wiki\/([^\s)"'>]+)/gi;
  const rewriteWiki = markdown.replace(githubWikiRegex, (_match, owner, repo, rest) => {
    return `https://raw.githubusercontent.com/wiki/${owner}/${repo}/${rest}`;
  });
  return rewriteWiki.replace(/<(img|a)\b[^>]*>/gi, (tag) => {
    return tag.replace(/(src|href)\s*=\s*(["'])([^"']*)(\2)/gi, (match, attr, quote, value, closingQuote) => {
      return `${attr}=${quote}${encodeHtmlAttribute(value)}${closingQuote}`;
    });
  });
};

const normalizeLocalFileSchemeLinks = (markdown: string): string => {
  return markdown.replace(/file:\/\//gi, '');
};

// Streamdown's built-in heading components are memoized by node position only
// (children are ignored), so headings keep stale text when content re-renders —
// especially with rehype-raw, which drops positions. Plain overrides keep the
// built-in classes but always render the current text.
const HEADING_COMPONENTS = Object.fromEntries(
  (
    [
      ['h1', 'text-3xl'],
      ['h2', 'text-2xl'],
      ['h3', 'text-xl'],
      ['h4', 'text-lg'],
      ['h5', 'text-base'],
      ['h6', 'text-sm'],
    ] as const
  ).map(([tag, size], index) => [
    tag,
    ({ children, className, node: _node, ...props }: React.HTMLAttributes<HTMLHeadingElement> & { node?: unknown }) =>
      React.createElement(
        tag,
        {
          className: ['mt-6 mb-2 font-semibold', size, className].filter(Boolean).join(' '),
          'data-streamdown': `heading-${index + 1}`,
          ...props,
        },
        children
      ),
  ])
);

/**
 * Markdown preview component
 *
 * Uses Streamdown native rendering (Shiki code highlight, Mermaid, KaTeX), supports source/preview toggle
 */
const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({
  content,
  viewMode: externalViewMode,
  onContentChange,
  containerRef: externalContainerRef,
  onScroll: externalOnScroll,
  file_path,
  workspace,
}) => {
  const internalContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = externalContainerRef || internalContainerRef; // Use external ref or internal ref
  const currentTheme = useThemeDetection();
  const handleLocalFileLink = useLocalFilePreview(workspace);

  // Use scroll sync hooks
  useContainerScroll(containerRef, externalOnScroll);
  useContainerScrollTarget(containerRef);

  // Use external viewMode if provided, default to preview
  const viewMode = externalViewMode ?? 'preview';

  // Preview source: convert LaTeX delimiters and rewrite external media URLs
  const previewSource = useMemo(
    () => convertLatexDelimiters(normalizeLocalFileSchemeLinks(rewriteExternalMediaUrls(content))),
    [content]
  );

  // Monitor text selection
  const { selectedText, selectionPosition, clearSelection } = useTextSelection(containerRef);

  const baseDir = useMemo(() => {
    if (!file_path) return undefined;
    const normalized = file_path.replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    if (lastSlash === -1) return undefined;
    return normalized.slice(0, lastSlash);
  }, [file_path]);

  return (
    <div className='flex flex-col w-full h-full overflow-hidden'>
      {/* Content area */}
      <div
        ref={containerRef}
        className={`flex-1 ${viewMode === 'source' ? 'overflow-hidden' : 'overflow-auto p-32px text-t-primary'}`}
        style={{ minWidth: 0 }}
      >
        {viewMode === 'source' ? (
          // Source mode: Use editor
          <MarkdownEditor value={content} onChange={(value) => onContentChange?.(value)} />
        ) : (
          // Preview mode: native Streamdown
          <div
            className='aionui-markdown'
            style={{
              wordWrap: 'break-word',
              overflowWrap: 'break-word',
              width: '100%',
              maxWidth: '100%',
              minWidth: 0,
              boxSizing: 'border-box',
            }}
          >
            <Streamdown
              mode='static'
              shikiTheme={getMarkdownShikiThemes()}
              mermaid={{ config: { theme: getMermaidTheme(currentTheme) } }}
              controls={{ table: false, mermaid: false }}
              remarkPlugins={[...Object.values(defaultRemarkPlugins), remarkBreaks]}
              rehypePlugins={[defaultRehypePlugins.raw, defaultRehypePlugins.sanitize, defaultRehypePlugins.katex]}
              components={{
                ...HEADING_COMPONENTS,
                a({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
                  const localFileReference = resolveLocalFileLinkReference(typeof href === 'string' ? href : '');
                  if (localFileReference) {
                    return (
                      <LocalFileLink reference={localFileReference} onOpen={handleLocalFileLink}>
                        {children}
                      </LocalFileLink>
                    );
                  }
                  return (
                    <a href={href} target='_blank' rel='noreferrer' {...props}>
                      {children}
                    </a>
                  );
                },
                img({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) {
                  return <MarkdownImage src={src} alt={alt} baseDir={baseDir} workspace={workspace} {...props} />;
                },
              }}
            >
              {previewSource}
            </Streamdown>
          </div>
        )}
      </div>

      {/* Text selection floating toolbar */}
      {selectedText && (
        <SelectionToolbar selectedText={selectedText} position={selectionPosition} onClear={clearSelection} />
      )}
    </div>
  );
};

export default MarkdownPreview;
