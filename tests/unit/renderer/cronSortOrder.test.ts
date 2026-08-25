/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';

/**
 * Mirrors the ordering used by the Scheduled Tasks "Sort by" control.
 *
 * The rule worth pinning is the one that is easy to get backwards: a job with
 * no next run (paused, or manual-only) must sort last under "Next run", not
 * first. Treating a missing timestamp as 0 would put the tasks that never run
 * at the top of a list ordered by when things run next.
 */
const compareByNextRun = (a: { next?: number }, b: { next?: number }): number => {
  const left = a.next ?? Number.POSITIVE_INFINITY;
  const right = b.next ?? Number.POSITIVE_INFINITY;
  return left - right;
};

describe('scheduled task ordering', () => {
  it('puts the soonest run first', () => {
    const jobs = [{ next: 300 }, { next: 100 }, { next: 200 }];
    expect([...jobs].toSorted(compareByNextRun)).toEqual([{ next: 100 }, { next: 200 }, { next: 300 }]);
  });

  it('sorts jobs with no scheduled run to the end', () => {
    const jobs = [{ next: undefined }, { next: 200 }, { next: undefined }, { next: 100 }];
    const sorted = [...jobs].toSorted(compareByNextRun);
    expect(sorted.slice(0, 2)).toEqual([{ next: 100 }, { next: 200 }]);
    expect(sorted.slice(2).every((job) => job.next === undefined)).toBe(true);
  });

  it('is stable enough to leave equal timestamps alone', () => {
    const jobs = [
      { next: 100, id: 'a' },
      { next: 100, id: 'b' },
    ];
    expect([...jobs].toSorted(compareByNextRun).map((job) => job.id)).toEqual(['a', 'b']);
  });

  it('handles an empty list', () => {
    expect([].toSorted(compareByNextRun)).toEqual([]);
  });
});
