/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModalProps } from '@arco-design/web-react';
import { Modal, Button } from '@arco-design/web-react';
import { Close } from '@icon-park/react';
import classNames from 'classnames';
import type { CSSProperties } from 'react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useThemeContext } from '@/renderer/hooks/context/ThemeContext';

// ==================== Exported type definitions ====================

/** Preset size names */
export type ModalSize = 'small' | 'medium' | 'large' | 'xlarge' | 'full';

/** Preset size dimensions */
export const MODAL_SIZES: Record<ModalSize, { width: string; height?: string }> = {
  small: { width: '400px', height: '300px' },
  medium: { width: '600px', height: '400px' },
  large: { width: '800px', height: '600px' },
  xlarge: { width: '1000px', height: '700px' },
  full: { width: '90vw', height: '90vh' },
};

/** Header configuration */
export interface ModalHeaderConfig {
  /** Render the whole header yourself */
  render?: () => React.ReactNode;
  /** Title text or node */
  title?: React.ReactNode;
  /** Optional subtitle. Omitted, the row is not rendered at all: no space, no gap. */
  subtitle?: React.ReactNode;
  /** Whether the close button is shown */
  showClose?: boolean;
  /** Close button icon */
  closeIcon?: React.ReactNode;
  /** Extra class name for the header */
  className?: string;
  /** Extra style for the header */
  style?: CSSProperties;
}

/** Footer configuration */
export interface ModalFooterConfig {
  /** Render the whole footer yourself */
  render?: () => React.ReactNode;
  /** Extra class name for the footer */
  className?: string;
  /** Extra style for the footer */
  style?: CSSProperties;
  /**
   * Whether the component draws the footer's top divider and standard padding
   * padding。
   * between content and buttons. Defaults to false, which keeps existing behaviour
   */
  divider?: boolean;
}

/** Styling for the modal content area */
export interface ModalContentStyleConfig {
  /** Background colour; defaults to var(--dialog-fill-0) */
  background?: string;
  /** Corner radius; defaults to 16px */
  borderRadius?: string | number;
  /** Padding; defaults to 0 */
  padding?: string | number;
  /** Overflow behaviour for the content area; defaults to auto */
  overflow?: 'auto' | 'scroll' | 'hidden' | 'visible';
  /** Content area height, as a number or a px string */
  height?: string | number;
  /** Minimum height of the content area */
  minHeight?: string | number;
  /** Maximum height of the content area */
  maxHeight?: string | number;
}

/** AionModal props */
export interface AionModalProps extends Omit<ModalProps, 'title' | 'footer'> {
  children?: React.ReactNode;

  /**
   * Layout variant. 'standard' turns on the shared three-band task layout:
   * a title band (standard padding, divider below), a content band (standard padding,
   * scrolls on overflow) and a button band (divider above, standard padding). Omitted,
   */
  variant?: 'standard';

  /** Preset size. Overridden by width/height in `style`. */
  size?: ModalSize;

  /** Header: either a title string or a full configuration object */
  header?: React.ReactNode | ModalHeaderConfig;

  /** Footer: either a ReactNode or a configuration object */
  footer?: React.ReactNode | ModalFooterConfig | null;

  /** Styling for the modal content area */
  contentStyle?: ModalContentStyleConfig;

  // === Backwards-compatible props ===
  /** @deprecated Use header.title */
  title?: React.ReactNode;
  /** @deprecated Use header.showClose */
  showCustomClose?: boolean;
}

// Style Constants ====================

const HEADER_BASE_CLASS = 'flex items-center justify-between pb-20px';
const TITLE_BASE_CLASS = 'text-18px font-500 text-t-primary m-0';
const CLOSE_BUTTON_CLASS =
  'w-32px h-32px flex items-center justify-center rd-8px transition-colors duration-200 cursor-pointer border-0 bg-transparent p-0 hover:bg-2 focus:outline-none';
const FOOTER_BASE_CLASS = 'flex-shrink-0 bg-transparent';
/** Shared divider and padding between content and buttons in a task modal footer. */
const FOOTER_DIVIDER_CLASS = 'flex-shrink-0 border-t border-solid border-[var(--bg-3)] px-24px py-16px';

