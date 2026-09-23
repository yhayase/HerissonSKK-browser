# HerissonSKK 0.1.3 — Firefox 審査用ビルド手順

Firefox 拡張 ID は `herissonskk@yhayase` です。同じ ID の署名済み非掲載版 0.1.2 からの更新版です。AMO 掲載用として提出します。

このソースは Firefox 用の未署名配布物 `herissonskk-browser-0.1.3-firefox.zip` を再現するためのものです。TypeScript を WXT／Vite で変換・結合・最小化します。独自の難読化処理はありません。

## 確認済み環境

- Ubuntu 24.04.5 LTS、x86_64
- Bash
- Node.js 24.1.0
- npm 11.19.1
- 依存パッケージの正確なバージョンは同梱の `package-lock.json` に固定しています。

ブラウザー、API キー、非公開リポジトリへのアクセスはビルドに不要です。npm の依存取得にはネットワーク接続が必要です。SKK 辞書はビルド時に取得・同梱しません。

## ツールのインストール

[Node.js 公式配布ページ](https://nodejs.org/dist/v24.1.0/)の Linux x64 バイナリー `node-v24.1.0-linux-x64.tar.xz` を取得し、展開します。以下はホームディレクトリにインストールする例です。

```sh
mkdir -p "$HOME/.local/node-v24.1.0"
tar -xJf node-v24.1.0-linux-x64.tar.xz --strip-components=1 -C "$HOME/.local/node-v24.1.0"
export PATH="$HOME/.local/node-v24.1.0/bin:$PATH"
npm install --global npm@11.19.1
node --version
npm --version
```

出力が `v24.1.0`、`11.19.1` であることを確認してください。既にこの環境がある場合はインストール不要です。

## ビルド

1. ソース ZIP を空のディレクトリへ展開します。
2. 展開先（`package.json` があるディレクトリ）へ移動します。
3. 次を実行します。

```sh
bash scripts/release/build-firefox.sh
```

スクリプトは環境のバージョン確認、`npm ci --no-audit --no-fund`、`npm run zip:firefox` を順に実行します。`npm ci` の postinstall で WXT の型・設定ファイルを生成します。手動のファイル編集や追加の生成処理は不要です。

## 結果の照合

- 拡張機能のファイル: `.output/firefox-mv2/`
- 提出用 ZIP: `.output/herissonskk-browser-0.1.3-firefox.zip`

ZIP を展開したファイルのパスと内容を提出物と比較してください。ZIP の時刻情報や圧縮形式によってアーカイブ全体のハッシュは変わる場合があります。Mozilla が後から付与する署名は、このビルドでは生成しません。

`public/icon/` の PNG は採用済みの画像入力であり、そのままコピーします。画像生成 AI や画像処理ツールを再実行する必要はありません。ソース ZIP にはコンパイル済みの JavaScript、`node_modules`、`.git`、テスト出力、ローカルバックアップを含めていません。第三者依存は npm の公式レジストリから lockfile に従って取得します。
