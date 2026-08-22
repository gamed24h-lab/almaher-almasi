import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// AL-MAHER V1.3: keep CSS unminified so print styles remain portable across Cloudflare builds.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
    emptyOutDir: true,
    cssMinify: false
  }
});
