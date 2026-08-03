/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // Parser/model tests are pure logic and need no DOM. Component and hook
    // tests opt into jsdom per-file via a `// @vitest-environment jsdom`
    // docblock.
    environment: 'node',
    // `.tsx` is included so a component test is collected at all — without it a
    // component test file would sit there silently never running, which is
    // worse than having none.
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/main.tsx'],
    },
  },
});
