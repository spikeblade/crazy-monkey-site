import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://crazymonkeyshirts.com',
  output: 'static',
  build: {
    format: 'file',
  },
  // Preserve trailing .html so Netlify redirects remain unchanged
  trailingSlash: 'never',
});
