/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { Card, Tag, Tooltip } from '@arco-design/web-react';
import classNames from 'classnames';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { TASK_TEMPLATES, descriptionKeyOf, nameKeyOf, type TaskTemplate } from './taskTemplates';

type TaskTemplateGridProps = {
  isMobile?: boolean;
  onPick: (template: TaskTemplate) => void;
};

/**
 * Icon tile tints. Kept as literal rgba rather than theme tokens so the tile
 * reads the same in both themes without six new variables.
 */
const ACCENT_TINT: Record<TaskTemplate['accent'], { bg: string; fg: string }> = {
  violet: { bg: 'rgba(112, 51, 255, 0.12)', fg: '#7033ff' },
  orange: { bg: 'rgba(232, 132, 42, 0.14)', fg: '#e8842a' },
  blue: { bg: 'rgba(63, 140, 255, 0.13)', fg: '#3f8cff' },
  green: { bg: 'rgba(23, 169, 127, 0.13)', fg: '#17a97f' },
  purple: { bg: 'rgba(168, 85, 217, 0.13)', fg: '#a855d9' },
  cyan: { bg: 'rgba(20, 165, 190, 0.13)', fg: '#14a5be' },
};

/** Human-readable schedule for a template card. */
const useScheduleLabel = (): ((template: TaskTemplate) => string) => {
  const { t } = useTranslation();
  return (template: TaskTemplate) => {
    if (template.frequency === 'weekdays') {
      return `${t('cron.page.form.weekdays', { defaultValue: 'Weekdays' })} · ${template.time}`;
    }
    if (template.frequency === 'weekly') {
      return `${template.weekday ?? ''} · ${template.time}`.trim();
    }
    return `${t('cron.page.form.daily', { defaultValue: 'Daily' })} · ${template.time}`;
  };
};

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
      <div className='mb-16px'>
        <div className='text-15px font-600 leading-22px text-t-primary'>
          {t('cron.templates.heading', { defaultValue: 'Start with an automation' })}
        </div>
        <div className='mt-3px text-12px leading-18px text-t-tertiary'>
          {t('cron.templates.subheading', {
            defaultValue: 'Pick one to open it prefilled, then choose your assistant and time.',
          })}
        </div>
      </div>

      <div className={classNames('grid gap-10px', isMobile ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2')}>
        {TASK_TEMPLATES.map((template) => {
          const Icon = template.icon;
          const tint = ACCENT_TINT[template.accent];
          return (
            <Card
              key={template.id}
              hoverable
              size='small'
              data-testid={`task-template-${template.id}`}
              onClick={() => onPick(template)}
              className='group h-full cursor-pointer rounded-14px'
              bodyStyle={{ padding: 14, height: '100%' }}
            >
              <div className='flex h-full items-start gap-12px'>
                <div
                  className='mt-1px flex h-32px w-32px shrink-0 items-center justify-center rounded-9px'
                  style={{ background: tint.bg, color: tint.fg }}
                >
                  <Icon size={17} />
                </div>

                <div className='flex min-w-0 flex-1 flex-col gap-4px'>
                  <div className='truncate text-13px font-600 leading-20px text-t-primary'>{t(nameKeyOf(template))}</div>
                  <div className='text-12px leading-17px text-t-secondary'>{t(descriptionKeyOf(template))}</div>

                  <div className='mt-6px flex flex-wrap items-center gap-6px'>
                    <span className='rounded-5px bg-fill-2 px-6px py-2px text-11px leading-16px text-t-tertiary'>
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
                            // The card opens the dialog; this goes somewhere
                            // else, so it must not do both.
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
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default TaskTemplateGrid;
