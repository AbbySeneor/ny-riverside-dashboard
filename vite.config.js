import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },
  build: { outDir: 'dist', sourcemap: true },
  // Serve the data-prep outputs as static assets at /data
  publicDir: 'public',
});
