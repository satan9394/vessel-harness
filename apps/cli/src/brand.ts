/**
 * apps/cli/brand — Vessel brand marks (shared by cli.ts help/version and the
 * chat TUI welcome). Kept in one place so both entry surfaces show the same
 * ASCII mark without circular imports.
 */

export const VESSEL_LOGO = [
  '        ___                      ',
  '       /   \\          V E S S E L',
  '      |     |   carry intelligence,',
  '       \\___/    shape behavior,',
  '      ~~~~~~~    guard execution.',
  '',
].join('\n');

/** short single-line brand for status bars / prompts. */
export const VESSEL_TAGLINE = 'Vessel — carry intelligence, shape behavior, guard execution.';
