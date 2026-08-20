/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { CloseSmall, Search } from '@icon-park/react';
import classNames from 'classnames';
import type { CSSProperties, InputHTMLAttributes, Ref } from 'react';
import React, { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './AionSearchInput.module.css';

/**
 * AionSearchInput - the shared search box
 *
 * Styled after the conversation-history search panel: search icon, input and a round clear
 * button, 38px tall, 10px radius, focus outlined in the primary colour. Callers pass only the
 * placeholder; the search logic (filtering, debouncing, results) stays with them - this component owns appearance and entry only.
 */
export type AionSearchInputProps = {
  /** Current value (controlled) */
  value: string;
  /** Change callback, receiving the latest string */
  onChange: (value: string) => void;
  placeholder?: string;
  /** Whether to show the clear button when there is content; defaults to true */
  allowClear?: boolean;
  /** Custom clear behaviour; defaults to setting '' */
  onClear?: () => void;
  className?: string;
  style?: CSSProperties;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Applied to the native input (tests using fill need it to target the real input) */
  'data-testid'?: string;
  /** Applied to the outer container, for locating the whole search bar */
  wrapTestId?: string;
  /** Extra props forwarded to the native input (onKeyDown, aria-label and the like) */
  inputProps?: Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'value' | 'onChange' | 'placeholder' | 'disabled' | 'autoFocus' | 'className'
  >;
};

const AionSearchInput = forwardRef<HTMLInputElement, AionSearchInputProps>((props, ref) => {
  const {
    value,
    onChange,
    placeholder,
    allowClear = true,
    onClear,
    className,
    style,
    autoFocus,
    disabled,
    wrapTestId,
    inputProps,
  } = props;
  const { t } = useTranslation();

  const handleClear = () => {
    if (onClear) {
      onClear();
    } else {
      onChange('');
    }
  };

  return (
    <div className={classNames(styles.searchbar, className)} style={style} data-testid={wrapTestId}>
      <Search theme='outline' size='14' className={styles.icon} fill='currentColor' />
      <input
        {...inputProps}
        ref={ref as Ref<HTMLInputElement>}
        className={styles.input}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        data-testid={props['data-testid']}
        onChange={(event) => onChange(event.target.value)}
      />
      {allowClear && value ? (
        <button
          type='button'
          className={styles.clearBtn}
          onClick={handleClear}
          aria-label={t('common.clear', { defaultValue: 'Clear' })}
          tabIndex={-1}
        >
          <CloseSmall theme='outline' size='14' fill='currentColor' />
        </button>
      ) : null}
    </div>
  );
});

AionSearchInput.displayName = 'AionSearchInput';

export default AionSearchInput;
