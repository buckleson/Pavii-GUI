/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Turning a picked slash skill into a real skill load.
 *
 * Selecting a skill from the "/" menu only ever inserted `/name ` as text. The
 * agent has no `/`-based skill resolution — skills reach it through the
 * structured `inject_skills` field on the send payload — so the text did
 * nothing and the skill was never actually loaded. This resolves what the user
 * picked into that field.
 */

/** Escape a skill name for literal use inside a RegExp. */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Does the outgoing text still contain the `/name` token?
 *
 * Picking a skill inserts the token, but the user may then delete it, retype
 * the message, or pick a different skill. Injecting a skill whose token is gone
 * would load something the user visibly removed.
 *
 * The token must be followed by a boundary so `/tdd` does not match `/tdd-x`.
 */
export function textMentionsSlashSkill(text: string, name: string): boolean {
  if (!name) return false;
  return new RegExp(`(^|\\s)/${escapeForRegExp(name)}(?![\\w-])`).test(text);
}

/**
 * The skills to send as `inject_skills` for this message.
 *
 * Skills already mounted on the conversation are excluded: the engine has them
 * for every turn already, and re-sending would pay their prompt cost twice.
 *
 * Returns undefined rather than an empty array when there is nothing to inject,
 * so the field is omitted from the payload entirely and the request shape is
 * unchanged for ordinary messages.
 */
export function resolvePendingInjectSkills(
  text: string,
  pending: Iterable<string>,
  loadedSkills: readonly string[] | undefined
): string[] | undefined {
  const loaded = new Set(loadedSkills ?? []);
  const resolved: string[] = [];

  for (const name of pending) {
    if (loaded.has(name)) continue;
    if (!textMentionsSlashSkill(text, name)) continue;
    if (!resolved.includes(name)) resolved.push(name);
  }

  return resolved.length > 0 ? resolved : undefined;
}
