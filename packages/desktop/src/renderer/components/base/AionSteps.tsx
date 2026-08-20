/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Steps } from '@arco-design/web-react';
import type { StepsProps } from '@arco-design/web-react/es/Steps';
import classNames from 'classnames';
import React from 'react';

/**
 * Steps component props
 */
export interface AionStepsProps extends StepsProps {
  /** Additional class name */
  className?: string;
}

/**
 * Steps component
 *
 * Wrapper around Arco Design Steps with unified theme styling
 *
 * @features
 * Custom brand color theme
 * Special styling for finished state
 * Full Arco Steps API support
 *
 * @example
 * ```tsx
 * Basic usage
 * <AionSteps current={1}>
 *   <AionSteps.Step title="Step 1" description="A description" />
 *   <AionSteps.Step title="Step 2" description="A description" />
 *   <AionSteps.Step title="Step 3" description="A description" />
 * </AionSteps>
 *
 * Vertical steps
 * <AionSteps current={1} direction="vertical">
 *   <AionSteps.Step title="Step 1" description="Description" />
 *   <AionSteps.Step title="Step 2" description="Description" />
 * </AionSteps>
 *
 * Steps with icons
 * <AionSteps current={1}>
 *   <AionSteps.Step title="Done" icon={<IconCheck />} />
 *   <AionSteps.Step title="In progress" icon={<IconLoading />} />
 *   <AionSteps.Step title="Pending" icon={<IconClock />} />
 * </AionSteps>
 *
 * Mini steps
 * <AionSteps current={1} size="small" type="dot">
 *   <AionSteps.Step title="Step 1" />
 *   <AionSteps.Step title="Step 2" />
 *   <AionSteps.Step title="Step 3" />
 * </AionSteps>
 * ```
 *
 * @see arco-override.css for custom styles (.aionui-steps)
 */
const AionSteps: React.FC<AionStepsProps> & { Step: typeof Steps.Step } = ({ className, ...props }) => {
  return <Steps {...props} className={classNames('aionui-steps', className)} />;
};

AionSteps.displayName = 'AionSteps';

// Export sub-component
AionSteps.Step = Steps.Step;

export default AionSteps;