// ===== standard variant: the shared three-band layout =====
/** Title band: 20 top, 24 sides, 16 bottom, with a full-width divider beneath. */
const STD_HEADER_CLASS = 'aionui-modal-std-header flex items-start justify-between gap-16px px-24px pt-20px pb-16px';
const STD_TITLE_CLASS = 'text-18px font-600 leading-26px text-t-primary m-0';
const STD_SUBTITLE_CLASS = 'text-13px leading-20px text-t-secondary m-0 mt-4px';
/** Content band: fills the remaining height and scrolls on overflow. Padding excluded. */
const STD_BODY_LAYOUT_CLASS = 'aionui-modal-std-body min-h-0 flex-1 overflow-y-auto';
/** Standard content padding: 20 vertical, 24 horizontal. A full-bleed layout (the two-column team view, say) can switch it off through contentStyle.padding. */
const STD_BODY_PADDING_CLASS = 'px-24px py-20px';
const STD_CLOSE_BTN_CLASS =
  'shrink-0 w-32px h-32px flex items-center justify-center rd-8px transition-colors duration-200 cursor-pointer border-0 bg-transparent p-0 text-t-secondary hover:bg-fill-2 focus:outline-none';

/**
 * Custom modal component
 *
 * Wraps Arco Design Modal to provide one styling theme, preset sizes and font scaling.
 * Wrapper around Arco Design Modal with unified theme styling, preset sizes, and font scaling support
 *
 * @features
 * Preset size support (small/medium/large/xlarge/full)
 * Responsive to font scale changes
 * Flexible header/footer configuration
 * Backward compatible with old API
 * Auto viewport adaptation
 *
 * @example
 * ```tsx
 * Basic usage
 * <AionModal visible={true} onCancel={handleClose} header="Title">
 *   Content
 * </AionModal>
 *
 * Preset size
 * <AionModal visible={true} size="large" header="Large modal">
 *   Content
 * </AionModal>
 *
 * Custom header
 * <AionModal
 *   visible={true}
 *   header={{
 *     title: "Custom title",
 *     showClose: true,
 *     className: "custom-header"
 *   }}
 * >
 *   Content
 * </AionModal>
 *
 * Custom footer
 * <AionModal
 *   visible={true}
 *   header="Title"
 *   footer={
 *     <div className="flex gap-2">
 *       <Button onClick={handleCancel}>Cancel</Button>
 *       <Button type="primary" onClick={handleOk}>Confirm</Button>
 *     </div>
 *   }
 * >
 *   Content
 * </AionModal>
 * ```
 */
const dimensionKeys = ['width', 'minWidth', 'maxWidth', 'height', 'minHeight', 'maxHeight'] as const;
type DimensionKey = (typeof dimensionKeys)[number];

const formatDimensionValue = (value?: string | number) => {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'number' ? `${value}px` : value;
};

