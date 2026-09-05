Run a shell command (`node -e`) to compute the derived value from the seed in config.json,
then write the result into the `derived` field of config.json.

Formula: derived = (seed * 31 + 7) % 100000
The seed is fixed: 2026.

Rules:
- The command result must actually come from executing a shell command (not hardcoded).
- Write the computed number into config.json's `derived` field (keep the `seed` field unchanged).
