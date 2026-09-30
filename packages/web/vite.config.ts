import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.tsx', 'tests/**/*.test.ts'],
    // The ICP form renders ten sections with large option lists. Each
    // userEvent keystroke costs a visibility walk over that DOM, so jsdom needs
    // far more headroom than the 5s default. This is an environment cost, not a
    // browser-side one: React only re-renders the edited section.
    testTimeout: 60000,
  },
});
