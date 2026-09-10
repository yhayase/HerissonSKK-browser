# Phase 3.1 production 辞書検証結果

## 検証範囲

Phase 3.1 の production 実装について、固定した公式 `SKK-JISYO.S.json` と実ブラウザーを使い、次を検証しました。

- JSON / 標準テキスト辞書の併用、辞書定義順の候補優先、重複排除、注釈保持
- ユーザー辞書の優先、再オープン後の学習保持、選択的更新、更新失敗時の旧 generation 維持と再試行
- IndexedDB v1〜v3 から v4 への移行、未完了 v3 インポートの非活性化
- 公式 S の3,379見出しのロードと「にほん」から「日本」への変換
- 固定した v3 production store と v4 の完全一致48件、前方一致24件について、計時前の見出し順・候補順・上限20件の一致
- ビルド済み拡張機能で Space を送信してから HUD の「日本」を外部ドライバーが観測するまでの時間

## 再現条件

検証日は2026年9月10日、Git HEAD は `b3c10c95507a393dc70a88685968846f7cbfe0a9`（未コミットの Phase 3.1 実装を含むため dirty）です。Node v24.1.0、Chrome for Testing 152.0.7977.82、Firefox 155.0.1、geckodriver 0.37.1、Intel Core i7-13700K の同一環境で実行しました。

比較対象の v3 実装は commit `e590f07` の `src/storage/jisyo/IndexedDbJisyoStore.ts` です。元ソースの SHA-256 は `e79eba04b0208be699cf8bcbadd8419b84f3f5a5b83638a1be3bd163894ca8ea` で、テスト用コピーは import パス4件だけを変更しています。公式 JSON の SHA-256 は `729e562f963ec06186c251c116510d6ed89aa525be78d6e2795920786741f0bc` です。

production store の生データには、実行時にViteで生成して配信した `production-dictionary.js` と5件のfixtureをバイト単位で固定したSHA-256を記録します。生成bundleはproduction storeとその推移的な依存コードを含み、HTTPサーバーはハッシュ対象と同じメモリ上のスナップショットを配信します。

候補表示の生データには、実際にロードした `.output/chrome-mv3` コピーの全ファイルを相対パス順に並べたSHA-256 manifestと、その `path + NUL + SHA-256 + LF` を連結して求めたroot SHA-256を記録します。FirefoxはインストールしたZIP全体のSHA-256に加え、その同じZIPの中央ディレクトリとローカルヘッダーを検証して展開した `dict/SKK-JISYO.S.json` のSHA-256を記録します。隣接する未圧縮のbuild出力はZIP検証に使いません。

```sh
npm run compile
npm run test:unit
npm run test:production-dictionary -- --browser both --output docs/benchmarks/phase31-production-dictionary.json
npm test
npm run test:firefox
npm run test:production-candidate -- --browser both --output docs/benchmarks/phase31-production-candidate.json
```

## production store の結果

[生データ](./benchmarks/phase31-production-dictionary.json) は42,276 bytes、SHA-256 `8973fc0786a5736777df6e50ccd3c1c191a17665da6514fd5c8f6ad10544dc85` です。Chrome / Firefox とも、挙動、移行、公式 S ロード、計時前の完全一致・前方一致 parity がすべてパスしました。実行した生成bundleのSHA-256は `23af01f90a72a20860ba4afe0d7dd506882e9eeddf765763344c4f1e46a35785` です。

| ブラウザー | import v3 / v4 (ms) | warm exact v3 / v4 median (ms) | warm prefix v3 / v4 median (ms) | cold exact v3 / v4 median (ms) | cold prefix v3 / v4 median (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Chrome 152 | 35.5 / 43.1 | 0 / 0.1 | 0.1 / 0.1 | 0.1 / 0.2 | 0.1 / 0.2 |
| Firefox 155 | 65 / 53 | 0 / 0 | 0 / 0 | 1 / 1 | 1 / 1 |

v4 import は active generation の publish を含みます。warm は接続済みストア、cold はクエリごとのストア生成と IndexedDB 接続を含みます。値はブラウザーのタイマー分解能に近いため絶対閾値には使わず、同じブラウザープロセス内の v3 / v4 相対比較と parity を回帰判断に使います。

## 候補表示の結果

[生データ](./benchmarks/phase31-production-candidate.json) は6,490 bytes、SHA-256 `191353e61c12b0738fa5fd65f287474fe9ada98bd54a01312a49035a4607c616` です。両ブラウザーで12回ずつ「日本」を観測しました。Chrome manifest rootは `1f338f5a8dc7f7e99893f6b8bea1a4eb6fac2717abe6a5a50dbbe2688db87218`、インストールしたFirefox ZIPは118,566 bytes、SHA-256 `225a7f979b7024ece056cebdef09960563ed12c577f34096627d388d14b585cc` です。

| ブラウザー | median (ms) | p95 (ms) |
| --- | ---: | ---: |
| Chrome 152 | 5.738 | 12.373 |
| Firefox 155 | 4.736 | 28.745 |

この時間はドライバーが Space 送信を開始してからページ外で HUD を観測するまでで、拡張機能の RPC、候補生成、描画、自動化通信、Firefox の最大20ms間隔のポーリング待ちを含みます。純粋なユーザー入力レイテンシではありません。各実行は使い捨てブラウザープロファイルと一時 IndexedDB を使い、終了時に削除します。

## 回帰検証

TypeScript コンパイル、Vitest 18ファイル404件、Chrome E2E 5シナリオ、Firefox E2E 5シナリオはすべてパスしました。ブラウザー検証ランナーは不一致、辞書ハッシュ違反、ブラウザー起動失敗、アサーション失敗を非ゼロ終了として扱います。
