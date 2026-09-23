import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: ({ browser, manifestVersion }) => ({
    name: `HerissonSKK for ${browser === 'firefox' ? 'Firefox' : 'Chrome'}`,
    description: 'ブラウザーの入力欄で使える SKK 日本語入力。かな漢字変換、単語登録、候補の学習をローカルで処理します。',
    permissions: ['storage'],
    host_permissions: ['https://raw.githubusercontent.com/*'],
    ...(manifestVersion === 3
      ? { optional_host_permissions: ['http://*/*', 'https://*/*'] }
      : { optional_permissions: ['http://*/*', 'https://*/*'] }),
    browser_specific_settings: {
      gecko: {
        id: 'herissonskk@yhayase',
        strict_min_version: '109.0',
        data_collection_permissions: {
          required: ['none'],
        },
      },
    },
  }),
  hooks: {
    'build:publicAssets': (_wxt, files) => {
      // 試験ページはローカル HTTP サーバーから配信し、配布物には含めません。
      for (let index = files.length - 1; index >= 0; index--) {
        const file = files[index];
        if (file && (['test.html', 'wxt.svg'].includes(file.relativeDest) || file.relativeDest.startsWith('dict/'))) {
          files.splice(index, 1);
        }
      }
    },
  },
  zip: {
    zipSources: false,
  },
});
