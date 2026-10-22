import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const codexBin = fs.existsSync('C:\\work\\AppData\\Local\\OpenAI\\Codex\\bin\\896a0166b774037a\\codex.exe')
  ? 'C:\\work\\AppData\\Local\\OpenAI\\Codex\\bin\\896a0166b774037a\\codex.exe'
  : 'codex';

const promptFile = 'E:/Code_file/Projects/Vessel_Harness/tasks/prompts/opencode-task-255-truncation-and-sandbox.md';
const promptText = fs.readFileSync(promptFile, 'utf8');

const logFile = 'E:/Code_file/Projects/Vessel_Harness/evidence/sessions/2026-10-21-codex-task-255.log';
fs.mkdirSync(path.dirname(logFile), { recursive: true });
const outStream = fs.createWriteStream(logFile, { flags: 'w' });

console.log('================================================================');
console.log('Dispatching Codex for Task 255: Fix Length Truncation 500 & Sandbox Token...');
console.log('Role: Senior Full-Stack Systems Engineer');
console.log('Model: gpt-6.1-sol (medium reasoning effort)');
console.log(`Prompt: ${promptFile}`);
console.log(`Log output: ${logFile}`);
console.log('================================================================');

const args = [
  'exec',
  '--skip-git-repo-check',
  '--color', 'never',
  '--sandbox', 'workspace-write',
  '-m', 'gpt-6.1-sol',
  '-c', 'model_reasoning_effort="medium"',
  '-C', 'E:/Code_file/Projects/Vessel_Harness',
  '-'
];

const child = spawn(codexBin, args, {
  cwd: 'E:/Code_file/Projects/Vessel_Harness',
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: process.platform === 'win32'
});

child.stdin.write(promptText);
child.stdin.end();

child.stdout.pipe(outStream);
child.stderr.pipe(outStream);

child.stdout.on('data', chunk => process.stdout.write(chunk));
child.stderr.on('data', chunk => process.stderr.write(chunk));

child.on('close', (code) => {
  console.log(`Codex process exited with code ${code}`);
  outStream.end();
  process.exit(code ?? 0);
});
