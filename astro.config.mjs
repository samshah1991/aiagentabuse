import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://aiagentabuse.com',
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory', inlineStylesheets: 'never' },
  devToolbar: { enabled: false },
});
