Rename the symbol `oldName` to `newName2026` across the whole repo (src/).

Requirements:
- The legacy symbol must have ZERO remaining occurrences in src/.
- Update every call site / import in src/ consistently (no dangling references).
- The filename `legacy-symbol.js` stays as-is.
- Run `node verify.js` at the end to confirm.

Rules:
- Do not modify test files (there are none — verify.js is the check).
- Do not rename files or directories.
