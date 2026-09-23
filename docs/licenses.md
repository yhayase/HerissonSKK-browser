# ライセンスと調査記録

## 現在の決定（2026-09-23）

作者の判断により、本体のコードと付属文書には [MIT ライセンス](../LICENSE)を適用します。skk-vscode からの作者自身の移植コードも対象です。package.json と lockfile に `MIT` を設定し、配布物にも `licenses/HerissonSKK.txt` を同梱します。

第三者コードには各々の既存ライセンスが適用されます。SKK 辞書は配布 ZIP に同梱せず初回に取得します。取得した辞書には辞書の既存ライセンスが適用されます。現在のソースツリーにも公式辞書は含めません。アイコン等のブランド素材の再利用条件は今回の本体コードのライセンス決定とは分け、未確定です。

以下は調査時点の記録です。「未選択」「未完了」などは当時の状態を示し、後続の更新で解決した事項があります。

## 結論

確認したコードと Chrome／Firefox の本番ビルドでは、GPL の SKK 辞書以外に、本体を copyleft ライセンスで公開することを要求する依存コードは見つかりませんでした。本体を MIT、BSD-2-Clause、Apache-2.0 などの非 copyleft ライセンスで公開する方針を妨げる条件は確認していません。第三者部分の既存ライセンスと表示は維持します。本体のライセンス自体は未選択です。

skk-vscode は作者が完全に著作権を保有するオリジナルプロダクトであるという、2026-09-22 の作者の説明を前提としています。そこからの移植に第三者のライセンス制約はないものとして扱います。

## 実際に配布されるコード

`npx --no-install wxt build --analyze` と `npx --no-install wxt build -b firefox --analyze` を実行し、解析の moduleParts と renderedLength を確認しました。単に依存関係として解決されたモジュールと、生成コードに寄与するモジュールを区別しています。

| 対象 | バージョン | ライセンス | 結果 |
| --- | --- | --- | --- |
| wanakana | 5.3.1 | MIT | 両ブラウザーに含まれます。本文は同梱済みです。 |
| WXT のランタイム | 0.21.4 | MIT | content-script-context、イベント・URL監視、エントリーポイント補助などが含まれます。表示の追加が必要です。 |
| @wxt-dev/browser | 0.2.9 | MIT | browser／chrome を選択するラッパーが含まれます。WXT と合わせた表示が必要です。 |
| Vite modulepreload-polyfill | 8.2.2 | MIT | 設定などの HTML エントリーポイントに含まれます。表示の追加が必要です。 |
| @webext-core/match-patterns | 2.0.0 | MIT | モジュール解析には現れますが、両ビルドで出力部分はありません。 |
| textarea-caret | 3.1.0 | MIT | npm パッケージの直接 import は現在ありません。ただし下記の類似実装があり、既存の表示を維持します。 |

