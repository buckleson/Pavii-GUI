/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Emits `$pageview` on route changes.
 *
 * PostHog's own `capture_pageview` is disabled: the app uses a `HashRouter`, and
 * the packaged build loads the renderer over `file://`, so the URL PostHog would
 * derive is an install path rather than a route. This templatises the route
 * first (`/settings/skills/detail/:skillName`, never the skill name) and sends
 * only that.
 *
 * Must be rendered inside the router so `useLocation` is available.
 */

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { normaliseRoute } from '@/common/analytics/routes';
import { setCurrentRoute, trackPageview } from './posthog';

const PostHogRouteTracker: React.FC = () => {
  const location = useLocation();

  useEffect(() => {
    const route = normaliseRoute(location.pathname);
    setCurrentRoute(route);
    trackPageview(route);
  }, [location.pathname]);

  return null;
};

export default PostHogRouteTracker;
