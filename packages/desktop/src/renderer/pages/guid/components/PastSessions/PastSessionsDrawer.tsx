/**
 * @license
 * Copyright 2026 Team Pavii
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { ExternalSession, ExternalSessionList, ImportExternalSessionResult } from '@/common/types/agent/paviiData';
import { emitter } from '@/renderer/utils/emitter';
import { Button, Drawer, Empty, Message, Spin, Tag } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

type ImportError = Extract<ImportExternalSessionResult, { success: false }>['error'];

const IMPORT_ERROR_KEYS: Record<ImportError, string> = {
  'not-found': 'conversation.paviiData.pastSessions.errors.notFound',
  'agent-unavailable': 'conversation.paviiData.pastSessions.errors.agentUnavailable',
  'read-failed': 'conversation.paviiData.pastSessions.errors.readFailed',
  'import-failed': 'conversation.paviiData.pastSessions.errors.importFailed',
};

type PastSessionsDrawerProps = {
  visible: boolean;
  folder: string;
  onClose: () => void;
};

const formatDate = (epochMs: number) => new Date(epochMs).toLocaleString();

/** Lists past Claude Code / Codex sessions and Pavii sessions for a workspace folder. */
const PastSessionsDrawer: React.FC<PastSessionsDrawerProps> = ({ visible, folder, onClose }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [data, setData] = useState<ExternalSessionList | null>(null);
  const [loading, setLoading] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !folder) return;
    let cancelled = false;
    setLoading(true);
    setData(null);
    ipcBridge.paviiData.listExternalSessions
      .invoke({ folder })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        if (!cancelled) Message.error(t('conversation.paviiData.pastSessions.loadFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, folder, t]);

  const openConversation = useCallback(
    async (conversationId: string) => {
      onClose();
      await navigate(`/conversation/${conversationId}`);
    },
    [navigate, onClose]
  );

  const handleOpenExternal = useCallback(
    async (session: ExternalSession) => {
      if (session.conversationId) {
        await openConversation(session.conversationId);
        return;
      }
      setOpeningId(session.sessionId);
      try {
        const result = await ipcBridge.paviiData.importExternalSession.invoke({
          folder,
          backend: session.backend,
          sessionId: session.sessionId,
        });
        if ('error' in result) {
          Message.error(t(IMPORT_ERROR_KEYS[result.error] ?? IMPORT_ERROR_KEYS['import-failed']));
          return;
        }
        emitter.emit('chat.history.refresh');
        await openConversation(result.conversationId);
      } catch {
        Message.error(t(IMPORT_ERROR_KEYS['import-failed']));
      } finally {
        setOpeningId(null);
      }
    },
    [folder, openConversation, t]
  );

  const folderName = folder.split(/[\\/]/).pop() || folder;
  const sessions = data?.sessions ?? [];
  const paviiSessions = data?.paviiSessions ?? [];

  return (
    <Drawer
      visible={visible}
      width={420}
      title={t('conversation.paviiData.pastSessions.title', { folder: folderName })}
      footer={null}
      onCancel={onClose}
      unmountOnExit
    >
      {loading ? (
        <div className='flex justify-center py-32px'>
          <Spin />
        </div>
      ) : (
        <div className='flex flex-col gap-16px' data-testid='past-sessions-drawer'>
          <section className='flex flex-col gap-8px'>
            <div className='text-13px font-medium text-t-primary'>
              {t('conversation.paviiData.pastSessions.externalTitle')}
            </div>
            {sessions.length === 0 ? (
              <Empty description={t('conversation.paviiData.pastSessions.empty')} />
            ) : (
              <div className='flex flex-col divide-y divide-border-2'>
                {sessions.map((session) => (
                  <div
                    key={`${session.backend}:${session.sessionId}`}
                    className='flex items-center gap-8px py-8px'
                    data-testid='past-session-item'
                  >
                    <div className='flex-1 min-w-0 flex flex-col gap-4px'>
                      <div className='flex items-center gap-6px min-w-0'>
                        <Tag size='small' color={session.backend === 'claude' ? 'orangered' : 'arcoblue'}>
                          {t(`conversation.paviiData.pastSessions.backend.${session.backend}`)}
                        </Tag>
                        <span className='text-13px text-t-primary truncate'>
                          {session.title || t('conversation.paviiData.pastSessions.untitled')}
                        </span>
                        {session.conversationId && (
                          <Tag size='small' color='green'>
                            {t('conversation.paviiData.pastSessions.imported')}
                          </Tag>
                        )}
                      </div>
                      <div className='text-12px text-t-tertiary'>
                        {formatDate(session.updatedAt)} ·{' '}
                        {t('conversation.paviiData.pastSessions.messageCount', { count: session.messageCount })}
                      </div>
                    </div>
                    <Button
                      size='mini'
                      loading={openingId === session.sessionId}
                      disabled={openingId !== null && openingId !== session.sessionId}
                      onClick={() => void handleOpenExternal(session)}
                    >
                      {t('conversation.paviiData.pastSessions.open')}
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {(data?.unavailable ?? []).map((item) => (
              <div key={item.backend} className='text-12px text-t-tertiary'>
                {t('conversation.paviiData.pastSessions.unavailable', {
                  backend: t(`conversation.paviiData.pastSessions.backend.${item.backend}`),
                  reason: item.reason,
                })}
              </div>
            ))}
          </section>

          {paviiSessions.length > 0 && (
            <section className='flex flex-col gap-8px'>
              <div className='text-13px font-medium text-t-primary'>
                {t('conversation.paviiData.pastSessions.paviiTitle')}
              </div>
              <div className='flex flex-col divide-y divide-border-2'>
                {paviiSessions.map((entry) => (
                  <div key={entry.conversationId} className='flex items-center gap-8px py-8px'>
                    <div className='flex-1 min-w-0 flex flex-col gap-4px'>
                      <div className='flex items-center gap-6px min-w-0'>
                        {(entry.backend || entry.agentId) && <Tag size='small'>{entry.backend || entry.agentId}</Tag>}
                        <span className='text-13px text-t-primary truncate'>
                          {entry.title || t('conversation.paviiData.pastSessions.untitled')}
                        </span>
                      </div>
                      <div className='text-12px text-t-tertiary'>{formatDate(entry.lastActiveAt)}</div>
                    </div>
                    <Button size='mini' onClick={() => void openConversation(entry.conversationId)}>
                      {t('conversation.paviiData.pastSessions.open')}
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
};

export default PastSessionsDrawer;