WXT／browser はインストール済み package.json の MIT 指定と[公式リポジトリの本文](https://github.com/wxt-dev/wxt/blob/main/LICENSE)を確認しました。npm 配布物には LICENSE 本文が見当たらないため、表示を追加する際には使用版の upstream 履歴と本文も固定します。Vite は `node_modules/vite/LICENSE.md` に本文があります。MIT は著作権表示と許諾文の維持を条件に、変更・再配布等を許可します。[MIT 本文](https://opensource.org/license/mit)

前回の配布物に追加した wanakana・textarea-caret の表示だけでは、生成コードの表示まで網羅できていませんでした。この不足は表示を追加する作業で対応でき、本体の copyleft 化を要求するものではありません。

## 開発依存と推移依存

package-lock.json 全体のライセンス宣言を走査しました。版、宣言、lockfile の SHA-256、両ビルドの外部モジュール一覧を [調査データ](./audit/license-inventory.json) に記録しています。

- web-ext 10.6.0、addons-linter、fx-runner、lightningcss 1.33.0 と関連パッケージは MPL-2.0 です。現行の拡張機能バンドルには含まれません。ビルド・検証に使用するだけで本体が MPL になるものではありません。これらのツール自体を同梱・改変して配布する場合は別途条件を守ります。[Mozilla の説明](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)
- jszip 3.10.1 は `MIT OR GPL-3.0-or-later`、node-forge 1.4.0 は `BSD-3-Clause OR GPL-2.0` です。非 copyleft 側を選択できます。現行の拡張機能バンドルには含まれません。
- その他の宣言には Apache-2.0、BSD、ISC、CC0、Python-2.0、BlueOak-1.0.0、MIT AND Zlib 等があります。各ツールの実装全体を再配布する計画はなく、これらを理由に本体を copyleft にする必要は確認していません。

## 複製・移植に関する調査

現行 src・entrypoints・scripts・test の出典・著作権・ライセンス記載、import、関連する導入コミットを確認しました。

- `src/core/` の SKK エンジン等は skk-vscode からの移植です。上記の作者の説明を適用します。
- `src/adapter/CaretPosition.ts` の textarea 用ミラー要素、CSS プロパティ一覧の順序、文字列を span へ分けて座標を測る処理は textarea-caret に類似しています。初期コミットでは同パッケージを import しており、`b34c29e` で現在の方式に置き換えています。履歴だけでは直接複製か独立実装かを断定できません。第三者由来の可能性を考慮して MIT 表示を維持すればよく、copyleft の問題にはなりません。
- Monaco 対応は DOM セレクターとブラウザーの入力 API を利用する実装です。配布コードに Monaco／VS Code 本体を import・同梱する箇所は見つかりませんでした。`public/test.html` は試験用に CDN の Monaco を読み込みますが、配布物から除外しています。
- 他の第三者コードからの複製を明示する記載、GPL／LGPL／MPL のコードヘッダーは対象の製品ソースから見つかりませんでした。

出典記載のない複製が存在しないことまで、文字列検索・履歴・ビルド解析で証明することはできません。インターネット上の全コードとの類似性照合や、生成 AI の学習元追跡は実施していません。

## SKK 辞書との境界

辞書は独立したデータファイルとして取得・解析し、ユーザーが差し替えられる構成です。GPL コードとのリンクではありません。この構成では、本体と辞書を独立した著作物として扱い、本体の非 copyleft ライセンスと辞書の GPL を併記できると判断します。GPL の独立した著作物の集積に関する説明も参照しています。[GNU FAQ](https://www.gnu.org/licenses/gpl-faq.en.html#MereAggregation)

辞書そのものや改変した辞書を本体のライセンスへ変更することはできません。SKK-JISYO.S と JSON 版には GPL-2.0-or-later と著作権表示があり、元のテキスト辞書と GPL v2 本文を同梱しています。公開時には「本体のライセンスは第三者コード・辞書を除く」と適用範囲を明示します。

## 公開前に残る対応

1. 本体のライセンスを選び、LICENSE と package.json に設定します。
2. WXT／browser と Vite の生成コードに必要な表示を追加します。textarea-caret の表示にはローカル類似実装も対象であることを明記します。
3. 本体・第三者コード・辞書・アイコンの適用範囲を明記します。アイコンの再利用条件はコードとは分けて決めることもできます。
4. 依存バージョンや import を変更した際は、実際のバンドルと表示を再確認します。

## 2026-09-23 の更新: textarea-caret の直接利用

`CaretPosition.ts` の textarea ミラー生成・span 座標取得のローカル実装を削除し、textarea-caret 3.1.0 の直接呼び出しへ戻しました。従来の `normal`／小数の行高、スクロールバーなしの測定幅、スクロール補正、失敗時の下端配置を維持する補正を呼び出し側に残しています。入力欄そのもののスタイルと選択範囲は変更しません。単一行 input の Canvas 計測、Monaco と contenteditable の処理は維持しています。

上記の「直接 import はない」「類似したローカル実装がある」という記述と調査データは 2026-09-22 時点の記録です。現在はライブラリのコードが本番バンドルに含まれます。`public/licenses/textarea-caret.txt` の MIT 表示を引き続き同梱します。

座標回帰テストは `node test/caret-coordinates.mjs` で実行します。Chrome／Firefox の実レイアウトで行高、折り返し、スクロール、入力欄の状態保持、測定要素の後片付け、text／number／email の下端配置を確認します。

## 2026-09-23 の更新: 生成コードのライセンス表示

次の表示を `public/licenses/` に追加しました。Chrome／Firefox の配布物に同梱します。

- `wxt.txt`: WXT 0.21.4 と @wxt-dev/browser 0.2.9 の MIT 本文。両方の取得元の本文がバイト単位で一致するため、共通ファイルとし README.txt に両パッケージを明記しました。
- `vite.txt`: インストール済み Vite 8.2.2 の LICENSE.md の「Vite core license」全文。実際に含まれる modulepreload-polyfill に対応します。ビルドツール内部だけの依存物の表示を、拡張機能の同梱コードとは混同していません。

取得元:

- WXT: [wxt-v0.21.4 の LICENSE](https://github.com/wxt-dev/wxt/blob/8fea9b4837282f4ad2a0d085ced6bee1a7de08fb/LICENSE)。
- browser: [0.2.9 の package.json を持つコミットの LICENSE](https://github.com/wxt-dev/wxt/blob/baf76c50bc0db0d98510c824abc2ae83cb59d8c8/LICENSE)。npm メタデータに gitHead がなかったため公式履歴で版を照合しました。
- Vite: `node_modules/vite/LICENSE.md` の先頭セクション。

これにより、前記の WXT／browser と Vite に関する表示追加は完了しました。本体ライセンスの選択と、辞書・画像等との適用範囲の明記は引き続き未完了です。

## 2026-09-23 の更新: SCANOSS による照合

[SCANOSS 検査](./audit/scanoss-2026-09-23.md)を実施しました。110 ファイル中109ファイルは一致なし、1ファイルは WXT 設定のスニペット一致でした。比較先と履歴を確認し、新たな第三者実装のライセンス対応は不要と判断しました。HPSM は公開APIで利用できず、標準スニペット照合の結果です。

## 2026-09-23 の更新: 辞書の非同梱化

基本辞書 S を初回に公式配信先から取得する方式へ変更しました。配布物から辞書と辞書用 GPL 本文を除き、公開リソースの dict 宣言も削除しました。既存キャッシュは保持します。従来の「辞書を同梱」という記録は変更前の状態です。

GPL の試験用辞書と本文は `test/fixtures/dict/` に移動しました。ソースリポジトリにはこれらの GPL データが残るため、ソース一式を配布する場合はその条件が適用されます。本体の MIT ライセンスへの変更ではありません。

## 2026-09-23 の更新: リポジトリからの公式辞書の削除

公式 SKK 辞書と試験用に移動した GPL 本文を、現在のソースツリーからも削除しました。単体テストはプロジェクト独自の小さな試験データだけを使います。公式辞書を使う統合検証は実行時にダウンロードし、既定の SHA-256 を照合してプロセス内のメモリーで使用します。辞書データをリポジトリへ保存しません。この検証にはネットワーク接続が必要です。上記の「試験用辞書を保持」という記録は、この更新より前の状態です。

過去の Git コミットに含まれる辞書は履歴に残っています。共有履歴の書き換えは実施していません。
