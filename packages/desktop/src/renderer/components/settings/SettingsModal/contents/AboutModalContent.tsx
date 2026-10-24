/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Divider, Typography, Button, Switch, Message, Link } from '@arco-design/web-react';
import { Github, Instagram, Right } from '@icon-park/react';
import { LinkedinGlyph, MediumGlyph, SubstackGlyph, XGlyph } from '@renderer/components/icons/BrandGlyphs';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { useSettingsViewMode } from '../settingsViewContext';
import { isElectronDesktop, openExternalUrl } from '@/renderer/utils/platform';
import FeedbackReportModal from './FeedbackReportModal';
import { ipcBridge } from '@/common';
import { RECOMMENDED_TOOLS } from '@/common/types/agent/recommendedTools';
import { getIncludePrerelease, runUpdateCheck } from '@/renderer/components/settings/checkForUpdatesShared';
import { UPDATE_AVAILABLE_EVENT } from '@/renderer/components/settings/useUpdateNotificationController';
import { IS_DISCONTINUED_BUILD } from '@/renderer/utils/discontinuedBuild';
import { OPEN_MIGRATION_DIALOG_EVENT } from '@/renderer/components/settings/UpdateMigrationDialog';
import {
  getUpdateReadyState,
  setUpdateReadyState,
  subscribeUpdateReadyState,
  type UpdateReadyState,
} from '@/renderer/components/settings/updateReadyState';

// __APP_VERSION__ is injected by electron.vite.config.ts `define:` from the
// repo-root package.json. The previous `import packageJson from
// '../../../../../../package.json'` resolved to packages/desktop/package.json
// which is a workspace placeholder permanently pinned at "0.0.0".
declare const __APP_VERSION__: string;

type LinkItem =
  | { title: string; url: string; icon: React.ReactNode; onClick?: never }
  | { title: string; onClick: () => void; icon: React.ReactNode; url?: never };

/**
 * Social destinations shown beside the version badge.
 *
 * GitHub and Instagram come from @icon-park; X, LinkedIn, Medium, and
 * Substack use the inline brand marks in components/icons/BrandGlyphs
 * (@icon-park ships neither those brands nor the current X logo). Labels
 * stay untranslated, as brand names are everywhere else in the app.
 */

/**
 * Destinations for the text links below the update section. Hoisted and
 * exported (like SOCIAL_LINKS) so tests can pin them: every one of these
 * used to point at the product landing page regardless of its label.
 */
export const ABOUT_LINK_URLS = {
  helpDocumentation: 'https://www.pavii.tech/products/dev-tools/docs/',
  // The public releases list, which is also where issues are tracked.
  updateLog: 'https://github.com/buckleson/Pavii-Gui-Releases/releases',
  officialWebsite: 'https://www.pavii.tech/products/dev-tools/',
} as const;

export const SOCIAL_LINKS: Array<{ label: string; url: string; glyph: React.ReactNode }> = [
  {
    label: 'GitHub',
    url: 'https://www.pavii.tech/products/Super-Assistant/',
    glyph: <Github theme='outline' size='20' />,
  },
  {
    label: 'X',
    url: 'https://x.com/Bucklesongroup',
    glyph: <XGlyph />,
  },
  {
    label: 'LinkedIn',
    url: 'https://www.linkedin.com/company/thepavii/',
    glyph: <LinkedinGlyph />,
  },
  {
    label: 'Instagram',
    url: 'https://www.instagram.com/pavii.ai/',
    glyph: <Instagram theme='outline' size='19' />,
  },
  {
    label: 'Medium',
    url: 'https://medium.com/@pavii.ai',
    glyph: <MediumGlyph />,
  },
  {
    label: 'Substack',
    url: 'https://substack.com/@paviiai',
    glyph: <SubstackGlyph />,
  },
];

