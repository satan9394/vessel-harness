import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const codexBin = 'C:\\work\\AppData\\Local\\OpenAI\\Codex\\bin\\896a0166b774037a\\codex.exe';
const promptFile = 'E:/Code_file/Projects/Vessel_Harness/tasks/prompts/codex-task-231-implement.md';
const promptText = fs.readFileSync(promptFile, 'utf8');

const logFile = 'E:/Code_file/Projects/Vessel_Harness/evidence/sessions/2026-10-19-codex-task-231.log';
fs.mkdirSync(path.dirname(logFile), { recursive: true });
const outStream = fs.createWriteStream(logFile, { flags: 'w' });

console.log('Dispatching Codex for Task 231 Implementation (gpt-6.1-sol, medium)...');

const args = [
  'exec',
  '--skip-git-repo-check',
  '--color', 'never',
  '--sandbox', 'workspace-write',
  '-m', 'gpt-6.1-sol',
  '-c', 'model_reasoning_effort="medium"',
  '-C', 'E:/Code_file/Projects/Vessel_Harness',
  promptText
];

const child = spawn(codexBin, args, {
  cwd: 'E:/Code_file/Projects/Vessel_Harness',
  stdio: ['pipe', 'pipe', 'pipe']
});

// Explicitly close stdin so Codex immediately starts reasoning
child.stdin.end();

child.stdout.pipe(outStream);
child.stderr.pipe(outStream);

child.stdout.on('data', chunk => process.stdout.write(chunk));
child.stderr.on('data', chunk => process.stderr.write(chunk));

child.on('close', (code) => {
  console.log(`\nCodex finished execution for Task 231 with code: ${code}`);
  outStream.end();
});
