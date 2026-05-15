import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import unocss from 'unocss/vite';

export default defineConfig({
  plugins: [unocss(), react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
