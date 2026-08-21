/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { DeepLinkAddProviderDetail } from '@/renderer/hooks/system/useDeepLink';
import { useClipboardApiKey } from '@/renderer/hooks/system/useClipboardApiKey';
import { getProviderLogo } from '@/renderer/utils/model/modelPlatforms';
import { Button, Collapse, Tag, Tooltip } from '@arco-design/web-react';
import { Key, Link, Lightning } from '@icon-park/react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FreeModelProvider } from './freeModelTypes';
import { FREE_MODEL_PROVIDERS, canAutoConfigure, prefillForProvider } from './freeModelTypes';

/** One provider's model table. Rendered only while expanded, so 145 rows never mount at once. */
const ModelTable: React.FC<{ provider: FreeModelProvider }> = ({ provider }) => {
  const { t } = useTranslation();
  return (
    <div className='overflow-x-auto'>
      <table className='w-full text-12px border-collapse'>
        <thead>
          <tr className='text-t-secondary text-left'>
            <th className='py-6px pr-12px font-500'>{t('settings.freeModels.colModel')}</th>
            <th className='py-6px pr-12px font-500'>{t('settings.freeModels.colContext')}</th>
            <th className='py-6px pr-12px font-500'>{t('settings.freeModels.colModality')}</th>
            <th className='py-6px font-500'>{t('settings.freeModels.colRateLimit')}</th>
          </tr>
        </thead>
        <tbody>
          {provider.models.map((model) => (
            <tr key={model.name} className='border-t border-[var(--color-border-2)]'>
              <td className='py-6px pr-12px text-t-primary break-all'>{model.name}</td>
              <td className='py-6px pr-12px text-t-secondary whitespace-nowrap'>{model.context}</td>
              <td className='py-6px pr-12px text-t-secondary'>{model.modality}</td>
              <td className='py-6px text-t-secondary whitespace-nowrap'>{model.rateLimit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const FreeModelsPanel: React.FC<{
  onConnect: (prefill: DeepLinkAddProviderDetail) => void;
}> = ({ onConnect }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<string[]>([]);
  const { candidate, arm, reset } = useClipboardApiKey();
  const [lastProviderId, setLastProviderId] = useState<string | null>(null);

  const handleGetKey = useCallback(
    (provider: FreeModelProvider) => {
      setLastProviderId(provider.id);
      // Arm before the browser opens: the user copies the key there and the
      // clipboard is read when this window comes back into focus.
      arm();
      void ipcBridge.shell.openExternal.invoke(provider.apiKeyUrl);
    },
    [arm]
  );

  const handleUseCandidate = useCallback(() => {
    const provider = FREE_MODEL_PROVIDERS.find((item) => item.id === lastProviderId);
    if (provider && candidate) {
      onConnect({ ...prefillForProvider(provider), api_key: candidate });
    }
    reset();
  }, [candidate, lastProviderId, onConnect, reset]);

  const pendingProvider = FREE_MODEL_PROVIDERS.find((item) => item.id === lastProviderId);

  return (
    <div className='flex flex-col gap-12px'>
      <p className='text-13px text-t-secondary leading-20px m-0'>{t('settings.freeModels.intro')}</p>

      {/* Offer the key the user just copied. Never applied without confirmation. */}
      {candidate && pendingProvider && (
        <div
          data-testid='free-models-clipboard-prompt'
          className='flex items-center justify-between gap-12px rd-10px px-14px py-10px border border-[rgb(var(--primary-6))] bg-[var(--color-fill-1)] transition-all duration-200'
        >
          <span className='text-13px text-t-primary'>
            {t('settings.freeModels.clipboardDetected', { provider: pendingProvider.name })}
          </span>
          <div className='flex items-center gap-8px flex-shrink-0'>
            <Button size='mini' type='primary' onClick={handleUseCandidate}>
              {t('settings.freeModels.useKey')}
            </Button>
            <Button size='mini' onClick={reset}>
              {t('settings.freeModels.dismiss')}
            </Button>
          </div>
        </div>
      )}

      <Collapse
        activeKey={expanded}
        onChange={(_key, keys) => setExpanded(keys)}
        bordered={false}
        className='free-models-collapse'
      >
        {FREE_MODEL_PROVIDERS.map((provider) => {
          const logo = getProviderLogo({ name: provider.name, base_url: provider.baseUrl });
          const autoConfigurable = canAutoConfigure(provider);
          return (
            <Collapse.Item
              key={provider.id}
              name={provider.id}
              data-testid={`free-model-${provider.id}`}
              header={
                <div className='flex items-center gap-10px min-w-0'>
                  {logo ? (
                    <img src={logo} alt='' className='w-20px h-20px rd-4px flex-shrink-0 object-contain' />
                  ) : (
                    <Lightning theme='outline' size='18' className='text-t-secondary flex-shrink-0' />
                  )}
                  <span className='text-14px font-500 text-t-primary truncate'>{provider.name}</span>
                  <Tag size='small' color='green'>
                    {t('settings.freeModels.modelCount', { count: provider.models.length })}
                  </Tag>
                  {provider.compat === 'other' && (
                    <Tooltip content={t('settings.freeModels.checkProtocolHint')}>
                      <Tag size='small' color='orange'>
                        {t('settings.freeModels.checkProtocol')}
                      </Tag>
                    </Tooltip>
                  )}
                </div>
              }
              extra={
                <div className='flex items-center gap-8px' onClick={(event) => event.stopPropagation()}>
                  <Button size='mini' icon={<Link theme='outline' size='13' />} onClick={() => handleGetKey(provider)}>
                    {t('settings.freeModels.getApiKey')}
                  </Button>
                  {autoConfigurable ? (
                    <Button
                      size='mini'
                      type='primary'
                      icon={<Key theme='outline' size='13' />}
                      onClick={() => onConnect(prefillForProvider(provider))}
                    >
                      {t('settings.freeModels.connect')}
                    </Button>
                  ) : (
                    <Tooltip content={t('settings.freeModels.manualSetupHint')}>
                      <Button size='mini' disabled>
                        {t('settings.freeModels.manualSetup')}
                      </Button>
                    </Tooltip>
                  )}
                </div>
              }
            >
              <div className='flex flex-col gap-8px'>
                <div className='text-12px text-t-secondary break-all'>
                  {t('settings.freeModels.baseUrl')}: <code>{provider.baseUrl}</code>
                </div>
                <ModelTable provider={provider} />
              </div>
            </Collapse.Item>
          );
        })}
      </Collapse>
    </div>
  );
};

export default FreeModelsPanel;
