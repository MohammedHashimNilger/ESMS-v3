import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'https://esms-v3-ylzq.onrender.com' } }, // same-origin cookies in dev
  build: { sourcemap: false },
});
