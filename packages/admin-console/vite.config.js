import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { hostedPagesPlugin } from './src/hosted/vite-plugin.js';

export default defineConfig({
  plugins: [hostedPagesPlugin(), tailwindcss(), sveltekit()],
  optimizeDeps: {
    exclude: ['@svadmin/core', '@svadmin/sso'],
  },
  ssr: {
    noExternal: ['@svadmin/core', '@svadmin/sso'],
  },
  server: {
    proxy: {
      '/api': {
        target: process.env["AUTH_SERVER_PROXY_TARGET"] || 'http://localhost:4010',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
