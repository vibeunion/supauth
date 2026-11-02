import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { hostedPagesPlugin } from './src/hosted/vite-plugin.js';

/** @param {{ filename: string }} options */
const useRunes = ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true);

export default defineConfig({
  plugins: [
    hostedPagesPlugin(),
    tailwindcss(),
    sveltekit({
      adapter: adapter({
        pages: 'build',
        assets: 'build',
        fallback: 'index.html',
        precompress: false,
        strict: false,
      }),
      paths: { base: '/admin' },
      compilerOptions: { runes: useRunes },
    }),
  ],
  optimizeDeps: {
    exclude: ['@svadmin/core', '@svadmin/sso', '@svadmin/sveltekit', '@svadmin/ui'],
  },
  ssr: {
    noExternal: ['@svadmin/core', '@svadmin/sso', '@svadmin/sveltekit', '@svadmin/ui'],
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
