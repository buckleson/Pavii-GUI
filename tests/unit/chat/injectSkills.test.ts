/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { resolvePendingInjectSkills, textMentionsSlashSkill } from '@/common/chat/slash/injectSkills';

describe('textMentionsSlashSkill', () => {
  it('matches the token the slash menu inserts at the start of an empty input', () => {
    // Picking a skill in an empty composer produces exactly `/tdd `. If this
    // does not match, the most common pick of all resolves to no skill and the
    // agent silently runs without it.
    expect(textMentionsSlashSkill('/tdd ', 'tdd')).toBe(true);
    expect(textMentionsSlashSkill('/tdd', 'tdd')).toBe(true);
    expect(textMentionsSlashSkill('/tdd write the test', 'tdd')).toBe(true);
  });

  it('matches a token typed after existing text', () => {
    // The menu can be opened mid-message, so the token is preceded by a space
    // or a newline rather than the string start.
    expect(textMentionsSlashSkill('please use /tdd here', 'tdd')).toBe(true);
    expect(textMentionsSlashSkill('line one\n/tdd', 'tdd')).toBe(true);
    expect(textMentionsSlashSkill('tabbed\t/tdd', 'tdd')).toBe(true);
  });

  it('does not match a token glued to the preceding character', () => {
    // A file path or URL fragment must never be read as a skill pick, or
    // mentioning `docs/tdd` would silently load and bill a skill.
    expect(textMentionsSlashSkill('foo/tdd', 'tdd')).toBe(false);
    expect(textMentionsSlashSkill('see docs/tdd for details', 'tdd')).toBe(false);
    expect(textMentionsSlashSkill('https://x.dev/tdd', 'tdd')).toBe(false);
  });

  it('does not treat a longer skill name as a mention of its prefix', () => {
    // `tdd` and `tdd-extra` can both be loaded. Matching on prefix would inject
    // the wrong skill whenever one name starts with another.
    expect(textMentionsSlashSkill('/tdd-extra', 'tdd')).toBe(false);
    expect(textMentionsSlashSkill('/tdd_extra', 'tdd')).toBe(false);
    expect(textMentionsSlashSkill('/tddextra', 'tdd')).toBe(false);
  });

  it('does not treat a shorter skill name as a mention of a longer one', () => {
    // The opposite direction of the same collision: picking `/tdd` must not
    // resolve to `tdd-extra`.
    expect(textMentionsSlashSkill('/tdd', 'tdd-extra')).toBe(false);
    expect(textMentionsSlashSkill('/tdd-extra', 'tdd-extra')).toBe(true);
  });

  it('still matches when the token is followed by punctuation', () => {
    // Users end sentences. `/tdd.` and `/tdd,` are the same pick, so requiring
    // a trailing space would drop the skill from real messages.
    expect(textMentionsSlashSkill('use /tdd.', 'tdd')).toBe(true);
    expect(textMentionsSlashSkill('use /tdd, then stop', 'tdd')).toBe(true);
    expect(textMentionsSlashSkill('(/tdd)', 'tdd')).toBe(false);
  });

  it('treats regex metacharacters in a skill name as literal text', () => {
    // Skill names come from the filesystem and may contain `+` or `.`. An
    // unescaped name would either throw on an invalid pattern or match wildly —
    // `a.b` matching `axb` would inject a skill the user never picked.
    expect(textMentionsSlashSkill('/c++helper', 'c++helper')).toBe(true);
    expect(textMentionsSlashSkill('/chelper', 'c++helper')).toBe(false);
    expect(textMentionsSlashSkill('/a.b', 'a.b')).toBe(true);
    expect(textMentionsSlashSkill('/axb', 'a.b')).toBe(false);
  });

  it('does not throw or match on an unbalanced-bracket skill name', () => {
    // `[` alone is an invalid RegExp fragment; without escaping this construction
    // throws and takes down the whole send path, not just the injection.
    expect(() => textMentionsSlashSkill('/a[b', 'a[b')).not.toThrow();
    expect(textMentionsSlashSkill('/a[b', 'a[b')).toBe(true);
    expect(textMentionsSlashSkill('/ab', 'a[b')).toBe(false);
  });

  it('never matches an empty skill name', () => {
    // An empty name would compile to a bare `/` pattern and claim that every
    // message containing a slash mentions the skill.
    expect(textMentionsSlashSkill('/tdd', '')).toBe(false);
    expect(textMentionsSlashSkill('a / b', '')).toBe(false);
    expect(textMentionsSlashSkill('', '')).toBe(false);
  });

  it('does not match in an empty message', () => {
    // Sending an empty composer must not carry a stale pending pick.
    expect(textMentionsSlashSkill('', 'tdd')).toBe(false);
    expect(textMentionsSlashSkill('   ', 'tdd')).toBe(false);
  });

  it('is case-sensitive on the skill name', () => {
    // Skill names are exact identifiers the engine looks up; a case-insensitive
    // match would resolve to a name the engine cannot load.
    expect(textMentionsSlashSkill('/TDD', 'tdd')).toBe(false);
  });
});

