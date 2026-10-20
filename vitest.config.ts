import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      root: process.cwd(),
      environment: 'happy-dom',
      include: [
        'src/web/{app,pages,widgets,entities,shared}/**/*.test.ts',
        'src/web/features/*/**/*.test.ts',
      ],
      restoreMocks: true,
    },
  }),
);
