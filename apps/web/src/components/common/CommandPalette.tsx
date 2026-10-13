import { useI18n } from '../LanguageProvider';
import { useEffect, useId, useRef, useState } from 'react';
import { groupedCommands, searchCommands, commandGroup, COMMAND_GROUPS, type CommandGroup, type CommandItem } from '../palette/types';
import './commandPalette.css';

export function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
}
export function hasOpenDialog(): boolean {
  return Boolean(document.querySelector('[role="dialog"], dialog[open]'));
}
export function isPaletteShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'isComposing'>): boolean {
  return !event.isComposing && !event.altKey && !event.shiftKey && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
}
export function trapFocus(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault'>, dialog: HTMLElement): void {
  if (event.key !== 'Tab') return;
  const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"]')).filter(control => {
    if (control.closest('[hidden], [inert]') || control.getAttribute?.('tabindex') === '-1') return false;
    const closedDetails = control.closest('details:not([open])');
    const summary = closedDetails?.querySelector('summary');
    if (closedDetails && control !== summary && !summary?.contains(control)) return false;
    return typeof control.getClientRects !== 'function' || control.getClientRects().length > 0;
  });
  event.preventDefault();
  if (!controls.length) { dialog.focus(); return; }
  const current = controls.indexOf(document.activeElement as HTMLElement);
  const next = current < 0 ? (event.shiftKey ? controls.length - 1 : 0) : (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
  controls[next]!.focus();
}
export default function CommandPalette({ commands }: { commands: CommandItem[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [collapsed, setCollapsed] = useState<CommandGroup[]>([]);
  const [error, setError] = useState<string>();
  const dialog = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const restore = useRef<HTMLElement | null>(null);
  const id = useId();
  const results = groupedCommands(commands, query, collapsed);
  const index = Math.min(selected, Math.max(0, results.length - 1));
  const show = (cheatsheet = false) => {
    restore.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery(''); setSelected(0); setError(undefined); setHelp(cheatsheet); setOpen(true);
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (isPaletteShortcut(event) && !hasOpenDialog()) { event.preventDefault(); show(); }
      else if (event.key === '?' && !event.ctrlKey && !event.metaKey && !event.altKey && !isTypingTarget(event.target) && !hasOpenDialog()) { event.preventDefault(); show(true); }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    return () => { if (restore.current?.isConnected) restore.current.focus(); };
  }, [open]);
  const execute = (command: CommandItem) => {
    // Close before invoking an action so a newly opened dialog keeps focus.
    setOpen(false);
    if (restore.current?.isConnected) restore.current.focus();
    restore.current = null;
    Promise.resolve().then(() => command.execute()).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)));
  };
  return <>
    <button className="btn" title={t('uiCommandsCtrlCmdK')} onClick={() => { if (!hasOpenDialog()) show(); }}>{t('uiCommands')}</button>
    {!open && error && <span role="alert">{error}</span>}
    {open && <div className="command-overlay" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div ref={dialog} className="command-dialog" role="dialog" aria-modal="true" aria-label={help ? t('uiKeyboardShortcuts') : t('uiCommands')} onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
        if (dialog.current) trapFocus(event, dialog.current);
      }}>
        <label htmlFor={`${id}-input`}>{help ? t('uiKeyboardShortcuts') : t('uiSearchCommandsAndSessions')}</label>
        <input id={`${id}-input`} ref={input} className="input" placeholder={t('palettePlaceholder')} value={query} role="combobox" aria-expanded="true" aria-controls={`${id}-results`} aria-activedescendant={results[index] ? `${id}-${index}` : undefined} onChange={event => { setQuery(event.target.value); setSelected(0); }} onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setSelected((index + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % Math.max(1, results.length)); }
          if (event.key === 'Enter') { event.preventDefault(); if (results[index]) execute(results[index]); }
        }} />
        {help && <p>{t('uiCtrlCmdKCommandsJKOrMessages')}</p>}
        <div id={`${id}-results`} role="listbox" aria-label={t('uiMatchingCommands')}>
          {COMMAND_GROUPS.map(group => {
            const entries = results.map((command, i) => ({ command, i })).filter(({ command }) => commandGroup(command) === group);
            const count = searchCommands(commands, query).filter(command => commandGroup(command) === group).length;
            return count ? <section className="command-group" key={group}><button type="button" className="command-group-toggle" aria-expanded={!collapsed.includes(group) || Boolean(query.trim())} onClick={() => { setCollapsed(previous => previous.includes(group) ? previous.filter(value => value !== group) : [...previous, group]); setSelected(0); }}>{t(group === 'system' ? 'systemActions' : group === 'project' ? 'recentProjects' : 'activeSessions')}</button>{entries.map(({ command, i }) => <div id={`${id}-${i}`} key={command.id} role="option" aria-selected={index === i} className="command-option" onMouseDown={event => event.preventDefault()} onClick={() => execute(command)}>{command.title}</div>)}</section> : null;
          })}
        </div>
        {!results.length && <p role="status">{t('uiNoMatchingCommands')}</p>}
        <button className="btn" onClick={() => setOpen(false)}>{t('close')}</button>
      </div>
    </div>}
  </>;
}
