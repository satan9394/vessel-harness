import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ToolSpec } from '@vessel/shared';
import { globToRegExp } from '../globmatch.js';
import { canonicalize, matchesGlobList } from '../filesystem/guards.js';
import type { FsPolicyConfig } from '../filesystem/guards.js';

const DEFAULT_IGNORE = new Set(['.git', 'node_modules', 'dist']);

function walkFiles(root: string, dir: string, ignore: Set<string>): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (ignore.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...walkFiles(root, full, ignore));
    } else if (e.isFile()) {
      out.push(full);
    }
  }
  return out;
}

export function createSearchTools(opts: { workspaceRoot: string; fsPolicy: FsPolicyConfig }): ToolSpec[] {
  const { workspaceRoot: root, fsPolicy } = opts;

  const glob: ToolSpec = {
    name: 'Glob',
    description: 'List workspace files matching a glob pattern (e.g. "src/**/*.ts").',
    family: 'search',
    requiredPermission: 'read',
    exclusive: false,
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'glob pattern, relative to workspace root' },
        ignore: { type: 'array', items: { type: 'string' }, description: 'extra directory names to skip' },
      },
      required: ['pattern'],
    },
    async execute(args) {
      const pattern = String(args.pattern ?? '');
      if (!pattern) {
        return { content: '', error: { errorClass: 'INVALID_ARGS', message: 'pattern required' }, meta: {} };
      }
      const ignore = new Set([...DEFAULT_IGNORE, ...(Array.isArray(args.ignore) ? args.ignore.map(String) : [])]);
      const all = walkFiles(root, root, ignore);
      const re = globToRegExp(pattern.replace(/\\/g, '/'));
      const matches = all
        .map((f) => path.relative(root, f).replace(/\\/g, '/'))
        .filter((rel) => re.test(rel))
        .slice(0, 500);
      return {
        content: matches.length ? matches.join('\n') : `no files matched ${pattern}`,
        meta: { matched: matches.length, pattern },
      };
    },
  };

  const grep: ToolSpec = {
    name: 'Grep',
    description: 'Search file contents with a regular expression; returns file:line matches.',
    family: 'search',
    requiredPermission: 'read',
    exclusive: false,
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'regular expression' },
        include: { type: 'string', description: 'optional glob filter, e.g. "src/**/*.ts"' },
        ignore: { type: 'array', items: { type: 'string' } },
        maxResults: { type: 'number', description: 'cap on returned matches (default 200)' },
      },
      required: ['pattern'],
    },
    async execute(args) {
      const pattern = String(args.pattern ?? '');
      if (!pattern) {
        return { content: '', error: { errorClass: 'INVALID_ARGS', message: 'pattern required' }, meta: {} };
      }
      let re: RegExp;
      try {
        re = new RegExp(pattern);
      } catch {
        return { content: '', error: { errorClass: 'INVALID_ARGS', message: `invalid regex: ${pattern}` }, meta: {} };
      }
      const includeRe = args.include ? globToRegExp(String(args.include).replace(/\\/g, '/')) : null;
      const ignore = new Set([...DEFAULT_IGNORE, ...(Array.isArray(args.ignore) ? args.ignore.map(String) : [])]);
      const maxResults = Number(args.maxResults ?? 200);
      const results: string[] = [];
      const files = walkFiles(root, root, ignore);
      for (const f of files) {
        if (results.length >= maxResults) break;
        const rel = path.relative(root, f).replace(/\\/g, '/');
        if (includeRe && !includeRe.test(rel)) continue;
        let canonical: string;
        try {
          canonical = canonicalize(root, f);
          if (matchesGlobList(root, canonical, fsPolicy.denyRead)) continue;
        } catch {
          continue;
        }
        const stat = fs.statSync(canonical);
        if (stat.size > 1024 * 1024) continue; // skip huge binaries
        let text: string;
        try {
          text = fs.readFileSync(canonical, 'utf8');
        } catch {
          continue;
        }
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (results.length >= maxResults) break;
          if (re.test(lines[i]!)) {
            results.push(`${rel}:${i + 1}: ${lines[i]!.slice(0, 200)}`);
          }
        }
      }
      return {
        content: results.length ? results.join('\n') : `no matches for /${pattern}/`,
        meta: { matched: results.length, pattern },
      };
    },
  };

  return [glob, grep];
}
