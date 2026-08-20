/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PropsWithChildren } from 'react';
import React from 'react';

const HOC = <HOCProps extends {}>(
  HOCComponent: React.FC<PropsWithChildren<HOCProps>>,
  hocProps?: Partial<HOCProps>
) => {
  return <Props extends Record<string, any>>(Component: React.FC<Props>): React.FC<Props> => {
    return (props: Props) => (
      <HOCComponent {...props} {...(hocProps || ({} as any))}>
        <Component {...props} />
      </HOCComponent>
    );
  };
};

const Create = <HOCProps extends {}>(
  HOCComponent: React.FC<HOCProps>,
  hocProps?: Partial<HOCProps>
): React.FC<HOCProps> => {
  return (props: HOCProps) => {
    return <HOCComponent {...(hocProps || {})} {...props} />;
  };
};

type HOCComponentAndProps<Props extends Record<string, any> = Record<string, any>> = [React.FC<Props>, Partial<Props>];

const Hook = (...hooks: Array<() => void>) => {
  return HOC.Create((props: any) => {
    hooks.forEach((hook) => hook());
    return <>{props.children}</>;
  });
};

// Apply the HOCs to the component right to left
const Wrapper = (...HOCComponents: Array<React.FC<any> | HOCComponentAndProps>) => {
  return <Props extends Record<string, any>>(Component: React.FC<Props>): React.FC<Props> => {
    // An explicit assertion keeps the types consistent through the reduce
    return HOCComponents.toReversed().reduce<React.FC<Props>>((Com, HOCComponent) => {
      if (Array.isArray(HOCComponent)) {
        // Assert the type so each HOC receives a React.FC<Props>
        return HOC(HOCComponent[0] as React.FC<any>, HOCComponent[1])(Com);
      }
      return HOC(HOCComponent as React.FC<any>)(Com);
    }, Component);
  };
};

HOC.Wrapper = Wrapper;

HOC.Create = Create;

HOC.Hook = Hook;

export default HOC;