const AboutModalContent: React.FC = () => {
  const { t } = useTranslation();
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';
  const isElectron = isElectronDesktop();

  const [includePrerelease, setIncludePrerelease] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [updateReadyState, setLocalUpdateReadyState] = useState<UpdateReadyState>(() => getUpdateReadyState());
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('update.includePrerelease');
    setIncludePrerelease(saved === 'true');
  }, []);

  useEffect(() => subscribeUpdateReadyState(setLocalUpdateReadyState), []);

  const handlePrereleaseChange = (val: boolean) => {
    setIncludePrerelease(val);
    localStorage.setItem('update.includePrerelease', String(val));
  };

  const openLink = async (url: string) => {
    try {
      await openExternalUrl(url);
    } catch (error) {
      console.log('Failed to open link:', error);
    }
  };

  const checkUpdate = async () => {
    // Discontinued build: guide to the AionPro website instead of any in-app
    // version detection. Dead-branched out of normal builds by the flag.
    if (IS_DISCONTINUED_BUILD) {
      window.dispatchEvent(new CustomEvent(OPEN_MIGRATION_DIALOG_EVENT));
      return;
    }

    if (updateReadyState.ready) {
      if (updateReadyState.preparing) return;
      if (updateReadyState.filePath) {
        void ipcBridge.shell.openFile.invoke(updateReadyState.filePath);
        return;
      }
      setUpdateReadyState({ ...updateReadyState, preparing: true });
      void ipcBridge.autoUpdate.quitAndInstall.invoke().catch(() => {
        Message.error(t('update.errors.prepareInstallFailed'));
        setUpdateReadyState({ ...updateReadyState, preparing: false });
      });
      return;
    }

    if (checking) return;
    setChecking(true);
    try {
      const outcome = await runUpdateCheck({
        includePrerelease: getIncludePrerelease(),
        fallbackVersion: __APP_VERSION__,
        checkFailedLabel: t('update.checkFailed'),
      });
      if (outcome.kind === 'available') {
        // Only reveal the bottom-right card once an update is confirmed; hand
        // over the already-fetched outcome so the card skips the checking flash.
        window.dispatchEvent(new CustomEvent(UPDATE_AVAILABLE_EVENT, { detail: outcome }));
      } else if (outcome.kind === 'upToDate') {
        Message.info(t('update.alreadyLatest'));
      } else {
        Message.error(outcome.message || t('update.checkFailed'));
      }
    } finally {
      setChecking(false);
    }
  };

  const linkItems: LinkItem[] = [
    {
      title: t('settings.helpDocumentation'),
      url: ABOUT_LINK_URLS.helpDocumentation,
      icon: <Right theme='outline' size='16' />,
    },
    {
      title: t('settings.updateLog'),
      url: ABOUT_LINK_URLS.updateLog,
      icon: <Right theme='outline' size='16' />,
    },
    {
      title: t('settings.bugReport'),
      onClick: () => setShowFeedbackModal(true),
      icon: <Right theme='outline' size='16' />,
    },
    {
      title: t('settings.officialWebsite'),
      url: ABOUT_LINK_URLS.officialWebsite,
      icon: <Right theme='outline' size='16' />,
    },
  ];

  return (
    <div className='flex flex-col h-full w-full'>
      {/* Content Area */}
      <div
        className={classNames(
          'flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-24px',
          isPageMode && 'px-0 overflow-visible'
        )}
      >
        <div className='flex flex-col max-w-500px mx-auto'>
          {/* App Info Section */}
          <div className='flex flex-col items-center pb-24px'>
            <Typography.Title heading={3} className='text-24px font-bold text-t-primary mb-8px'>
              Pavii.Ai
            </Typography.Title>
            <Typography.Text className='text-14px text-t-secondary mb-12px text-center'>
              {t('settings.appDescription')}
            </Typography.Text>
            <div className='flex items-center justify-center gap-8px mb-16px'>
              <span className='px-10px py-4px rd-6px text-13px bg-fill-2 text-t-primary font-500'>
                v{__APP_VERSION__}
              </span>
              {SOCIAL_LINKS.map((social) => (
                <div
                  key={social.label}
                  role='link'
                  tabIndex={0}
                  aria-label={social.label}
                  title={social.label}
                  className='text-t-primary cursor-pointer hover:text-t-secondary transition-colors p-4px'
                  onClick={() => openLink(social.url).catch((error) => console.error('Failed to open link:', error))}
                >
                  {social.glyph}
                </div>
              ))}
            </div>

            {/* Check Update Section */}
            {isElectron && (
              <div className='flex flex-col items-center gap-12px w-full max-w-300px bg-fill-2 p-16px rounded-lg'>
                <Button
                  type='primary'
                  long
                  loading={checking || updateReadyState.preparing}
                  disabled={updateReadyState.preparing}
                  onClick={() => void checkUpdate()}
                >
                  {updateReadyState.preparing
                    ? t('update.preparingInstall')
                    : updateReadyState.ready
                      ? t('settings.updateReadyInstall', { version: updateReadyState.version })
                      : checking
                        ? t('settings.checkingForUpdates')
                        : t('settings.checkForUpdates')}
                </Button>
                <div className='flex items-center justify-between w-full'>
                  <Typography.Text className='text-12px text-t-secondary'>
                    {t('settings.includePrereleaseUpdates')}
                  </Typography.Text>
                  <Switch size='small' checked={includePrerelease} onChange={handlePrereleaseChange} />
                </div>
              </div>
            )}
          </div>

          {/* Divider */}
          <Divider className='my-16px' />

          {/* Links Section */}
          <div className='flex flex-col gap-4px pt-8px'>
            {linkItems.map((item, index) => (
              <div
                key={index}
                className='flex items-center justify-between px-16px py-12px rd-8px hover:bg-fill-2 transition-all cursor-pointer group'
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if ('url' in item) {
                    openLink(item.url).catch((error) => console.error('Failed to open link:', error));
                  } else {
                    item.onClick();
                  }
                }}
              >
                <Typography.Text className='text-14px text-t-primary'>{item.title}</Typography.Text>
                <div className='text-t-secondary group-hover:text-t-primary transition-colors'>{item.icon}</div>
              </div>
            ))}
          </div>

          {/*
            Upstream credit for the Pavii agent tools (Settings → Tools). The
            Apache-2.0 tools require a statement of changes: none to the code.
          */}
          <Divider className='my-16px' />
          <div className='flex flex-col gap-8px px-16px' data-testid='about-builtin-tools'>
            <Typography.Text className='text-13px text-t-primary font-500'>
              {t('settings.builtinToolsCreditsTitle')}
            </Typography.Text>
            <Typography.Text className='text-12px text-t-secondary'>
              {t('settings.builtinToolsCreditsNote')}
            </Typography.Text>
            {RECOMMENDED_TOOLS.map((tool) => (
              <div key={tool.id} className='flex flex-col gap-2px' data-testid={`about-builtin-tool-${tool.id}`}>
                <Typography.Text className='text-12px text-t-primary'>
                  {t('settings.builtinToolsCreditsItem', {
                    name: tool.name,
                    upstream: tool.upstreamName,
                    license: tool.license,
                  })}
                </Typography.Text>
                <Typography.Text className='text-12px text-t-secondary'>{tool.upstreamCopyright}</Typography.Text>
                <Link className='text-12px' onClick={() => void openLink(tool.repoUrl)}>
                  {tool.repoUrl}
                </Link>
              </div>
            ))}
          </div>

          {/*
            Analytics disclosure. Deliberately inline rather than a link: this
            repository is private, so a "read more on GitHub" link would 404 for
            every user, and the marketing site has no privacy page yet.
          */}
          <Divider className='my-16px' />
          <div className='flex flex-col gap-4px pb-8px px-16px'>
            <Typography.Text className='text-13px text-t-primary font-500'>
              {t('settings.analyticsNoticeTitle')}
            </Typography.Text>
            <Typography.Text className='text-12px text-t-secondary'>
              {t('settings.analyticsNoticeBody')}
            </Typography.Text>
          </div>
        </div>
      </div>
      <FeedbackReportModal visible={showFeedbackModal} onCancel={() => setShowFeedbackModal(false)} />
    </div>
  );
};

export default AboutModalContent;
