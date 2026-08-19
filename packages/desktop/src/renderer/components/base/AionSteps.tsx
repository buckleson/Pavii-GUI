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
  /** 额外的类名 / Additional class name */
  className?: string;
}

/**
 * Steps component
 *
 * 基于 Arco Design Steps 的封装，提供统一的样式主题
 * Wrapper around Arco Design Steps with unified theme styling
 *
 * @features
 * Custom brand color theme
 * Special styling for finished state
 * Full Arco Steps API support
 *
 * @example
 * ```tsx
 * // 基本用法 / Basic usage
 * <AionSteps current={1}>
 *   <AionSteps.Step title="步骤1" description="这是描述" />
 *   <AionSteps.Step title="步骤2" description="这是描述" />
 *   <AionSteps.Step title="步骤3" description="这是描述" />
 * </AionSteps>
 *
 * // 垂直步骤条 / Vertical steps
 * <AionSteps current={1} direction="vertical">
 *   <AionSteps.Step title="步骤1" description="描述" />
 *   <AionSteps.Step title="步骤2" description="描述" />
 * </AionSteps>
 *
 * // 带图标的步骤条 / Steps with icons
 * <AionSteps current={1}>
 *   <AionSteps.Step title="完成" icon={<IconCheck />} />
 *   <AionSteps.Step title="进行中" icon={<IconLoading />} />
 *   <AionSteps.Step title="待处理" icon={<IconClock />} />
 * </AionSteps>
 *
 * // 迷你版步骤条 / Mini steps
 * <AionSteps current={1} size="small" type="dot">
 *   <AionSteps.Step title="步骤1" />
 *   <AionSteps.Step title="步骤2" />
 *   <AionSteps.Step title="步骤3" />
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
