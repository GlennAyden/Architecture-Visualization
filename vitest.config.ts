import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'edge-runtime',
    server: { deps: { inline: ['convex-test'] } },
    include: [
      'convex/**/*.test.ts',
      'packages/**/*.test.ts',
      'apps/web/**/*.test.ts',
      'apps/vps-api/**/*.test.ts',
      'apps/mcp-server/**/*.test.ts',
    ],
  },
});
