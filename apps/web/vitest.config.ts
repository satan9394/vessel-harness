import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Standalone web test config. The root vitest config deliberately does not
// scan apps/web; run from this package: `npm run -w @vessel/web test` or
// `npx vitest run --root apps/web`. @vitejs/plugin-react gives component
// tests automatic JSX (react-jsx) transform under the node environment.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    testTimeout: 10000,
  },
});
