import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

export const resultSchema = {
  type: 'object', additionalProperties: false,
  required: ['verdict', 'summary', 'findings', 'acceptance'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fail', 'blocked'] },
    summary: { type: 'string' },
    findings: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['id', 'severity', 'description', 'evidence'], properties: {
        id: { type: 'string' }, severity: { type: 'string', enum: ['low', 'medium', 'high', 'blocker'] },
        description: { type: 'string' }, evidence: { type: 'string' },
      } } },
    acceptance: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['id', 'status', 'evidence'], properties: {
        id: { type: 'string' }, status: { type: 'string', enum: ['pass', 'fail', 'not_run'] }, evidence: { type: 'string' },
      } } },
  },
};

function isFile(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

function npmCodexExecutable(candidate) {
  const target = { x64: 'x86_64-pc-windows-msvc', arm64: 'aarch64-pc-windows-msvc' }[process.arch];
  if (!target) return null;
  const root = path.join(path.dirname(candidate), 'node_modules', '@openai', 'codex');
  if (!isFile(path.join(root, 'package.json'))) return null;
  const vendors = [];
  try {
    // Match the official launcher: optional platform package, then legacy vendor layout.
    const require = createRequire(path.join(fs.realpathSync(root), 'bin', 'codex.js'));
    vendors.push(path.join(path.dirname(require.resolve(`@openai/codex-win32-${process.arch}/package.json`)), 'vendor'));
  } catch { /* Legacy packages bundled vendor directly; missing binaries stay unavailable. */ }
  vendors.push(path.join(root, 'vendor'));
  return vendors.map(vendor => path.join(vendor, target, 'bin', 'codex.exe')).find(isFile) ?? null;
}

export function findExecutable(name) {
  // Reading PATH directly avoids where.exe's locale-dependent encoding of Unicode paths.
  const candidates = process.platform === 'win32'
    ? [process.cwd(), ...(process.env.PATH ?? '').split(path.delimiter)].filter(Boolean).flatMap(directory =>
      ['', ...(process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';')].map(extension => path.resolve(directory.replace(/^"|"$/g, ''), name + extension))).filter(isFile)
    : (spawnSync('which', [name], { encoding: 'utf8' }).stdout ?? '').trim().split(/\r?\n/).filter(Boolean);
  if (process.platform === 'win32') {
    const native = candidates.find(candidate => /\.exe$/i.test(candidate));
    if (native) return native;
  }
  for (const candidate of candidates) {
    if (process.platform !== 'win32') return candidate;
    if (name === 'codex') {
      const native = npmCodexExecutable(candidate);
      if (native) return native;
    }
    if (name === 'opencode') {
      const native = path.join(path.dirname(candidate), 'node_modules', '@opencode', 'cli', 'bin', 'opencode.exe');
      if (isFile(native)) return native;
    }
  }
  return null;
}

function validateModelSettings(profile) {
  if (profile?.model != null && (typeof profile.model !== 'string' || !profile.model.trim())) throw new Error('model must be a nonempty string when supplied');
  if (profile?.prompt_guidance !== undefined && (typeof profile.prompt_guidance !== 'string' || !profile.prompt_guidance.trim() || !profile.model)) throw new Error('prompt_guidance requires nonempty text and an explicit model');
  if (profile?.reasoning_effort !== undefined && (!['codex', 'opencode'].includes(profile.backend) || !profile.model || !['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(profile.reasoning_effort))) throw new Error('reasoning_effort requires Codex or OpenCode, an explicit model and a recognized effort; verify model support separately');
  if (profile?.backend === 'opencode' && profile.model?.includes('#')) {
    if (!/^[^#]+#[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(profile.model)) throw new Error('OpenCode model requires a nonempty #variant');
    if (profile.reasoning_effort !== undefined) throw new Error('reasoning_effort conflicts with model#variant; select one explicit setting');
  }
}

export function modelSettings(profile) {
  validateModelSettings(profile);
  const variant = profile.backend === 'opencode' ? (profile.reasoning_effort ?? profile.model?.split('#')[1] ?? null) : null;
  return { effective_model: profile.model ? `${profile.model}${profile.backend === 'opencode' && profile.reasoning_effort !== undefined ? `#${variant}` : ''}` : 'host-default',
    reasoning_effort: profile.reasoning_effort ?? variant ?? 'host-default', variant };
}

export function validateProfile(profile) {
  if (!profile || !['codex', 'opencode', 'agy'].includes(profile.backend)) throw new Error(`Unsupported backend: ${profile?.backend}`);
  validateModelSettings(profile);
  if (profile.args !== undefined && (!Array.isArray(profile.args) || Array.from(profile.args).some(arg => typeof arg !== 'string'))) throw new Error('profile.args must be an array of strings');
  for (const arg of profile.args ?? []) {
    if (/^--(?:add-dir|cd|dir|directory|cwd|working-directory|project|new-project|worktree|sandbox|config|profile|enable|disable|ask-for-approval|permissions?|permission-mode|mode|model|variant|reasoning-effort|effort|oss|local-provider|full-auto|auto|yolo|approve-for-me)(?:=|$)/.test(arg)
      || /^--dangerously(?:-|=|$)/.test(arg) || /^-[Ccsapm]/.test(arg) || arg === '--') {
      const option = arg.startsWith('--') ? arg.split('=')[0] : arg.slice(0, 2);
      throw new Error(`profile.args contains a reserved root, policy, config or model override/bypass option: ${option}`);
    }
  }
}

export function modelPromptContext(profile) {
  validateModelSettings(profile);
  return `Requested execution settings (not proof of provider routing): ${JSON.stringify({ backend: profile.backend, model: profile.model ?? 'host-default; exact model unknown', ...modelSettings(profile) })}\nModel-specific guidance (subordinate to project rules, task scope and acceptance):\n${profile.prompt_guidance ?? 'No verified model-specific guidance supplied. Use the task contract; do not invent model traits.'}\nPrior plans are proposals: verify assumptions against the repository; adjust implementation within the contract rather than blindly following stale steps. Report a blocker if the goal or acceptance needs to change.\n`;
}

export function invocation(profile, role, files) {
  validateProfile(profile);
  if (!profile?.executable || !fs.existsSync(profile.executable)) throw new Error(`Missing executable for ${role}; run doctor and configure this role`);
  const prefix = profile.args ?? [];
  if (profile.backend === 'opencode') return { executable: profile.executable, args: [
    ...prefix, 'run', ...(profile.standalone ? ['--standalone'] : []), '--format', 'json', '--agent', role === 'implement' || role === 'repair' ? 'build' : 'plan',
    ...(profile.model ? ['--model', modelSettings(profile).effective_model] : []), '--file', files.prompt,
    'Read the attached task instructions. Return the required final JSON.',
  ] };
  if (profile.backend === 'codex') return { executable: profile.executable, args: [
    ...prefix, 'exec', '--skip-git-repo-check', '--json', '--color', 'never',
    '--sandbox', role === 'implement' || role === 'repair' ? 'workspace-write' : 'read-only',
    ...(profile.model ? ['--model', profile.model] : []),
    ...(profile.reasoning_effort !== undefined ? ['--config', `model_reasoning_effort=${JSON.stringify(profile.reasoning_effort)}`] : []),
    '--output-schema', files.schema, '--output-last-message', files.final, '-',
  ], stdin: fs.readFileSync(files.prompt, 'utf8') };
  if (profile.backend === 'agy') return { executable: profile.executable, args: [
    ...prefix, '--print', fs.readFileSync(files.prompt, 'utf8'), '--output-format', 'json',
    '--mode', role === 'implement' || role === 'repair' ? 'accept-edits' : 'plan',
    ...(profile.model ? ['--model', profile.model] : []), '--json-schema', files.schema,
  ] };
  throw new Error(`Unsupported backend: ${profile.backend}`);
}

export function parseResult(stdout, finalFile) {
  const candidates = [];
  if (finalFile && fs.existsSync(finalFile)) candidates.push(fs.readFileSync(finalFile, 'utf8'));
  const fragments = [];
  // Only final/text response fields are candidates, never arbitrary tool arguments.
  for (const line of stdout.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line);
      if (event.verdict) candidates.push(event);
      if (event.structured_output) candidates.push(event.structured_output);
      if (event.result) candidates.push(event.result);
      if (event.type === 'text' && typeof event.part?.text === 'string') fragments.push(event.part.text);
    } catch { /* Other log lines stay in the original log. */ }
  }
  // OpenCode emits intermediate assistant text as well as a final response.
  // Try individual completed text parts, plus a joined candidate for split JSON.
  if (fragments.length) candidates.push(...fragments, fragments.join(''));
  candidates.push(stdout.trim());
  for (let candidate of candidates.reverse()) {
    try {
      if (typeof candidate === 'string') {
        let text = candidate.trim();
        const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
        const last = blocks.at(-1);
        if (last && !text.slice(last.index + last[0].length).trim()) text = last[1];
        candidate = JSON.parse(text);
      }
      if (!candidate || !['pass', 'fail', 'blocked'].includes(candidate.verdict) || typeof candidate.summary !== 'string' || !candidate.summary.trim()) continue;
      if (!Array.isArray(candidate.findings) || !Array.isArray(candidate.acceptance)) continue;
      for (const finding of candidate.findings) {
        if (!finding.id || !['low', 'medium', 'high', 'blocker'].includes(finding.severity) || !finding.description || !finding.evidence) throw new Error('Malformed finding');
      }
      for (const item of candidate.acceptance) {
        if (!item.id || !['pass', 'fail', 'not_run'].includes(item.status) || typeof item.evidence !== 'string') throw new Error('Malformed acceptance result');
      }
      return candidate;
    } catch { /* Missing/invalid structured output must fail closed below. */ }
  }
  throw new Error('No valid final JSON response; inspect stdout.log/stderr.log. A zero CLI exit is not an acceptance pass.');
}
