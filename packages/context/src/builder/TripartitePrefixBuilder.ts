import { createHash } from 'node:crypto';
import { canonicalJson } from '@vessel/llm';

export interface TripartitePrefixOptions {
  coreRoleInstructions: string;
  architectureConstraints: string[];
  toolSchemas: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  projectRules?: string;
  reflectiveLessons?: string[];
  ephemeralContext?: string;
}

export interface TripartitePrefixResult {
  stablePrefix: string;
  scopedPrefix: string;
  volatileSuffix: string;
  fullPrompt: string;
  prefixByteHash: string;
}

export class TripartitePrefixBuilder {
  build(options: TripartitePrefixOptions): TripartitePrefixResult {
    const stablePrefix = [options.coreRoleInstructions, ...options.architectureConstraints,
      ...(options.toolSchemas.length ? ['[Tool schemas]\n' + canonicalJson(options.toolSchemas)] : [])].filter(Boolean).join('\n\n');
    const scopedPrefix = [options.projectRules, ...(options.reflectiveLessons ?? [])].filter(Boolean).join('\n\n');
    const volatileSuffix = options.ephemeralContext ?? '';
    return { stablePrefix, scopedPrefix, volatileSuffix,
      fullPrompt: [stablePrefix, scopedPrefix, volatileSuffix].filter(Boolean).join('\n\n'),
      prefixByteHash: createHash('sha256').update(stablePrefix, 'utf8').digest('hex') };
  }
}
