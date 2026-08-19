/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tag, Tooltip } from '@arco-design/web-react';
import { Stopwatch, Time } from '@icon-park/react';
import classNames from 'classnames';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { TASK_TEMPLATES, descriptionKeyOf, nameKeyOf, previewKeyOf, type TaskTemplate } from './taskTemplates';

type TaskTemplateGridProps = {
  isMobile?: boolean;
  onPick: (template: TaskTemplate) => void;
};

/**
 * Icon tile tints. Literal rgba rather than theme tokens so the tile reads the
 * same in both themes without six new variables.
 */
const ACCENT_TINT: Record<TaskTemplate['accent'], { bg: string; fg: string }> = {
  violet: { bg: 'rgba(112, 51, 255, 0.12)', fg: '#7033ff' },
  orange: { bg: 'rgba(232, 132, 42, 0.14)', fg: '#e8842a' },
  blue: { bg: 'rgba(63, 140, 255, 0.13)', fg: '#3f8cff' },
  green: { bg: 'rgba(23, 169, 127, 0.13)', fg: '#17a97f' },
  purple: { bg: 'rgba(168, 85, 217, 0.13)', fg: '#a855d9' },
  cyan: { bg: 'rgba(20, 165, 190, 0.13)', fg: '#14a5be' },
};

const useScheduleLabel = (): ((template: TaskTemplate) => string) => {
  const { t } = useTranslation();
  return (template: TaskTemplate) => {
    if (template.frequency === 'weekdays') {
      return `${t('cron.page.form.weekdays', { defaultValue: 'Weekdays' })} at ${template.time}`;
    }
    if (template.frequency === 'weekly') {
      return `Every ${template.weekday ?? ''} at ${template.time}`.replace('  ', ' ');
    }
    return `Every day at ${template.time}`;
  };
};

/**
 * Mock of what the task produces, revealed on hover. Deliberately abstract -
 * a couple of skeleton lines under a label - because a concrete fake result
 * would be a promise about output we cannot keep.
 */
const PreviewCard: React.FC<{ label: string; tint: { bg: string; fg: string } }> = ({ label, tint }) => (
  <div className='pointer-events-none w-160px rounded-10px border border-solid border-[var(--color-border-2)] bg-fill-1 p-10px shadow-lg'>
    <div className='mb-8px flex items-center gap-5px'>
      <span className='h-6px w-6px shrink-0 rounded-full' style={{ background: tint.fg }} />
      <span className='truncate text-11px font-600 text-t-primary'>{label}</span>
    </div>
    <div className='flex flex-col gap-5px'>
      <span className='block h-5px w-full rounded-3px bg-fill-3' />
      <span className='block h-5px w-4/5 rounded-3px bg-fill-3' />
      <span className='block h-5px w-3/5 rounded-3px bg-fill-3' />
    </div>
  </div>
);

/**
 * Starter automations shown when no scheduled tasks exist yet. Picking one
 * prefills the create dialog rather than creating anything, so the user always
 * reviews the prompt and schedule before a task goes live.
 */
const TaskTemplateGrid: React.FC<TaskTemplateGridProps> = ({ isMobile = false, onPick }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const scheduleLabel = useScheduleLabel();

  return (
    <div className='w-full' data-testid='task-template-grid'>
      {/* Empty state */}
      <div className='flex flex-col items-center py-40px'>
        <Stopwatch size={54} className='text-t-tertiary' />
        <div className='mt-14px text-13px text-t-tertiary'>
          {t('cron.templates.emptyTitle', { defaultValue: 'No scheduled tasks yet.' })}
        </div>
      </div>

      {/* Divider between "nothing here" and "here is what you could do" */}
      <div
        aria-hidden
        className='h-6px w-full opacity-40'
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='6' viewBox='0 0 16 6'%3E%3Cpath d='M0 3 Q 4 0 8 3 T 16 3' fill='none' stroke='%23888' stroke-width='1'/%3E%3C/svg%3E\")",
          backgroundRepeat: 'repeat-x',
        }}
      />

      <div className={classNames('mt-28px grid gap-x-24px gap-y-6px', isMobile ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2')}>
        {TASK_TEMPLATES.map((template) => {
          const Icon = template.icon;
          const tint = ACCENT_TINT[template.accent];
          return (
            <div
              key={template.id}
              role='button'
              tabIndex={0}
              data-testid={`task-template-${template.id}`}
              onClick={() => onPick(template)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onPick(template);
                }
              }}
              className='group relative cursor-pointer overflow-hidden rounded-12px p-12px transition-colors hover:bg-fill-2'
            >
              <div className='flex items-start gap-12px'>
                <div
                  className='mt-2px flex h-32px w-32px shrink-0 items-center justify-center rounded-9px'
                  style={{ background: tint.bg, color: tint.fg }}
                >
                  <Icon size={17} />
                </div>

                <div className='flex min-w-0 flex-1 flex-col gap-3px'>
                  <div className='text-13px font-600 leading-20px text-t-primary'>{t(nameKeyOf(template))}</div>
                  <div className='text-12px leading-18px text-t-secondary'>{t(descriptionKeyOf(template))}</div>

                  <div className='mt-5px flex flex-wrap items-center gap-8px'>
                    <span className='flex items-center gap-5px text-11px leading-16px text-t-tertiary'>
                      <Time size={12} />
                      {scheduleLabel(template)}
                    </span>

                    {template.requiresKey && (
                      <Tooltip content={t('cron.templates.requiresAction', { defaultValue: 'Add it in Settings > Tools' })}>
                        <Tag
                          size='small'
                          bordered
                          data-testid={`task-template-${template.id}-requires`}
                          className='!text-11px !leading-16px cursor-pointer'
                          onClick={(event: React.MouseEvent) => {
                            // The row opens the dialog; this goes elsewhere, so
                            // it must not do both.
                            event.stopPropagation();
                            navigate('/settings/tools');
                          }}
                        >
                          {t(template.requiresKey)}
                        </Tag>
                      </Tooltip>
                    )}
                  </div>
                </div>
              </div>

              {/* Peeks in from the right edge on hover, clipped by the row. */}
              <div
                aria-hidden
                data-testid={`task-template-${template.id}-preview`}
                className='absolute bottom-8px right-0 translate-x-full opacity-0 transition-all duration-200 ease-out group-hover:translate-x-8px group-hover:opacity-100'
              >
                <PreviewCard label={t(previewKeyOf(template))} tint={tint} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TaskTemplateGrid;
