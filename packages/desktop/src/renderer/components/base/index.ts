/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AionUi base components unified exports
 *
 * 提供所有基础组件和类型的统一导出入口
 * Provides unified export entry for all base components and types
 */

// Component Exports ====================

export { default as AionModal } from './AionModal';
export { default as AionCollapse } from './AionCollapse';
export { default as AionSelect } from './AionSelect';
export { default as AionScrollArea } from './AionScrollArea';
export { default as AionSteps } from './AionSteps';
export { default as AionSearchInput } from './AionSearchInput';
export { default as AionInlineSearchInput } from './AionInlineSearchInput';

// Type Exports ====================

// AionModal types
export type {
  ModalSize,
  ModalHeaderConfig,
  ModalFooterConfig,
  ModalContentStyleConfig,
  AionModalProps,
} from './AionModal';
export { MODAL_SIZES } from './AionModal';

// AionCollapse types
export type { AionCollapseProps, AionCollapseItemProps } from './AionCollapse';

// AionSelect types
export type { AionSelectProps } from './AionSelect';

// AionSteps types
export type { AionStepsProps } from './AionSteps';

// AionSearchInput types
export type { AionSearchInputProps } from './AionSearchInput';

// AionInlineSearchInput types
export type { AionInlineSearchInputProps } from './AionInlineSearchInput';
