import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.property.ts', 'src/**/__tests__/**/*.test.ts'],
  },
});
