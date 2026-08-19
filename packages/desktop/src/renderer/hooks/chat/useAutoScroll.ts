/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';

interface UseAutoScrollOptions {
  containerRef: React.RefObject<HTMLDivElement>; // Container ref
  content: string; // Content (for watching changes)
  enabled?: boolean; // Whether to enable auto-scroll
  threshold?: number; // Distance from bottom threshold to trigger auto-scroll (px)
  behavior?: ScrollBehavior; // Scroll behavior
}

/**
 * 智能自动滚动 Hook
 * Smart auto-scroll Hook
 *
 * 当内容更新时，如果用户处于底部附近，则自动滚动到底部
 * When content updates, if user is near bottom, auto-scroll to bottom
 *
 * @example
 * ```tsx
 * const containerRef = useRef<HTMLDivElement>(null);
 * useAutoScroll({
 *   containerRef,
 *   content: streamingText,
 *   enabled: true,
 *   threshold: 200, // 距离底部 200px 以内时跟随
 * });
 * ```
 */
export const useAutoScroll = ({
  containerRef,
  content,
  enabled = true,
  threshold = 200,
  behavior = 'smooth',
}: UseAutoScrollOptions) => {
  useEffect(() => {
    if (!enabled) return;

    const container = containerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;

    // Calculate distance from bottom
    const distanceToBottom = scrollHeight - scrollTop - clientHeight;

    // 如果距离底部小于阈值，自动滚动到底部
    // If distance from bottom is less than threshold, auto-scroll to bottom
    if (distanceToBottom < threshold) {
      container.scrollTo({ top: scrollHeight, behavior });
    }
  }, [content, enabled, threshold, behavior, containerRef]);
};