describe('resolvePendingInjectSkills', () => {
  it('returns undefined rather than an empty array when nothing qualifies', () => {
    // The caller spreads this into the send payload. `[]` would add an
    // `inject_skills` field to every ordinary message and change the request
    // shape for users who never touched the slash menu.
    expect(resolvePendingInjectSkills('hello', [], undefined)).toBeUndefined();
    expect(resolvePendingInjectSkills('', [], [])).toBeUndefined();
  });

  it('injects a picked skill whose token survived in the message', () => {
    // The whole point of the module: a pick must reach the structured field,
    // because the agent has no `/`-based skill resolution.
    expect(resolvePendingInjectSkills('/tdd write it', ['tdd'], undefined)).toEqual(['tdd']);
  });

  it('drops a skill whose token the user deleted before sending', () => {
    // Picking then erasing the text is the normal way to cancel. Injecting
    // anyway loads a skill with no visible trace in the sent message.
    expect(resolvePendingInjectSkills('write it', ['tdd'], undefined)).toBeUndefined();
    expect(resolvePendingInjectSkills('/tdd-extra only', ['tdd'], undefined)).toBeUndefined();
  });

  it('drops a skill already mounted on the conversation', () => {
    // The engine already carries loaded skills on every turn. Re-sending pays
    // their prompt cost twice for no behavior change.
    expect(resolvePendingInjectSkills('/tdd now', ['tdd'], ['tdd'])).toBeUndefined();
  });

  it('injects only the skills that are not already loaded', () => {
    const resolved = resolvePendingInjectSkills('/tdd and /cron', ['tdd', 'cron'], ['cron']);

    expect(resolved).toEqual(['tdd']);
  });

  it('preserves pending order for multiple valid skills', () => {
    // The order reaches the agent as prompt order; reordering silently changes
    // which instructions win when two skills disagree.
    const resolved = resolvePendingInjectSkills('/cron then /tdd', ['cron', 'tdd'], undefined);

    expect(resolved).toEqual(['cron', 'tdd']);
  });

  it('deduplicates a skill picked more than once', () => {
    // Picking the same entry twice is easy; a duplicate would load the skill
    // twice in one turn.
    const resolved = resolvePendingInjectSkills('/tdd and /tdd again', ['tdd', 'tdd'], undefined);

    expect(resolved).toEqual(['tdd']);
  });

  it('accepts any iterable of pending names, not just an array', () => {
    // The caller holds pending picks in a Set. Requiring an array here would
    // break at the call site rather than in this module.
    const resolved = resolvePendingInjectSkills('/tdd and /cron', new Set(['tdd', 'cron']), undefined);

    expect(resolved).toEqual(['tdd', 'cron']);
  });

  it('treats a missing loaded-skills snapshot as nothing loaded', () => {
    // The snapshot is undefined before the conversation reports its skills. A
    // crash or a blanket exclusion there would break the first message of a
    // session.
    expect(resolvePendingInjectSkills('/tdd', ['tdd'], undefined)).toEqual(['tdd']);
    expect(resolvePendingInjectSkills('/tdd', ['tdd'], [])).toEqual(['tdd']);
  });

  it('ignores an empty pending name', () => {
    // An empty entry would otherwise match any message containing a slash and
    // send an unloadable empty skill name to the engine.
    expect(resolvePendingInjectSkills('/tdd', [''], undefined)).toBeUndefined();
  });

  it('resolves the surviving pick when only one of several tokens remains', () => {
    const resolved = resolvePendingInjectSkills('/cron only', ['tdd', 'cron', 'pavii-cli'], undefined);

    expect(resolved).toEqual(['cron']);
  });
});
