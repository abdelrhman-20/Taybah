import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ command }) => ({
  // GitHub Pages serves the site from /<repo>/ — dev stays at '/'.
  base: command === 'build' ? '/Taybah/' : '/',
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
  },
}));
