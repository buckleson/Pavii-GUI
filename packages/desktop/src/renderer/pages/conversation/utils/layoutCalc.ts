// Layout constants for the chat layout panel sizing
export const MIN_CHAT_RATIO = 25;
export const MIN_PREVIEW_RATIO = 20;
export const WORKSPACE_HEADER_HEIGHT = 32;
export const MIN_CHAT_PANEL_PX = 360;
export const MIN_PREVIEW_PANEL_PX = 340;
export const MIN_WORKSPACE_PANEL_PX = 220;
export const MAX_WORKSPACE_PANEL_PX = 500;
export const DEFAULT_WORKSPACE_PANEL_PX = 260;
/**
 * Horizontal chrome of the Layout-hoisted preview region (stage3 FULL / P4):
 * its `ml-8` + `mr-12` margins + `1px` border on each side, plus a small
 * rounding buffer. The two width clamps must subtract this so the
 * [content | preview | explorer] row never exceeds the measured row width —
 * otherwise the preview's margins push the explorer column (and its right-side
 * button cluster) past the viewport edge at wider explorer widths.
 */
export const PREVIEW_REGION_CHROME_PX = 24;

export type LayoutCalcInput = {
  containerWidth: number;
  /** Workspace width the user prefers, in pixels */
  workspaceWidthPx: number;
  chatSplitRatio: number;
  workspaceEnabled: boolean;
  isDesktop: boolean;
  isPreviewOpen: boolean;
  rightSiderCollapsed: boolean;
  isMobile: boolean;
};

export type LayoutMetrics = {
  /** Effective desktop workspace width in pixels, already capped against the container width */
  effectiveWorkspaceWidthPx: number;
  dynamicChatMinRatio: number;
  dynamicChatMaxRatio: number;
  /** flex-grow of the chat area within the main region: 100 when preview is closed, otherwise split by chatSplitRatio */
  chatFlex: number;
  /** Final workspace width in pixels: the mobile value on mobile, effectiveWorkspaceWidthPx on desktop */
  workspaceWidthPx: number;
  mobileWorkspaceWidthPx: number;
  titleAreaMaxWidth: number;
  mobileWorkspaceHandleRight: number;
};

/**
 * Compute all derived layout metrics. Workspace width is fixed px, not a
 * percentage of the container — the chat area absorbs viewport size changes.
 */
export const calcLayoutMetrics = (input: LayoutCalcInput): LayoutMetrics => {
  const {
    containerWidth,
    workspaceWidthPx: requestedWorkspaceWidthPx,
    chatSplitRatio,
    workspaceEnabled,
    isDesktop,
    isPreviewOpen,
    rightSiderCollapsed,
    isMobile,
  } = input;

  const safeContainerWidth = Math.max(containerWidth || 0, 1);

  // The workspace is a fixed pixel width on desktop, capped down when the container is narrow but never below MIN
  const workspaceVisible = workspaceEnabled && isDesktop && !rightSiderCollapsed;
  const previewReservedPx = isPreviewOpen ? MIN_CHAT_PANEL_PX + MIN_PREVIEW_PANEL_PX : MIN_CHAT_PANEL_PX;
  const workspaceMaxByContainer = Math.max(MIN_WORKSPACE_PANEL_PX, safeContainerWidth - previewReservedPx);
  const effectiveWorkspaceWidthPx = workspaceVisible
    ? Math.max(
        MIN_WORKSPACE_PANEL_PX,
        Math.min(MAX_WORKSPACE_PANEL_PX, requestedWorkspaceWidthPx, workspaceMaxByContainer)
      )
    : 0;

  // Work out the dynamic chat/preview ratio constraints from the remaining width
  const availableWidthForChatPreview = Math.max(safeContainerWidth - effectiveWorkspaceWidthPx, 1);
  const minChatRatioByPx = (MIN_CHAT_PANEL_PX / availableWidthForChatPreview) * 100;
  const minPreviewRatioByPx = (MIN_PREVIEW_PANEL_PX / availableWidthForChatPreview) * 100;
  const dynamicChatMinRatio =
    workspaceEnabled && isDesktop && isPreviewOpen ? Math.max(MIN_CHAT_RATIO, minChatRatioByPx) : MIN_CHAT_RATIO;
  const dynamicChatMaxCandidate =
    workspaceEnabled && isDesktop && isPreviewOpen
      ? Math.min(80, 100 - Math.max(MIN_PREVIEW_RATIO, minPreviewRatioByPx))
      : 80;
  const dynamicChatMaxRatio = Math.max(dynamicChatMinRatio, dynamicChatMaxCandidate);

  // chat-area flex: the flex-grow of the chat panel inside the outer chat+preview container.
  // Split by chatSplitRatio while preview is open, otherwise the chat area takes it all
  const chatFlex = isDesktop ? (isPreviewOpen ? chatSplitRatio : 100) : 100;

  // Mobile workspace width (an overlay drawer)
  const viewportWidth = containerWidth || (typeof window === 'undefined' ? 0 : window.innerWidth);
  const mobileWorkspaceWidthPx = Math.min(
    Math.max(300, Math.round(viewportWidth * 0.84)),
    Math.max(300, Math.min(420, viewportWidth - 20))
  );
  const workspaceWidthPx = workspaceEnabled ? (isMobile ? mobileWorkspaceWidthPx : effectiveWorkspaceWidthPx) : 0;

  const mobileWorkspaceHandleRight = rightSiderCollapsed ? 0 : Math.max(0, Math.round(workspaceWidthPx) - 14);
  const titleAreaMaxWidth = Math.max(320, Math.min(820, containerWidth - 520));

  return {
    effectiveWorkspaceWidthPx,
    dynamicChatMinRatio,
    dynamicChatMaxRatio,
    chatFlex,
    workspaceWidthPx,
    mobileWorkspaceWidthPx,
    titleAreaMaxWidth,
    mobileWorkspaceHandleRight,
  };
};
