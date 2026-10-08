# Task 190 performance preflight

Read-only measurements before implementation, Windows / Node, local Vessel workspace:

| Operation | Wall time | Output bytes |
|---|---:|---:|
| `git diff --no-ext-diff --binary HEAD` | 164.79 ms | 26,837 |
| `git ls-files -z --cached --others --exclude-standard` | 107.99 ms | 80,005 |

These include Git process startup and filesystem reads; they are not timings of the future fingerprinter. A synchronous Git subprocess per observation cannot meet the task's 25ms bound on this machine. The user has been asked whether cold baseline acquisition may be separated from incremental computation; the original acceptance bound remains in force pending a response.
