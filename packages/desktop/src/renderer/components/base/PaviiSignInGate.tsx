/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import brandLogo from '@renderer/assets/logos/brand/app.png';
import { isElectronDesktop } from '@renderer/utils/platform';
import { Button } from '@arco-design/web-react';
import { ArrowRight, Brain, Lightning, Shield } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './PaviiSignInGate.module.css';

type GateState = 'loading' | 'signedIn' | 'signedOut';

/**
 * Desktop welcome gate: blocks the app until a Pavii account session exists.
 *
 * Sign-in/sign-up happens in the system browser at pavii.tech/login (Firebase);
 * the pavii://auth deep link returns a verified session (see main-process
 * deepLink.ts + services/paviiAuth.ts). Renders nothing outside Electron
 * desktop — the WebUI keeps its own login flow.
 */
const PaviiSignInGate: React.FC = () => {
  const { t } = useTranslation();
  const [state, setState] = useState<GateState>(() => (isElectronDesktop() ? 'loading' : 'signedIn'));
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [signInUrl, setSignInUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const session = await ipcBridge.paviiAuth.getSession.invoke();
      setState(session ? 'signedIn' : 'signedOut');
      if (session) {
        setWaiting(false);
        setSignInUrl(null);
      }
    } catch {
      // IPC unavailable (e.g. web build without the electron bridge): never block
      setState('signedIn');
    }
  }, []);

  useEffect(() => {
    if (!isElectronDesktop()) return;
    void refresh();
    return ipcBridge.deepLink.received.on((payload: { action: string }) => {
      if (payload.action === 'auth/success') {
        setFailed(false);
        void refresh();
      } else if (payload.action === 'auth/error') {
        setFailed(true);
        setWaiting(false);
        setSignInUrl(null);
      }
    });
  }, [refresh]);

  const openBrowserFlow = useCallback((mode: 'signin' | 'signup') => {
    setWaiting(true);
    setFailed(false);
    setSignInUrl(null);
    setCopied(false);
    void ipcBridge.paviiAuth.signIn
      .invoke({ mode })
      .then((url) => {
        if (typeof url === 'string' && url) setSignInUrl(url);
      })
      .catch(() => setWaiting(false));
  }, []);

  const copySignInUrl = useCallback(() => {
    if (!signInUrl) return;
    void navigator.clipboard
      .writeText(signInUrl)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }, [signInUrl]);

  if (state !== 'signedOut') return null;

  const values = [
    {
      icon: <Brain size={18} strokeWidth={3} />,
      text: t('paviiGate.value1', { defaultValue: 'Optimized context management' }),
    },
    {
      icon: <Lightning size={18} strokeWidth={3} />,
      text: t('paviiGate.value2', { defaultValue: 'Every token put to work' }),
    },
    {
      icon: <Shield size={18} strokeWidth={3} />,
      text: t('paviiGate.value3', { defaultValue: 'Your AI is in safe hands' }),
    },
  ];

  return (
    <div className='fixed inset-0 z-1000 flex items-center justify-center bg-base'>
      <div className='flex w-full max-w-440px flex-col items-center px-24px text-center'>
        <img
          src={brandLogo}
          alt='Pavii.Ai'
          className={`mb-24px size-72px rounded-16px ${styles.stage} ${styles.stage1}`}
        />
        <div
          className={`mb-12px text-28px font-bold leading-tight tracking-tight text-t-primary ${styles.stage} ${styles.stage2}`}
        >
          {t('paviiGate.titleLead', { defaultValue: 'Welcome to the world of' })}{' '}
          <span className='text-primary'>Pavii.Ai</span>
        </div>
        <div
          className={`mb-28px max-w-380px text-15px leading-relaxed text-t-secondary ${styles.stage} ${styles.stage3}`}
        >
          {t('paviiGate.subtitle', {
            defaultValue: 'Your one stop to run, manage, and get the most from your AI.',
          })}
        </div>
        <div className={`mb-32px flex flex-col items-start gap-10px ${styles.stage} ${styles.stage4}`}>
          {values.map((v, i) => (
            <div key={i} className='flex items-center gap-10px text-14px text-t-secondary'>
              <span className='flex items-center text-primary'>{v.icon}</span>
              <span>{v.text}</span>
            </div>
          ))}
        </div>
        <div className={`flex w-full max-w-360px flex-col items-center ${styles.stage} ${styles.stage5}`}>
          <Button
            type='primary'
            size='large'
            long
            loading={waiting}
            className={styles.primaryCta}
            onClick={() => openBrowserFlow('signup')}
          >
            {waiting ? (
              t('paviiGate.waiting', { defaultValue: 'Waiting for your browser...' })
            ) : (
              <span className='inline-flex items-center gap-8px'>
                {t('paviiGate.signUp', { defaultValue: 'Create your Pavii account' })}
                <ArrowRight size={16} strokeWidth={4} />
              </span>
            )}
          </Button>
          <Button
            type='text'
            className={`mt-12px ${styles.secondaryCta}`}
            disabled={waiting}
            onClick={() => openBrowserFlow('signin')}
          >
            {t('paviiGate.signIn', { defaultValue: 'I already have an account' })}
          </Button>
          {waiting && signInUrl && (
            <div className='mt-16px flex flex-col items-center gap-4px text-13px'>
              <Button
                type='text'
                size='small'
                className={styles.secondaryCta}
                onClick={() => void ipcBridge.shell.openExternal.invoke(signInUrl)}
              >
                {t('paviiGate.reopen', { defaultValue: 'Page did not open? Click here to open it again' })}
              </Button>
              <Button type='text' size='small' className={styles.secondaryCta} onClick={copySignInUrl}>
                {copied
                  ? t('paviiGate.copied', { defaultValue: 'Link copied' })
                  : t('paviiGate.copy', { defaultValue: 'Or copy the sign-in link for another browser' })}
              </Button>
            </div>
          )}
          {failed && (
            <div className='mt-16px text-13px text-danger'>
              {t('paviiGate.error', { defaultValue: 'Sign-in could not be verified. Please try again.' })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PaviiSignInGate;
