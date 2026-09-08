import { defineConfig } from 'vitest/config';

// Standalone web test config. The root vitest config deliberately does not
// scan apps/web; run from this package: `npm run -w @vessel/web test` or
// `npx vitest run --config apps/web/vitest.config.ts`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 10000,
  },
});