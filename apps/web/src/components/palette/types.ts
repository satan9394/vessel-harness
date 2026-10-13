export interface CommandItem {
  id: string;
  title: string;
  category: 'project' | 'session' | 'action' | 'navigation' | 'view';
  shortcut?: string;
  keywords?: string[];
  execute: () => void | Promise<void>;
}
export interface ICommandRegistry {
  register(command: CommandItem): () => void;
  search(query: string): CommandItem[];
}
export function searchCommands(commands: CommandItem[], query: string): CommandItem[] {
  const needle = query.toLocaleLowerCase().replace(/\s/g, '');
  return commands.filter(command => {
    const text = [command.title, ...(command.keywords ?? [])].join(' ').toLocaleLowerCase();
    let index = 0;
    for (const char of text) if (char === needle[index]) index++;
    return index === needle.length;
  });
}
export function createCommandRegistry(): ICommandRegistry {
  const commands = new Map<string, CommandItem>();
  return {
    register(command) {
      commands.set(command.id, command);
      return () => { if (commands.get(command.id) === command) commands.delete(command.id); };
    },
    search: query => searchCommands([...commands.values()], query),
  };
}

export type CommandGroup = 'system' | 'project' | 'session';
export const COMMAND_GROUPS: CommandGroup[] = ['system', 'project', 'session'];
export function commandGroup(command: CommandItem): CommandGroup {
  return command.category === 'project' || command.category === 'session' ? command.category : 'system';
}
export function groupedCommands(commands: CommandItem[], query: string, collapsed: CommandGroup[]): CommandItem[] {
  const matches = searchCommands(commands, query);
  return COMMAND_GROUPS.flatMap(group => collapsed.includes(group) && !query.trim() ? [] : matches.filter(command => commandGroup(command) === group));
}
