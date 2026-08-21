/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DeepLinkAddProviderDetail } from '@/renderer/hooks/system/useDeepLink';
import type { PlatformConfig } from '@/renderer/utils/model/modelPlatforms';
import { getPresetProviders, getProviderLogo } from '@/renderer/utils/model/modelPlatforms';
import { Button, Input } from '@arco-design/web-react';
import { Search, Plus, Components } from '@icon-park/react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FREE_MODEL_PROVIDERS } from './freeModelTypes';

/** Provider names that also appear on the Free models tab, matched case-insensitively. */
const FREE_PROVIDER_NAMES = new Set(FREE_MODEL_PROVIDERS.map((provider) => provider.name.toLowerCase()));

/**
 * Browse every provider the app already knows how to configure.
 *
 * The catalogue is `MODEL_PLATFORMS` — the same list the add-provider form uses,
 * so this tab can never drift from what is actually selectable there.
 */
const AllProvidersPanel: React.FC<{
  onConnect: (prefill: DeepLinkAddProviderDetail) => void;
}> = ({ onConnect }) => {
  const { t } = useTranslation();
  const [keyword, setKeyword] = useState('');

  const presets = useMemo(() => getPresetProviders(), []);
  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    if (!needle) return presets;
    return presets.filter((preset) => preset.name.toLowerCase().includes(needle));
  }, [presets, keyword]);

  const handleConnect = (preset: PlatformConfig) => {
    onConnect({
      name: preset.name,
      platform: preset.platform,
      base_url: preset.base_url,
    });
  };

  return (
    <div className='flex flex-col gap-12px'>
      <p className='text-13px text-t-secondary leading-20px m-0'>{t('settings.allProviders.intro')}</p>

      <Input
        allowClear
        value={keyword}
        onChange={setKeyword}
        placeholder={t('settings.allProviders.searchPlaceholder')}
        prefix={<Search theme='outline' size='14' />}
        data-testid='all-providers-search'
      />

      {filtered.length === 0 ? (
        <div className='flex flex-col items-center justify-center py-32px text-t-secondary'>
          <Components theme='outline' size='32' className='mb-8px' />
          <span className='text-13px'>{t('settings.allProviders.noMatches', { keyword: keyword.trim() })}</span>
        </div>
      ) : (
        <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-10px'>
          {filtered.map((preset) => {
            const logo = getProviderLogo({ name: preset.name, platform: preset.platform, base_url: preset.base_url });
            const isFree = FREE_PROVIDER_NAMES.has(preset.name.toLowerCase());
            return (
              <div
                key={preset.value}
                data-testid={`all-provider-${preset.value}`}
                className='group flex items-center justify-between gap-10px rd-10px px-12px py-10px border border-[var(--color-border-2)] bg-2 transition-all duration-200 hover:border-[rgb(var(--primary-6))] hover:shadow-sm'
              >
                <div className='flex items-center gap-10px min-w-0'>
                  {logo ? (
                    <img src={logo} alt='' className='w-22px h-22px rd-4px flex-shrink-0 object-contain' />
                  ) : (
                    <Components theme='outline' size='20' className='text-t-secondary flex-shrink-0' />
                  )}
                  <div className='flex flex-col min-w-0'>
                    <span className='text-13px font-500 text-t-primary truncate'>
                      {preset.i18nKey ? t(preset.i18nKey, { defaultValue: preset.name }) : preset.name}
                    </span>
                    {isFree && (
                      <span className='text-11px text-[rgb(var(--primary-6))]'>
                        {t('settings.allProviders.hasFreeTier')}
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  size='mini'
                  type='primary'
                  icon={<Plus theme='outline' size='13' />}
                  className='flex-shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity duration-200'
                  onClick={() => handleConnect(preset)}
                >
                  {t('settings.allProviders.add')}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AllProvidersPanel;
