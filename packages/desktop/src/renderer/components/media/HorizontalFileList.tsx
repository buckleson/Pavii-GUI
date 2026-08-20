/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { IconLeft, IconRight } from '@arco-design/web-react/icon';
import React, { useRef, useState, useEffect } from 'react';

interface HorizontalFileListProps {
  children: React.ReactNode;
}

/**
 * Horizontally scrolling file list
 * Scrolls left and right, showing and hiding the scroll buttons automatically
 * Used to lay out the file preview list horizontally
 */
const HorizontalFileList: React.FC<HorizontalFileListProps> = ({ children }) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);

  /**
   * Check the scroll state to decide whether the left/right buttons are needed
   * Works out whether the container scrolls and whether it sits at the start or end
   */
  const checkScroll = React.useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // Whether horizontal scrolling applies
    const hasScroll = container.scrollWidth > container.clientWidth;
    // At the start (left edge)
    const isAtStart = container.scrollLeft <= 1;
    // At the end (right edge)
    const isAtEnd = container.scrollLeft + container.clientWidth >= container.scrollWidth - 1;

    const nextShowScrollButton = hasScroll;
    const nextCanScrollRight = hasScroll && !isAtEnd;
    const nextCanScrollLeft = hasScroll && !isAtStart;

    // Only update when the state actually changed, avoiding needless re-renders
    setShowScrollButton((prev) => (prev !== nextShowScrollButton ? nextShowScrollButton : prev));
    setCanScrollRight((prev) => (prev !== nextCanScrollRight ? nextCanScrollRight : prev));
    setCanScrollLeft((prev) => (prev !== nextCanScrollLeft ? nextCanScrollLeft : prev));
  }, []);

  useEffect(() => {
    checkScroll();
    const container = scrollContainerRef.current;
    if (!container) return;

    let rafId: number | null = null;
    const scheduleCheck = () => {
      if (typeof window !== 'undefined' && 'requestAnimationFrame' in window) {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
        }
        rafId = requestAnimationFrame(checkScroll);
      } else {
        checkScroll();
      }
    };

    // ResizeObserver watches container resizes and refreshes the scroll state
    // ResizeObserver already handles most layout changes well
    const resizeObserver = new ResizeObserver(scheduleCheck);
    resizeObserver.observe(container);

    // Watch scrolling so button visibility stays current
    container.addEventListener('scroll', checkScroll, { passive: true });

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      resizeObserver.disconnect();
      container.removeEventListener('scroll', checkScroll);
    };
  }, [checkScroll]);

  // A change in children needs one check too, without becoming a dependency that re-runs constantly
  useEffect(() => {
    checkScroll();
  }, [children, checkScroll]);

  /**
   * Scroll 200px right
   */
  const handleScrollRight = () => {
    const container = scrollContainerRef.current;
    if (!container) return;

    container.scrollBy({
      left: 200,
      behavior: 'smooth',
    });
  };

  /**
   * Scroll 200px left
   */
  const handleScrollLeft = () => {
    const container = scrollContainerRef.current;
    if (!container) return;

    container.scrollBy({
      left: -200,
      behavior: 'smooth',
    });
  };

  return (
    <div className='relative min-w-0 max-w-full'>
      {/* Horizontal scroll container with the scrollbar hidden */}
      <div
        ref={scrollContainerRef}
        className='flex items-center gap-8px overflow-x-auto overflow-y-hidden scrollbar-hide pt-5px pb-5px w-full max-w-full min-w-0'
        style={{
          scrollbarWidth: 'none', // Firefox
          msOverflowStyle: 'none', // IE/Edge
        }}
      >
        {children}
      </div>
      {/* Left scroll button, shown when not at the start */}
      {showScrollButton && canScrollLeft && (
        <div
          className='absolute left-0 top-0 h-full flex items-center cursor-pointer'
          style={{
            background: 'linear-gradient(to left, transparent, var(--dialog-fill-0) 30%)', // Left gradient mask
            width: '60px',
            pointerEvents: 'none', // The mask ignores clicks
          }}
        >
          <button
            onClick={handleScrollLeft}
            className='ml-0px w-28px h-28px rd-50% bg-1 flex items-center justify-center hover:bg-2 transition-colors border-1 border-solid b-color-border-2'
            style={{
              pointerEvents: 'auto', // The button takes clicks
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
            }}
          >
            <IconLeft style={{ fontSize: '14px', color: 'var(--text-t-primary)' }} />
          </button>
        </div>
      )}
      {/* Right scroll button, shown when not at the end */}
      {showScrollButton && canScrollRight && (
        <div
          className='absolute right-0 top-0 h-full flex items-center cursor-pointer'
          style={{
            background: 'linear-gradient(to right, transparent, var(--dialog-fill-0) 30%)', // Right gradient mask
            width: '60px',
            pointerEvents: 'none', // The mask ignores clicks
          }}
        >
          <button
            onClick={handleScrollRight}
            className='ml-auto mr-0px w-28px h-28px rd-50% bg-1 flex items-center justify-center hover:bg-2 transition-colors border-1 border-solid b-color-border-2'
            style={{
              pointerEvents: 'auto', // The button takes clicks
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
            }}
          >
            <IconRight style={{ fontSize: '14px', color: 'var(--text-t-primary)' }} />
          </button>
        </div>
      )}
    </div>
  );
};

export default HorizontalFileList;
