import { spawn } from 'node:child_process';

const codexBin = 'C:\\Users\\Satanchen\\AppData\\Local\\OpenAI\\Codex\\bin\\896a0166b774037a\\codex.exe';
const args = [
  'exec',
  '--skip-git-repo-check',
  '--color', 'never',
  '--sandbox', 'read-only',
  '-m', 'gpt-6.1-sol',
  '-c', 'model_reasoning_effort="low"',
  'Respond with "Codex CLI Dispatched Successfully" and nothing else.'
];

console.log('Spawning Codex...');
const child = spawn(codexBin, args, {
  cwd: 'E:\\Code_file\\Projects\\Vessel_Harness',
  stdio: ['pipe', 'inherit', 'inherit']
});

// Explicitly close stdin to prevent "Reading additional input from stdin..."
child.stdin.end();

child.on('close', (code) => {
  console.log('Codex exited with code:', code);
});
