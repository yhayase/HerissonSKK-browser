# 開発案内

## ビルドと単体テスト

再現確認済みの環境は Node.js 24.1.0、npm 11.19.1、Ubuntu 24.04.5 LTS（x86_64）です。リポジトリのルートで実行します。

```sh
npm ci
npm run compile
npm run test:unit
npm run build
npm run build:firefox
```

ビルド結果は `.output/chrome-mv3/` と `.output/firefox-mv2/` に生成します。ブラウザー E2E の実行には試験用の Chrome・Firefox と、スクリプトによって geckodriver や xvfb が必要です。使用する実行ファイルの指定は `test/` の各スクリプトを参照してください。

## フォルダー構成

| 場所 | 内容 |
| --- | --- |
| `entrypoints/` | WXT の起動点と拡張機能の各画面 |
| `src/` | 入力エンジン、ブラウザー連携、候補表示、辞書保存などの実装 |
| `public/` | 配布物にコピーするアイコンとライセンス表示 |
| `assets/brand/`・`assets/store/` | 採用済みのブランド原本とストア掲載素材 |
| `test/` | 単体・ブラウザーテスト、試験ページ、独自の辞書試験データ |
| `scripts/` | 開発用起動、検証、計測、掲載画像の生成 |
| `docs/` | 仕様、利用案内、公開準備、保存する検証・監査記録 |
| `.output/` | ビルド・ZIP・一時的な検証出力（Git 管理外） |
| `.local/` | ローカルバックアップと不採用の画像案（Git 管理外） |

試験ページは `test/browser/test.html` を開発・テスト用サーバーで配信します。配布用の `public/` には置きません。テストの一時スクリーンショットは `.output/`、採用した掲載画像は `assets/store/` に保存します。`docs/benchmarks/` と `docs/audit/` は判断根拠として保存した記録です。

## 設計・公開作業

- [ロードマップ](./roadmap.md)
- [アーキテクチャと当初の計画](./architecture.md)（構想段階の項目を含みます。現在の実装状況はロードマップを参照してください。）
- [リリース手順と検証記録](./release.md)
- [Firefox 審査用ソースの再現ビルド手順](./source-build.md)

Firefox 審査用のソース ZIP は `python3 scripts/release/package-source.py` で生成します。審査向けの README とビルドスクリプトを含みます。
