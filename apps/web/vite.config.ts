import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import unocss from 'unocss/vite';

export default defineConfig({
  plugins: [unocss(), react()],
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
