import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Load packages/server/.env so the persistence test can find DATABASE_URL.
// It is optional: without it that suite skips instead of failing.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Suites share one database, so they must not run concurrently.
    fileParallelism: false,
  },
});
