import { defineConfig } from 'vitest/config';

// Single root config covering pure-logic packages. Tests live next to the code
// as `*.test.ts`. Node environment — no DOM. The web app (TipTap/React) is not
// covered here; see PLAN.md "Техдолг".
export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts', 'apps/server/**/*.test.ts'],
  },
});
