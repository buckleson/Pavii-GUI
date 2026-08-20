/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Home of the single-target CDP channel handle.
 *
 * A small standalone module to dodge a dependency cycle: the channel starts in index.ts while
 * its consumer is applicationBridge.ts, itself indirectly imported by index.ts. Both depending
 * on this neutral module saves the bridge from importing the entry file backwards.
 *
 * Holds the single-target CDP bridge handle. It lives in its own tiny module to avoid a
 * cycle: the bridge is started in index.ts but consumed by applicationBridge.ts, which
 * index.ts itself pulls in. Having both depend on this neutral module means the bridge
 * layer never has to import the entry file.
 */

import type { CdpBridgeHandle } from '../resources/builtinMcp/cdpBridge';

let handle: CdpBridgeHandle | null = null;

export const setCdpBridgeHandle = (next: CdpBridgeHandle | null): void => {
  handle = next;
};

export const getCdpBridgeHandle = (): CdpBridgeHandle | null => handle;
