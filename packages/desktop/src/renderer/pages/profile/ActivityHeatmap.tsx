/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tooltip } from '@arco-design/web-react';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { DayActivity } from './profileStats';
import { formatCompactNumber } from './profileStats';

const WEEKS = 53;
const ROWS = 7;
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const intensityOf = (value: number, max: number): number => {
  if (value <= 0 || max <= 0) return 0;
  const ratio = value / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
};

const CELL_OPACITY = [0, 0.3, 0.5, 0.75, 1];

/** GitHub-style daily activity heatmap over the trailing 12 months. */
const ActivityHeatmap: React.FC<{ daily: DayActivity[] }> = ({ daily }) => {
  const { t } = useTranslation();

  const { cells, monthMarks } = useMemo(() => {
    const byDay = new Map(daily.map((d) => [d.day, d]));
    const max = Math.max(...daily.map((d) => (d.tokens > 0 ? d.tokens : d.activity)), 1);
    const today = new Date();
    const cellRows: Array<Array<{ key: string; level: number; tokens: number; activity: number }>> = [];
    const marks: Array<{ week: number; label: string }> = [];
    let lastMonth = -1;
    for (let w = 0; w < WEEKS; w++) {
      const column: Array<{ key: string; level: number; tokens: number; activity: number }> = [];
      for (let r = 0; r < ROWS; r++) {
        const daysAgo = (WEEKS - 1 - w) * 7 + (ROWS - 1 - r);
        const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo);
        const key = `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
        const row = byDay.get(key);
        const value = row ? (row.tokens > 0 ? row.tokens : row.activity) : 0;
        column.push({ key, level: intensityOf(value, max), tokens: row?.tokens ?? 0, activity: row?.activity ?? 0 });
        if (r === 0 && date.getMonth() !== lastMonth) {
          lastMonth = date.getMonth();
          marks.push({ week: w, label: MONTH_LABELS[lastMonth] });
        }
      }
      cellRows.push(column);
    }
    return { cells: cellRows, monthMarks: marks.slice(1) };
  }, [daily]);

  return (
    <div className='overflow-x-auto'>
      <div className='relative mb-4px h-14px text-11px text-t-tertiary'>
        {monthMarks.map((mark) => (
          <span key={`${mark.week}-${mark.label}`} className='absolute' style={{ left: mark.week * 13 }}>
            {mark.label}
          </span>
        ))}
      </div>
      <div className='flex gap-3px'>
        {cells.map((column, w) => (
          <div key={w} className='flex flex-col gap-3px'>
            {column.map((cell) => (
              <Tooltip
                key={cell.key}
                content={
                  cell.tokens > 0
                    ? t('profile.heatmapTokens', {
                        defaultValue: '{{count}} tokens on {{day}}',
                        count: formatCompactNumber(cell.tokens) as unknown as number,
                        day: cell.key,
                      })
                    : t('profile.heatmapActivity', {
                        defaultValue: '{{count}} activities on {{day}}',
                        count: cell.activity,
                        day: cell.key,
                      })
                }
              >
                <div
                  className='size-10px rounded-2px'
                  style={{
                    backgroundColor:
                      cell.level === 0 ? 'var(--bg-3)' : `rgba(var(--primary-6), ${CELL_OPACITY[cell.level]})`,
                  }}
                  data-level={cell.level}
                />
              </Tooltip>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ActivityHeatmap;
