/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Starter automations offered on the Scheduled Tasks empty state.
 *
 * Clicking one opens the New Task dialog prefilled; nothing is created until
 * the user saves, so they always see what will run before it runs.
 *
 * Three of these work on a fresh install. The other three depend on an MCP
 * server the app does not bundle - the app has no email integration, and Slack
 * ships only as a channel bridge (you message the assistant *from* Slack), not
 * as a source it can read from. Those carry `requiresKey` so the card can say
 * so instead of producing a task that quietly fails or invents its answer.
 */

import { AtSign, Layers, ListCheckbox, MailReview, Sunrise, TrendTwo } from '@icon-park/react';
import type React from 'react';

/** Subset of the dialog's frequency options that templates use. */
export type TemplateFrequency = 'daily' | 'weekdays' | 'weekly';

export type TaskTemplate = {
  /** Stable id - drives i18n keys and test ids. */
  id: string;
  icon: React.ComponentType<{ size?: number | string; theme?: string }>;
  frequency: TemplateFrequency;
  /** 24h 'HH:mm'. */
  time: string;
  /** Required for weekly templates, ignored otherwise. */
  weekday?: string;
  /** Accent used for the icon tile, as an `--color-*` token suffix. */
  accent: 'violet' | 'orange' | 'blue' | 'green' | 'purple' | 'cyan';
  /** Set only when the template needs something the app does not bundle. */
  requiresKey?: string;
};

const key = (id: string, field: string): string => `cron.templates.${id}.${field}`;

export const nameKeyOf = (template: TaskTemplate): string => key(template.id, 'name');
export const descriptionKeyOf = (template: TaskTemplate): string => key(template.id, 'description');
export const promptKeyOf = (template: TaskTemplate): string => key(template.id, 'prompt');

export const TASK_TEMPLATES: readonly TaskTemplate[] = [
  {
    id: 'dailyPlan',
    accent: 'violet',
    icon: ListCheckbox,
    frequency: 'weekdays',
    time: '08:30',
  },
  {
    id: 'morningBriefing',
    accent: 'orange',
    icon: Sunrise,
    frequency: 'daily',
    time: '07:30',
  },
  {
    id: 'projectDigest',
    accent: 'blue',
    icon: Layers,
    frequency: 'weekly',
    time: '17:00',
    weekday: 'FRI',
  },
  {
    id: 'inboxSummary',
    accent: 'green',
    icon: MailReview,
    frequency: 'weekdays',
    time: '08:00',
    requiresKey: 'cron.templates.requiresEmail',
  },
  {
    id: 'slackCatchUp',
    accent: 'purple',
    icon: AtSign,
    frequency: 'weekdays',
    time: '09:00',
    requiresKey: 'cron.templates.requiresSlack',
  },
  {
    id: 'growthReport',
    accent: 'cyan',
    icon: TrendTwo,
    frequency: 'weekly',
    time: '09:00',
    weekday: 'MON',
    requiresKey: 'cron.templates.requiresAnalytics',
  },
];

/** What the dialog needs to prefill itself from a template. */
export type TaskTemplatePrefill = {
  frequency: TemplateFrequency;
  name: string;
  prompt: string;
  time: string;
  weekday?: string;
};
