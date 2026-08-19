/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  TASK_TEMPLATES,
  descriptionKeyOf,
  nameKeyOf,
  promptKeyOf,
} from '@/renderer/pages/cron/ScheduledTasksPage/taskTemplates';

const LOCALES_DIR = path.resolve(__dirname, '../../../packages/desktop/src/renderer/services/i18n/locales');

type CronLocale = Record<string, unknown>;

const readCronLocale = (locale: string): CronLocale =>
  JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, locale, 'cron.json'), 'utf-8')) as CronLocale;

/**
 * Resolve a t() key the way the app does: cron.json is loaded as the `cron`
 * module and its contents are nested objects, so `cron.templates.x.name` walks
 * templates -> x -> name. Writing the dotted key literally into the file made
 * every lookup miss and rendered the raw key in the UI.
 */
const resolveKey = (strings: CronLocale, key: string): string | undefined => {
  const parts = key.replace(/^cron\./, '').split('.');
  let node: unknown = strings;
  for (const part of parts) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
};

describe('TASK_TEMPLATES', () => {
  it('offers six starter automations', () => {
    expect(TASK_TEMPLATES).toHaveLength(6);
  });

  it('uses unique ids', () => {
    const ids = TASK_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every template a valid 24h time', () => {
    for (const template of TASK_TEMPLATES) {
      expect(template.time, template.id).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
    }
  });

  it('gives weekly templates a weekday and leaves the others without one', () => {
    for (const template of TASK_TEMPLATES) {
      if (template.frequency === 'weekly') {
        expect(template.weekday, template.id).toMatch(/^(MON|TUE|WED|THU|FRI|SAT|SUN)$/);
      } else {
        expect(template.weekday, template.id).toBeUndefined();
      }
    }
  });

  it('flags exactly the templates that need an integration the app does not bundle', () => {
    // The app ships no email integration, and Slack is only a channel bridge -
    // these three cannot run on a fresh install and must say so.
    const gated = TASK_TEMPLATES.filter((template) => template.requiresKey).map((template) => template.id);
    expect(gated.sort()).toEqual(['growthReport', 'inboxSummary', 'slackCatchUp']);
  });

  it('resolves every referenced key in en-US', () => {
    const strings = readCronLocale('en-US');
    for (const template of TASK_TEMPLATES) {
      expect(resolveKey(strings, nameKeyOf(template)), `${template.id} name`).toBeTruthy();
      expect(resolveKey(strings, descriptionKeyOf(template)), `${template.id} description`).toBeTruthy();
      expect(resolveKey(strings, promptKeyOf(template)), `${template.id} prompt`).toBeTruthy();
      if (template.requiresKey) {
        expect(resolveKey(strings, template.requiresKey), `${template.id} requires`).toBeTruthy();
      }
    }
    expect(resolveKey(strings, 'cron.templates.heading')).toBeTruthy();
    expect(resolveKey(strings, 'cron.templates.requiresAction')).toBeTruthy();
  });

  it('keeps the keys present in every locale', () => {
    // scripts/check-i18n.js enforces parity; this fails fast in the unit run.
    const locales = fs.readdirSync(LOCALES_DIR).filter((entry) => fs.statSync(path.join(LOCALES_DIR, entry)).isDirectory());
    const required = TASK_TEMPLATES.flatMap((template) => [nameKeyOf(template), descriptionKeyOf(template), promptKeyOf(template)]);

    for (const locale of locales) {
      const strings = readCronLocale(locale);
      for (const key of required) {
        expect(resolveKey(strings, key), `${locale} missing ${key}`).toBeTruthy();
      }
    }
  });

  it('stores keys nested, so t() actually resolves them', () => {
    // Regression: these were written as flat dotted keys and the UI rendered
    // "cron.templates.morningBriefing.prompt" verbatim.
    const strings = readCronLocale('en-US');
    expect(Object.keys(strings).some((key) => key.startsWith('cron.templates.'))).toBe(false);
    expect(strings.templates).toBeTypeOf('object');
  });

  it('writes prompts that ask for a decision, not just a dump', () => {
    const strings = readCronLocale('en-US');
    for (const template of TASK_TEMPLATES) {
      const prompt = resolveKey(strings, promptKeyOf(template)) ?? '';
      expect(prompt.length, `${template.id} prompt too short to be useful`).toBeGreaterThan(80);
    }
  });
});
