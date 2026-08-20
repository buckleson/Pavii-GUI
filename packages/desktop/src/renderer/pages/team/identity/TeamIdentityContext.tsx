/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext } from 'react';

/**
 * Cross-layer channel for reading team identity colours.
 *
 * The message render chain (AssistantChatSlot -> TeamChatView -> AcpChat -> MessageList ->
 * MessageText) is deep, and a teammate message carries only `senderConversationId`, from which the member instance and its colour must be recovered for the bubble bar and coloured sender name.
 * An optional context supplies the resolver: the team page provides it, while a non-team
 * conversation rendering MessageText sees null and renders plainly, so nothing outside teams is affected.
 */
type TeamIdentityContextValue = {
  colorOfConversation: (conversation_id: string | undefined) => string;
};

const TeamIdentityContext = createContext<TeamIdentityContextValue | null>(null);

export const TeamIdentityProvider: React.FC<{
  colorOfConversation: (conversation_id: string | undefined) => string;
  children: React.ReactNode;
}> = ({ colorOfConversation, children }) => {
  const value = React.useMemo(() => ({ colorOfConversation }), [colorOfConversation]);
  return <TeamIdentityContext.Provider value={value}>{children}</TeamIdentityContext.Provider>;
};

/** The sender's identity colour for a teammate message; undefined outside teams, meaning no colour. */
export const useTeammateColor = (senderConversationId: string | undefined): string | undefined => {
  const ctx = useContext(TeamIdentityContext);
  if (!ctx || !senderConversationId) return undefined;
  return ctx.colorOfConversation(senderConversationId);
};
