import { useI18n } from './LanguageProvider';
import { useState } from 'react';
import type { AttentionManager } from '../utils/attentionManager';

export default function AttentionControls({ attention }: { attention: AttentionManager }) {
  const { t } = useI18n();
  const [muted, setMuted] = useState(() => !attention.getOptions().soundEnabled);
  const [permission, setPermission] = useState(() => attention.permission());
  return <div className="attention-controls" aria-label={t('attentionTitle')}>
    <button type="button" className="btn" aria-pressed={muted} onClick={() => {
      attention.setOptions({ soundEnabled: muted }); attention.unlockAudio(); setMuted(!muted);
    }}>{muted ? t('soundUnmute') : t('soundMute')}</button>
    <button type="button" className="btn" disabled={permission !== 'default'} onClick={() => {
      void attention.requestPermission().then(setPermission);
    }} title={t('uiDesktopNotificationsForBackgroundOrUnfocusedTasksCompletion')}>{permission === 'default' ? t('enableNotification') : permission === 'granted' ? t('notificationEnabled') : permission === 'denied' ? t('notificationDenied') : t('notificationUnsupported')}</button>
  </div>;
}
