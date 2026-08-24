/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mapAcpCommandsToSlashCommands } from './acpMapping';
import { buildSkillSlashCommands, mergeSlashCommands, orderSlashCommandsForDisplay } from './mergeSlashCommands';
import type { AcpAvailableCommand, AcpSlashCommandApiItem, SlashCommandItem } from './types';

type AcpSlashCommandLike = AcpAvailableCommand | AcpSlashCommandApiItem;

type BuildGuidSlashCommandsInput = {
  builtinCommands: readonly SlashCommandItem[];
  agentCommands?: readonly SlashCommandItem[];
  selectedSkills: readonly string[];
  descriptionByName: ReadonlyMap<string, string>;
  skillFallbackDescription: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseJsonPayload = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
};

const isAcpSlashCommandLike = (value: unknown): value is AcpSlashCommandLike => {
  if (!isRecord(value) || typeof value.description !== 'string') {
    return false;
  }

  return typeof value.name === 'string' || typeof value.command === 'string';
};

const readCommandArray = (value: unknown): unknown[] => {
  const payload = parseJsonPayload(value);
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!isRecord(payload)) {
    return [];
  }

  if (Array.isArray(payload.available_commands)) {
    return payload.available_commands;
  }

  if (Array.isArray(payload.commands)) {
    return payload.commands;
  }

  return [];
};

export const mapAgentAvailableCommandsToSlashCommands = (value: unknown): SlashCommandItem[] => {
  const commands = readCommandArray(value).filter(isAcpSlashCommandLike);
  if (commands.length === 0) {
    return [];
  }

  return mapAcpCommandsToSlashCommands(commands);
};

export const buildGuidSlashCommands = ({
  builtinCommands,
  agentCommands,
  selectedSkills,
  descriptionByName,
  skillFallbackDescription,
}: BuildGuidSlashCommandsInput): SlashCommandItem[] => {
  const safeAgentCommands = agentCommands ?? [];
  // Skills used to be dropped entirely whenever the agent advertised any
  // command, so on every real agent the skills half of the menu was empty.
  // Both belong in the list; name collisions are already resolved by
  // mergeSlashCommands (builtin > agent > skill).
  const skillCommands = buildSkillSlashCommands(selectedSkills, descriptionByName, skillFallbackDescription);

  return orderSlashCommandsForDisplay(mergeSlashCommands(builtinCommands, safeAgentCommands, skillCommands));
};
