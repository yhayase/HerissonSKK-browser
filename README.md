# HerissonSKK

ブラウザーの入力欄で使える SKK 日本語入力拡張です。Herisson の読みは「えりそん」です。通常の入力欄に加え、vscode.dev のエディターでも利用できます。

## 制作と AI の利用

HerissonSKK は Yasuhiro Hayase が制作・公開するプロジェクトです。開発には Google Gemini と OpenAI Codex を使用し、コード・テスト・文書の作成や修正、検証作業に AI を活用しています。作者が仕様や採用する変更を判断し、動作を確認しており、公開内容に対する最終的な責任は作者が負います。

アイコンは ChatGPT の画像生成で作成し、Codex を用いて品質調整とアイコン用の整形を行い、作者が選定しました。

この説明は開発・制作時の AI 利用についてです。拡張機能の日本語変換は取得済みの SKK 辞書を使ってブラウザー内で処理し、入力内容や登録語を AI サービスへ送信しません。

## 利用案内

- [基本操作・対応環境](docs/store-listing.md)
- [埋め込み文書での入力と制約](docs/embedded-documents.md)
- [候補削除（X）の操作と対象](docs/candidate-deletion.md)
- [システム辞書の設定](docs/system-dictionaries.md)
- [プライバシーポリシー](docs/privacy-policy.md)
- [ロードマップ](docs/roadmap.md)

## ライセンス

本体コードと付属文書は [MIT ライセンス](LICENSE)です。第三者コードの条件は [ライセンス表示](public/licenses/README.txt)、アイコンの扱いは [ブランド素材の説明](assets/brand/README.md)を参照してください。基本辞書は初回起動時にダウンロードし、辞書固有のライセンスが適用されます。

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

## Firefox 審査用のソース提出

[再現ビルド手順](docs/source-build.md)に環境とコマンドを記載しています。`python3 scripts/release/package-source.py` で、手順を README として含む提出用ソース ZIP を作成できます。
