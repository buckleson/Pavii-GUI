/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { TAB_OVERFLOW_THRESHOLD } from '../constants';

/**
 * Tab 渐变状态
 * Tab fade state for gradient indicators
 */
export interface TabFadeState {
  /**
   * 是否显示左侧渐变指示器
   * Whether to show left gradient indicator
   */
  left: boolean;

  /**
   * 是否显示右侧渐变指示器
   * Whether to show right gradient indicator
   */
  right: boolean;
}

/**
 * Tab 横向溢出检测 Hook
 * Hook for detecting tab horizontal overflow
 *
 * 用于显示左右渐变指示器，提示用户可以滚动查看更多 Tab
 * Used to display left/right gradient indicators to prompt users that more tabs can be scrolled
 *
 * @param deps Dependencies array, overflow state will be recalculated when these values change
 * @returns Object containing container ref and fade state
 */
export const useTabOverflow = (deps: unknown[] = []) => {
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const [tabFadeState, setTabFadeState] = useState<TabFadeState>({ left: false, right: false });

  /**
   * 更新 Tab 溢出状态
   * Update tab overflow state
   */
  const updateTabOverflow = useCallback(() => {
    const container = tabsContainerRef.current;
    if (!container) return;

    const { scrollLeft, scrollWidth, clientWidth } = container;

    // 检查是否有横向溢出（内容宽度大于容器宽度）
    // Check if there's horizontal overflow (content width exceeds container width)
    const hasOverflow = scrollWidth > clientWidth + 1;

    const nextState: TabFadeState = {
      // Left gradient: has overflow and scrolled right
      left: hasOverflow && scrollLeft > TAB_OVERFLOW_THRESHOLD,
      // Right gradient: has overflow and not scrolled to rightmost
      right: hasOverflow && scrollLeft + clientWidth < scrollWidth - TAB_OVERFLOW_THRESHOLD,
    };

    // Only update when state changes to avoid unnecessary re-renders
    setTabFadeState((prev) => {
      if (prev.left === nextState.left && prev.right === nextState.right) return prev;
      return nextState;
    });
  }, []);

  // 当依赖项变化时更新溢出状态
  // Update overflow state when dependencies change
  useEffect(() => {
    updateTabOverflow();
  }, [updateTabOverflow, ...deps]);

  // 监听滚动、窗口大小变化和容器大小变化
  // Listen to scroll, window resize, and container size changes
  useEffect(() => {
    const container = tabsContainerRef.current;
    if (!container) return;

    const handleScroll = () => updateTabOverflow();
    container.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', updateTabOverflow);

    // Use ResizeObserver to monitor container size changes
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => updateTabOverflow());
      resizeObserver.observe(container);
    }

    return () => {
      container.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', updateTabOverflow);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [updateTabOverflow]);

  return {
    tabsContainerRef,
    tabFadeState,
  };
};
