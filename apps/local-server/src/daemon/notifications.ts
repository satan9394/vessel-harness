import { spawn } from 'node:child_process';

export type Notify = (title: string, message: string) => void;
export type NotificationCommand = (command: string, args: string[]) => void;

/** Optional desktop service: notification failure never changes task execution. */
export function createNativeNotifier(platform = process.platform, execute: NotificationCommand = (command, args) => {
  const child = spawn(command, args, { windowsHide: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}): Notify {
  return (title, message) => {
    try {
      if (platform === 'win32') {
        const xmlEscape = (text: string) => text.replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]!);
        const xml = `<toast><visual><binding template="ToastGeneric"><text>${xmlEscape(title)}</text><text>${xmlEscape(message)}</text></binding></visual></toast>`;
        const script = `[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime] > $null; [Windows.UI.Notifications.ToastNotification,Windows.UI.Notifications,ContentType=WindowsRuntime] > $null; [Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom.XmlDocument,ContentType=WindowsRuntime] > $null; $xml=New-Object Windows.Data.Xml.Dom.XmlDocument; $xml.LoadXml('${xml.replace(/'/g, "''")}'); $toast=[Windows.UI.Notifications.ToastNotification]::new($xml); [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Microsoft.Windows.PowerShell').Show($toast)`;
        execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);
      } else if (platform === 'darwin') {
        const literal = (value: string) => '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, ' ') + '"';
        execute('osascript', ['-e', `display notification ${literal(message)} with title ${literal(title)}`]);
      } else if (platform === 'linux') execute('notify-send', ['--', title, message]);
    } catch { /* ponytail: desktop notifications are best effort. */ }
  };
}