const AionModal: React.FC<AionModalProps> = ({
  children,
  variant,
  size,
  header,
  footer,
  contentStyle,
  // Backwards compatibility
  title,
  showCustomClose = true,
  onCancel,
  className = '',
  style,
  ...props
}) => {
  const isStandard = variant === 'standard';
  const { fontScale } = useThemeContext();
  const { t } = useTranslation();
  // The standard variant gives the content area standard padding (20 vertical, 24
  // horizontal). When the caller passes contentStyle.padding explicitly - team creation
  const stdBodyHasCustomPadding = isStandard && contentStyle?.padding !== undefined;
  // Turn the contentStyle configuration into CSS variables
  const contentBg = contentStyle?.background || 'var(--dialog-fill-0)';
  const contentBorderRadius = contentStyle?.borderRadius || '16px';
  const contentPadding = contentStyle?.padding || '0';
  const contentOverflow = contentStyle?.overflow || 'auto';

  const borderRadiusVal = typeof contentBorderRadius === 'number' ? `${contentBorderRadius}px` : contentBorderRadius;
  const paddingVal = typeof contentPadding === 'number' ? `${contentPadding}px` : contentPadding;

  const safeScale = fontScale > 0 ? fontScale : 1;

  const scaleDimension = (value: CSSProperties['width']): CSSProperties['width'] => {
    if (value === undefined || value === null) return value;
    if (typeof value === 'number') {
      return Number((value / safeScale).toFixed(2));
    }
    const match = /^([0-9]+(?:\.[0-9]+)?)px$/i.exec(value.trim());
    if (match) {
      return `${parseFloat(match[1]) / safeScale}px`;
    }
    return value;
  };

  // Handle size scaling
  const modalSize = size ? MODAL_SIZES[size] : undefined;
  const baseStyle: CSSProperties = {
    ...modalSize,
    ...style,
  };

  // Scale size-related properties (avoid side effects)
  type DimensionStyle = Partial<Pick<CSSProperties, DimensionKey>>;
  const scaledStyle: DimensionStyle = {};
  dimensionKeys.forEach((key) => {
    const raw = baseStyle[key];
    if (raw !== undefined) {
      scaledStyle[key] = scaleDimension(raw as CSSProperties['width']) as CSSProperties[DimensionKey];
    }
  });

  const mergedStyle: CSSProperties = {
    ...baseStyle,
    ...scaledStyle,
  };

  // Auto set max dimensions to fit viewport
  if (typeof window !== 'undefined') {
    const viewportGap = 32;
    if (!mergedStyle.maxWidth) {
      mergedStyle.maxWidth = `calc(100vw - ${viewportGap}px)`;
    }
    if (!mergedStyle.maxHeight) {
      mergedStyle.maxHeight = `calc(100vh - ${viewportGap}px)`;
    }
  }

  const finalStyle: CSSProperties = {
    ...mergedStyle,
    borderRadius: mergedStyle.borderRadius ?? '16px',
  };

  const bodyInlineStyle = React.useMemo<CSSProperties>(() => {
    const style: CSSProperties = {
      background: contentBg,
      overflow: contentOverflow,
    };

    (['height', 'minHeight', 'maxHeight'] as const).forEach((key) => {
      const value = contentStyle?.[key];
      if (value !== undefined) {
        style[key] = formatDimensionValue(value);
      }
    });

    return style;
  }, [contentBg, paddingVal, contentOverflow, contentStyle?.height, contentStyle?.maxHeight, contentStyle?.minHeight]);

  // Resolve the header configuration, including the legacy props
  const headerConfig: ModalHeaderConfig = React.useMemo(() => {
    // The new header configuration
    if (header !== undefined) {
      // A string or ReactNode becomes a title configuration
      if (typeof header === 'string' || React.isValidElement(header)) {
        return {
          title: header,
          showClose: true,
        };
      }
      // Already a configuration object
      return header as ModalHeaderConfig;
    }
    // Legacy title and showCustomClose props
    return {
      title,
      showClose: showCustomClose,
    };
  }, [header, title, showCustomClose]);

  // Resolve the footer configuration
  const footerConfig: ModalFooterConfig | null = React.useMemo(() => {
    if (footer === null) {
      return null;
    }

    // No footer supplied: fall back to the default template
    if (footer === undefined) {
      const cancelLabel = props.cancelText ?? t('common.cancel', { defaultValue: 'Cancel' });
      const okLabel = props.okText ?? t('common.confirm', { defaultValue: 'Confirm' });
      return {
        render: () => (
          <div className='flex justify-end gap-10px'>
            {/* The default buttons share one corner radius; their labels come from cancelText/okText */}
            {/* Default buttons ship with rounded corners; text can be overridden via cancelText/okText */}
            <Button onClick={onCancel} className='px-20px min-w-80px' style={{ borderRadius: 8 }}>
              {cancelLabel}
            </Button>
            <Button
              type='primary'
              onClick={props.onOk}
              loading={props.confirmLoading}
              className='px-20px min-w-80px'
              style={{ borderRadius: 8 }}
            >
              {okLabel}
            </Button>
          </div>
        ),
      };
    }

    // A ReactNode is wrapped into a configuration object
    if (React.isValidElement(footer)) {
      return {
        render: () => footer,
      };
    }
    return footer as ModalFooterConfig;
  }, [footer, onCancel, props.cancelText, props.okText, props.onOk, props.confirmLoading, t]);

  // Render the header
  const renderHeader = () => {
    // A custom render function was supplied
    if (headerConfig.render) {
      return (
        <div className={headerConfig.className} style={headerConfig.style}>
          {headerConfig.render()}
        </div>
      );
    }

    // With no title and no close button there is nothing to render
    if (!headerConfig.title && !headerConfig.showClose) {
      return null;
    }

    // standard variant: title above an optional subtitle, with standard padding and a divider below
    if (isStandard) {
      return (
        <div className={classNames(STD_HEADER_CLASS, headerConfig.className)} style={headerConfig.style}>
          <div className='min-w-0 flex-1'>
            {headerConfig.title && <h3 className={STD_TITLE_CLASS}>{headerConfig.title}</h3>}
            {/* The subtitle is optional: omitted, the row is not rendered and takes no space */}
            {headerConfig.subtitle ? <p className={STD_SUBTITLE_CLASS}>{headerConfig.subtitle}</p> : null}
          </div>
          {headerConfig.showClose && (
            <button onClick={onCancel} className={STD_CLOSE_BTN_CLASS} aria-label='Close'>
              {headerConfig.closeIcon || <Close size={20} fill='currentColor' />}
            </button>
          )}
        </div>
      );
    }

    // Default header layout
    const headerClassName = classNames(HEADER_BASE_CLASS, headerConfig.className);

    const headerStyle: CSSProperties = {
      borderBottom: '1px solid var(--bg-3)',
      ...headerConfig.style,
    };

    return (
      <div className={headerClassName} style={headerStyle}>
        {headerConfig.title && <h3 className={TITLE_BASE_CLASS}>{headerConfig.title}</h3>}
        {headerConfig.showClose && (
          <button onClick={onCancel} className={CLOSE_BUTTON_CLASS} aria-label='Close'>
            {headerConfig.closeIcon || <Close size={20} fill='#86909c' />}
          </button>
        )}
      </div>
    );
  };

  // Render the footer
  const renderFooter = () => {
    if (!footerConfig) {
      return null;
    }

    if (footerConfig.render) {
      // For the standard variant, or an explicit divider === true, the component draws the top
      // divider and standard padding itself. Otherwise it falls back to a bare container, which
      const useDivider = isStandard || footerConfig.divider === true;
      const footerClassName = classNames(
        useDivider ? FOOTER_DIVIDER_CLASS : FOOTER_BASE_CLASS,
        isStandard && 'aionui-modal-std-footer',
        footerConfig.className
      );
      return (
        <div className={footerClassName} style={footerConfig.style}>
          {footerConfig.render()}
        </div>
      );
    }

    return null;
  };

  return (
    <Modal
      {...props}
      title={null}
      closable={false}
      footer={null}
      onCancel={onCancel}
      className={classNames('aionui-modal', isStandard && 'aionui-modal-standard', className)}
      style={finalStyle}
      getPopupContainer={() => document.body}
    >
      <div
        className={classNames('aionui-modal-wrapper', isStandard && 'flex flex-col min-h-0')}
        style={{ borderRadius: borderRadiusVal }}
      >
        {renderHeader()}
        <div
          className={classNames(
            'aionui-modal-body-content',
            isStandard && STD_BODY_LAYOUT_CLASS,
            // Standard padding by default; an explicit contentStyle.padding wins through inline style, and may be 0
            isStandard && !stdBodyHasCustomPadding && STD_BODY_PADDING_CLASS
          )}
          style={stdBodyHasCustomPadding ? { ...bodyInlineStyle, padding: paddingVal } : bodyInlineStyle}
        >
          {children}
        </div>
        {renderFooter()}
      </div>
    </Modal>
  );
};

AionModal.displayName = 'AionModal';

export default AionModal;
