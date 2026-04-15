import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://crazymonkey.store',
  output: 'static',
  build: {
    format: 'file',
  },
  // Preserve trailing .html so Netlify redirects remain unchanged
  trailingSlash: 'never',
});
