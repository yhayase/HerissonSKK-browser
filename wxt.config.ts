import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    name: 'SKK Browser Extension',
    description: 'SKK Input Method Extension for browsers and VS Code for Web',
    permissions: ['storage'],
  },
});
