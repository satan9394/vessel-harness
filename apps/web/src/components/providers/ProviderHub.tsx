import type { ApiClient } from '../../api';
import ProviderSettingsModal from './ProviderSettingsModal';

/** Page and shortcut dialog share the same provider workflow and validation. */
export default function ProviderHub({ api, onChanged, initialPreset }: {
  api: ApiClient; onChanged?: () => void; initialPreset?: string;
}) {
  return <ProviderSettingsModal api={api} onChanged={onChanged} initialPreset={initialPreset} embedded />;
}
