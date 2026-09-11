import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: ({ manifestVersion }) => ({
    name: 'SKK Browser Extension',
    description: 'SKK Input Method Extension for browsers and VS Code for Web',
    permissions: ['storage'],
    host_permissions: ['https://raw.githubusercontent.com/*'],
    ...(manifestVersion === 3
      ? { optional_host_permissions: ['http://*/*', 'https://*/*'] }
      : { optional_permissions: ['http://*/*', 'https://*/*'] }),
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
  }),
  zip: {
    zipSources: false,
  },
});
