import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    name: 'SKK Browser Extension',
    description: 'SKK Input Method Extension for browsers and VS Code for Web',
    permissions: ['storage'],
    browser_specific_settings: {
      gecko: {
        id: 'skk-browser-extension@yhayase',
        strict_min_version: '109.0',
      },
    },
    web_accessible_resources: [
      {
        resources: ['dict/*', 'test.html'],
        matches: ['<all_urls>'],
      },
    ],
  },
  zip: {
    zipSources: false,
  },
});
