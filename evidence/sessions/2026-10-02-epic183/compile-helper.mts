import { spawnSync } from 'node:child_process';
import { WINDOWS_RESTRICTED_SOURCE } from '../../../packages/tools/src/execution/sandbox/windowsRestrictedSource.js';

// Compile the clean-room helper in memory only; never launch its Run method.
const script = `$ErrorActionPreference='Stop'; Add-Type -TypeDefinition ([Console]::In.ReadToEnd()); Write-Output 'Restricted helper C# compile passed; Run was not invoked.'`;
const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { input: WINDOWS_RESTRICTED_SOURCE, windowsHide: true, encoding: 'utf8' });
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
