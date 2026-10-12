import { useI18n } from '../LanguageProvider';
import { useEffect, useId, useRef, useState } from 'react';
import { searchCommands, type CommandItem } from '../palette/types';
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
  const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]'));
  const first = controls[0]; const last = controls.at(-1);
  if (!first) { event.preventDefault(); dialog.focus(); }
  else if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
}
export default function CommandPalette({ commands }: { commands: CommandItem[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string>();
  const dialog = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const restore = useRef<HTMLElement | null>(null);
  const id = useId();
  const results = searchCommands(commands, query);
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
        <div id={`${id}-results`} role="listbox" aria-label={t('uiMatchingCommands')}>{results.map((command, i) => <div id={`${id}-${i}`} key={command.id} role="option" aria-selected={index === i} className="command-option" onMouseDown={event => event.preventDefault()} onClick={() => execute(command)}>{command.title}<small>{t(({ session: 'paletteCategorySession', action: 'paletteCategoryAction', view: 'paletteCategoryView', navigation: 'paletteCategoryNavigation' } as const)[command.category])}</small></div>)}</div>
        {!results.length && <p role="status">{t('uiNoMatchingCommands')}</p>}
        <button className="btn" onClick={() => setOpen(false)}>{t('close')}</button>
      </div>
    </div>}
  </>;
}
