/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Search } from '@icon-park/react';
import classNames from 'classnames';
import type { CSSProperties, InputHTMLAttributes, Ref } from 'react';
import React, { forwardRef } from 'react';
import styles from './AionInlineSearchInput.module.css';

/**
 * AionInlineSearchInput - the lightweight search box for dropdown lists
 *
 * Styled after the search box the home page project dropdown used to carry: light grey fill,
 * no border, 8px radius, magnifier icon and a transparent input - soft and compact, made to sit inside the top of a dropdown.
 * Distinct from AionSearchInput (34px, outlined, focus ring in the primary colour), which suits
 * a permanent search bar: use that for always-visible lists and this one for dropdowns.
 *
 * The API matches AionSearchInput (value/onChange/placeholder). It owns appearance and entry
 * only; filtering and debouncing stay with the caller.
 */
export type AionInlineSearchInputProps = {
  /** Current value (controlled) */
  value: string;
  /** Change callback, receiving the latest string */
  onChange: (value: string) => void;
  placeholder?: string;
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

const AionInlineSearchInput = forwardRef<HTMLInputElement, AionInlineSearchInputProps>((props, ref) => {
  const { value, onChange, placeholder, className, style, autoFocus, disabled, wrapTestId, inputProps } = props;

  return (
    <div className={classNames(styles.searchbar, className)} style={style} data-testid={wrapTestId}>
      <Search theme='outline' size='13' className={styles.icon} fill='currentColor' />
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
    </div>
  );
});

AionInlineSearchInput.displayName = 'AionInlineSearchInput';

export default AionInlineSearchInput;
