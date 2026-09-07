# 開発ロードマップ (Development Roadmap)

本書は、ブラウザ向け汎用 SKK 入力拡張機能（Chrome / Firefox 対応、VS Code for Web 完全対応）の開発フェーズ、マイルストーン、および進捗状況を管理するロードマップです。

全体のアーキテクチャおよび技術的課題・方針については [docs/architecture.md](file:///home/hayase/Documents/devel/skk-browser-extension/docs/architecture.md) を参照してください。

---

## コアエンジン抽出・共通化方針（Library Extraction Strategy）

SKK コアエンジン（ステートマシン、ローマ字変換、辞書モデル）は、既存の `skk-vscode` との重複管理を避け、将来的には単独利用可能な共通ライブラリ（例: `@yhayase/skk-core`）として提供することを目指します。

設計の最適化と手戻り最小化のため、以下の **「移植先行・要件確定後のライブラリ抽出」** アプローチを採用します：

```mermaid
flowchart TD
    Phase2["Phase 2: src/core/ に独立層として移植<br>(ステートマシン・ローマ字エンジンのブラウザ適応)"]
    Phase3["Phase 3: 辞書モデル・検索エンジンの移植<br>(IndexedDB 連携・標準辞書・Firefox E2E)"]
    Phase31["Phase 3.1: JSON 辞書ローダー & ストレージフォーマット検討<br>(skk-dict/jisyo 形式対応・データ構造最適化)"]
    Phase32["Phase 3.2: コアエンジンの堅牢性検証 & ファジング<br>(fast-check / プロパティベースドテスト・自己修復性)"]
    Phase4["Phase 4: 共通ライブラリとして抽出・独立パッケージ化<br>(@yhayase/skk-core を切り出し、skk-vscode と双方で共有)"]

    Phase2 --> Phase3 --> Phase31 --> Phase32 --> Phase4
```

1. **ブラウザ拡張内に独立層（`src/core/`）として先行移植（Phase 2〜3）**:
   - 将来のライブラリ化を見据え、ブラウザ固有依存（DOM / HUD / Chrome API）を一切含まない純粋な TypeScript 層として `src/core/` に構築。
   - ブラウザ特有の要件（DOM を汚染しない未確定バッファと HUD 描画、確定時のみの `insertText` 流し込み、IndexedDB 連携など）を充足させ、`IEditor` / `IJisyoProvider` の境界仕様を固める。
2. **共通ライブラリの抽出・統合（Phase 4）**:
   - 2つの実環境（VS Code 拡張機能とブラウザ拡張機能）で実際に稼働した実績をもとに、共通部分を独立パッケージ（または monorepo）としてくくりだす。
   - `skk-vscode` および `skk-browser-extension` の双方が共通ライブラリを参照するようにリファクタリング。

---

## 全体フェーズ一覧

| フェーズ | テーマ | 状態 | 主な成果物・マイルストーン |
| :--- | :--- | :---: | :--- |
| **Phase 1** | **汎用入力 & Monaco Editor PoC** | **完了 ✅** | キー横取り、汎用要素・Monaco への文字挿入、キャレット追従 HUD、フルスクリーン対応、ヘッドレス E2E テスト |
| **Phase 2** | **SKK コアエンジン移植 & ブラウザ適応** | **完了 ✅** | `src/core/` への純粋 TypeScript 移植（ローマ字変換、各入力モード、接頭辞/接尾辞）、DOM 非汚染な `BrowserEditorAdapter`、単体テスト(137件) |
| **Phase 3** | **辞書ストレージ & 検索エンジン (IndexedDB)・Firefox E2E** | **完了 ✅ (PRレビュー中)** | 標準 SKK 辞書パーサー、大容量辞書の IndexedDB 格納、高速前方一致検索、学習・個人辞書同期、再帰辞書登録、Firefox (Gecko) ヘッドレス E2E 自動検証(全10件パス) |
| **Phase 3.1** | **JSON 辞書ローダー & IndexedDB データフォーマット検討** | **次フェーズ 🚀** | [skk-dict/jisyo](https://github.com/skk-dict/jisyo) JSON 辞書パーサー、IndexedDB 格納フォーマットの比較検討（統一キー vs 分割構造等、事前固定せず性能/容量/検索要件から評価）、スキーマ移行整備 |
| **Phase 3.2** | **コア堅牢性検証 & プロパティベースドテスト（ファジング）** | 未着手 ⏳ | Vitest + fast-check によるランダムキー入力シーケンス生成、状態マシンの自己修復性検証、最小反例（Shrink）特定機構整備 |
| **Phase 4** | **SKK コアエンジンの共通ライブラリ抽出** | 未着手 ⏳ | `src/core/` を独立パッケージ（`@yhayase/skk-core` 等）として切り出し、`skk-vscode` とブラウザ拡張の双方で共通利用 |
| **Phase 5** | **UI/UX 改善 & 候補選択メニュー** | 未着手 ⏳ | 複数候補一覧メニュー（1〜9 選択、Space 送り、x 戻り）、ビューポート端へのクランプ、ダーク/ライトテーマ追従 |
| **Phase 6** | **設定画面・ドメイン制御 & ストア公開準備** | 未着手 ⏳ | ポップアップ UI（有効/無効・除外サイト）、オプション画面（キーバインド・辞書管理）、Chrome/Firefox パッケージング |

---

## 各フェーズ詳細

### Phase 1: 汎用入力 & Monaco Editor PoC（完了 ✅）

- **目的**: 最難関とされる「VS Code for Web（Monaco Editor）でのキー横取り・Undo 履歴を壊さない文字挿入・カーソル追従」および「標準 Web フォームでの入力互換性」の技術的成立性を実証する。
- **実装内容**:
  - WXT (Manifest V3) によるクロスブラウザ拡張機能基盤の構築。
  - `window.addEventListener('keydown', ..., { capture: true })` による確実なイベントキャプチャ。
  - `vscode.dev` / `github.dev` での Native EditContext の安全なバイパス（`<textarea class="inputarea">` フォールバック）。
  - `document.execCommand('insertText')` を用いた Monaco Editor の Undo/Redo 履歴を保持するテキスト挿入。
  - `<input>`, `<textarea>`, `contenteditable`, および Monaco Editor (`.cursor`) の正確なキャレット画面座標追従。
  - Shadow DOM によるページ側 CSS と隔離されたフローティング HUD。
  - HTML5 フルスクリーンモード（`fullscreenchange` による Top Layer 再マウント）対応。
  - 完全ヘッドレス環境（`xvfb-run` + Chrome for Testing + Puppeteer）での E2E 自動検証スクリプト整備。
- **検証結果**: 全 4 種の入力要素において、入力、変換、確定、および Monaco の Undo 動作を確認済み。

---

### Phase 2: SKK コアエンジン移植 & ブラウザ適応（完了 ✅）

- **目的**: `skk-vscode` の SKK 状態遷移マシンおよびローマ字変換ロジックを、将来の共通ライブラリ化を見据えて `src/core/`（環境非依存の純粋 TypeScript 層）に移植し、ブラウザ用のエディタアダプタと統合する。
- **実装内容**:
  1. **環境非依存コア（`src/core/`）の移植**:
     - `romaji/RomKanaRule.ts`, `romaji/RomajiInput.ts` の移植。
     - 入力モード基盤（`IInputMode`, `AbstractInputMode`, `AbstractKanaMode`）。
     - 各入力モードの実装（`HiraganaMode`, `KatakanaMode`, `HankakuKanaMode`, `ZeneiMode`, `AsciiMode`）。
     - 変換モードの実装（`MidashigoMode`, `InlineHenkanMode`, `MenuHenkanMode`, `AbbrevMode`、送りあり/なし、接頭辞/接尾辞 `>`）。
  2. **ブラウザ向けエディタアダプタ (`BrowserEditorAdapter`) の構築**:
     - Web フォームで DOM を汚染しないよう、未確定バッファ（`▽` や `▼`）をメモリ・HUD 側で保持し、確定時のみ `TextInserter` で DOM に流し込む `IEditor` 実装。
     - 送りあり・送りなし・接頭辞/接尾辞変換に対応したインメモリ辞書プロバイダ (`SimpleMemoryJisyoProvider`)。
     - `document.execCommand('delete')` 優先試行による Undo/Redo スタック保護、および非テキスト入力欄での例外回避。
  3. **Content Script への本統合**:
     - `entrypoints/content.ts` を新コアエンジン + `BrowserEditorAdapter` に完全移行。
     - 未確定時以外の Enter キー透過（フォーム送信・改行・インデント保護）、OS ネイティブ IME 入力中（`isComposing`）の衝突回避ガード。
  4. **単体・結合テストの完備**:
     - Vitest による 137 件の単体テスト（全件パス）。
     - Chrome for Testing + `xvfb-run` による全 4 要素（`<input>`, `<textarea>`, `contenteditable`, Monaco Editor）での E2E 自動結合テスト（全件パス）。
- **検証結果**:
  - 全 137 件の単体テストおよび 4 種の入力要素での E2E テストがエラー 0 でパス。Undo 履歴も正常に動作することを確認済み。

---

### Phase 3: 辞書ストレージ & 検索エンジン (IndexedDB)・Firefox E2E（完了 ✅ - PRレビュー中）

- **目的**: ネットワーク通信を行わず完全ローカル・オフラインで動作する高速な SKK 辞書システムを構築し、複数タブ間でのユーザ辞書同期とインライン再帰辞書登録を実現する。また、Gecko エンジン固有の挙動差異（キャレット座標、`insertText`、フルスクリーン等）による手戻りを防ぐため、Firefox でのヘッドレス E2E 自動結合テスト環境をこの段階で導入・完備する。
- **実装内容**:
  1. **SKK 辞書モデル・パーサーの移植 (標準形式)**:
     - `candidate.ts`, `entry.ts`, `okuri.ts`, `types.ts` 等のモデルとパースロジックを `src/core/skk/jisyo/` に環境非依存で移植。
     - 従来の標準 SKK 辞書形式（EUC-JP / UTF-8、`skk-dev/dict`）の行・テキスト・バッファ読み込みパーサー（`JisyoParser.ts`）の実装。
  2. **システム辞書ストレージ（IndexedDB）の実装**:
     - `public/dict/SKK-JISYO.S` などの辞書を IndexedDB の `system_jisyo` ストアにインデックス付きで格納。
     - 見出し語による高速完全一致および前方一致クエリ（`IDBKeyRange.bound`）の実装（クエリ応答時間 1〜3ms を達成）。
  3. **ユーザ辞書ストレージ & 拡張機能コンテキスト分離の実装**:
     - 登録単語および確定履歴（学習・候補並び替え）の IndexedDB (`user_jisyo`) 永続化（ACID トランザクション保証）。
     - Web ページのスクリプトからユーザ辞書を隔離・保護するため、IndexedDB を Background Service Worker に集約し、Content Script からは RPC プロキシ（`RemoteJisyoStore`, `RemoteUserStore`）経由で透過利用するアーキテクチャを確立。
  4. **インライン辞書登録 & 再帰的辞書登録の実装**:
     - フォーカスを外さずに Floating HUD 内のミニバッファで単語を登録する `RegistrationMode`。
     - 辞書登録中に未知語に遭遇した際の再帰的辞書登録セッション（スタック管理、最大ネスト深度ガード付き）。
  5. **初期辞書ロード & Content Script 統合**:
     - 拡張機能バンドル辞書（公式 `SKK-JISYO.S`）の初回自動インポート機構（`DictionaryLoader.ts`）。
     - `entrypoints/content.ts` への `CompositeJisyoProvider` 統合。
  6. **Firefox (Gecko) ヘッドレス E2E 自動結合テストの導入と差異解消**:
     - Firefox (Gecko) 用ビルド（`wxt build -b firefox`）の自動実行と `geckodriver` によるヘッドレス E2E テスト環境（`test/firefox-verify.mjs`）の構築。
     - Chrome / Firefox 双方での全入力要素（`<input>`, `<textarea>`, `contenteditable`, Monaco Editor）およびインライン辞書登録・学習の自動テスト（全10件）がパスすることを確認済み。
- **検証結果**:
  - 全 272 件の単体テスト、Chrome E2E（5件）、Firefox E2E（5件）の計 10 件のシナリオテストがエラー 0 でパス。

---

### Phase 3.1: JSON 辞書ローダー & IndexedDB データフォーマット検討（次フェーズ 🚀）

- **目的**: [skk-dict/jisyo](https://github.com/skk-dict/jisyo) で策定されている新世代の JSON 辞書形式（`SKK-JISYO.*.json`）の読み込みに対応するとともに、IndexedDB 上での最適なデータ保持構造（単一キーによる統一インデックス vs `okuri_ari` / `okuri_nasi` のストア分離等）を性能・容量・検索要件の観点から定量的に比較・検証し、今後の辞書拡張およびライブラリ化に向けた基盤を確立する。
- **タスク一覧**:
  1. **JSON 辞書パーサー / ローダーの実装 (`src/core/skk/jisyo/`)**:
     - `skk-dict/jisyo` のスキーマ仕様（`jisyo.schema.v0.0.0.json`）に準拠した JSON 形式辞書の読み込みおよびパース機能。
     - 環境非依存なデータモデルへの変換と、ストリーミング・分割読み込みによるメモリ消費抑制の考慮。
     - Vitest による JSON パーサーの網羅的単体テスト。
  2. **IndexedDB 上のデータフォーマット検討 & ベンチマーク**:
     - **注意**: 現時点で `okuri_ari` / `okuri_nasi` にストアを分割するかどうかを固定せず、以下の構造パターンを試作・ベンチマーク測定して評価する：
       - **パターン A (現行統一方式)**: 見出し語（送り仮名ブロックを含む）を単一キーとして 1 つのオブジェクトストアに格納。
       - **パターン B (送りあり/送りなし分割方式)**: JSON 辞書の論理構造に倣い、`okuri_ari` と `okuri_nasi` を別ストア（または複合インデックス）に分離。
     - **評価基準**:
       - 見出し語の完全一致検索レイテンシ（1ms 未満の維持）
       - 前方一致検索（補完候補取得）走査時のカーソル走査コスト
       - 大容量辞書（`SKK-JISYO.L` 等）インポート時のパース・シリアライズオーバーヘッドおよび IndexedDB のストレージ使用量
       - ユーザ辞書（学習・登録）や外部辞書（標準テキスト形式・JSON 形式）との整合性・マイグレーション容易性
  3. **ストレージ層のリファクタリング & 移行パス整備**:
     - ベンチマーク評価結果に基づき、最適なデータフォーマットへの IndexedDB スキーマバージョニング（`DB_VERSION` アップグレード）および移行処理の実装。
     - 従来の標準テキスト形式辞書と新世代 JSON 辞書の透過的な共存・併用サポート。
- **完了条件**:
  - `skk-dict/jisyo` の公式 JSON 辞書を正常にインポート・変換できること。
  - データフォーマットの比較検証結果が文書化され、合意された構造のもとで全単体テスト・E2E テストが継続してパスすること。

---

### Phase 3.2: コアエンジンの堅牢性検証 & プロパティベースドテスト（ファジング）（未着手 ⏳）

- **目的**: 状態遷移マシン（`IInputMode` / `AbstractKanaMode` / `MidashigoMode` / `InlineHenkanMode` / `MenuHenkanMode` / `RegistrationMode`）に対し、擬似ランダムな打鍵シーケンスを大量に投入するプロパティベースドテスト（ファジング）を実施し、不正な状態遷移、未捕捉例外、内部状態のデッドロックが存在しない自己修復性を実証する。
- **タスク一覧**:
  1. **Vitest + `fast-check` によるファジング基盤の構築**:
     - `fast-check` を導入し、日常の `npm run test:unit` とは分離した `npm run test:fuzz` スクリプトを整備。
     - ランダム打鍵ジェネレータ（英数記号、Shift修飾、各種制御キー `Enter`, `Backspace`, `Space`, `Ctrl+j`, `Ctrl+g`）の実装。
  2. **ステートマシンの不変条件（Invariants）検証**:
     - 任意のキーシーケンス投入後、`Ctrl+j` または `Ctrl+g` を入力した際に、必ず初期の平仮名確定モード（`KakuteiMode`）に復帰し、未消化ローマ字バッファや未確定文字列が完全に消去されることの自動検証。
     - 例外スローや `NaN`, `undefined` 参照によるハングアップが発生しないことの検証。
  3. **不具合パターンの縮小化（Shrinking）とテストケース還元**:
     - 縮小化アルゴリズムにより特定された最小の不具合入力シーケンスを `test/unit/` の決定論的リグレッションテストとして登録。
- **完了条件**:
  - 数万回のランダムシーケンス実行でステートマシンが破綻しないことが確認され、CI 用のファジング実行コマンドが整備されること。

---

### Phase 4: SKK コアエンジンの共通ライブラリ抽出（未着手 ⏳）

- **目的**: Phase 2〜3 で要件が確定した `src/core/` を独立した TypeScript ライブラリとして抽出し、`skk-vscode` と `skk-browser-extension` でコードを共通化する。
- **タスク一覧**:
  1. **独立パッケージの構成**:
     - 独立リポジトリまたは monorepo パッケージ（例: `@yhayase/skk-core`）としてプロジェクトを初期化。
     - ESM / CJS 両対応のビルドパイプライン（tsup または rollup）と型定義 (`.d.ts`) の出力設定。
     - コアエンジンの単体テストスイートの移行。
  2. **`skk-vscode` への適用**:
     - `skk-vscode` から重複する `src/lib/` コードを削除し、共通ライブラリへの依存に切り替え。
     - VS Code 拡張機能としての既存テストおよび動作確認。
  3. **`skk-browser-extension` への適用**:
     - `src/core/` を共通ライブラリの import に切り替え、結合テストで動作確認。
- **完了条件**:
  - 共通ライブラリへの変更が両プロジェクトに反映可能となり、重複コードが完全に解消されること。

---

### Phase 5: UI/UX 改善 & 候補選択メニュー（未着手 ⏳）

- **目的**: 快適なタイピング体験のためのリッチな視覚フィードバックと候補選択 UI を提供する。
- **タスク一覧**:
  1. **複数候補一覧メニュー (MenuHenkanMode)**:
     - 変換候補が多数ある場合のドロップダウン/ポップアップ候補リスト。
     - 数字キー（1〜9）による直接選択、Space キーによる次候補、`x` キーによる前候補ナビゲーション。
  2. **スマートな配置・クランプ処理**:
     - 画面端（下端・右端）での HUD のはみ出し防止と画面内クランプ。
     - スクロール追従の最適化。
  3. **テーマ・デザイン対応**:
     - ページの背景色や OS のダークモード/ライトモード設定に応じた HUD スタイルの適応。
- **完了条件**:
  - 長い候補一覧でも画面外に見切れず、キーボードのみでストレスなく候補選択・確定ができること。

---

### Phase 6: 設定画面・ドメイン制御 & ストア公開準備（未着手 ⏳）

- **目的**: ユーザーが自由に設定を変更できる UI を整備し、公式ストア（Chrome ウェブストア、Firefox Add-ons）への申請要件を満たす。
- **タスク一覧**:
  1. **ポップアップ UI (Popup Entrypoint)**:
     - サイト単位での有効/無効トグル（ブラックリスト/ホワイトリスト）。
     - 現在のステータス表示。
  2. **設定ページ (Options Entrypoint)**:
     - SKK 起動キーバインド設定（`Ctrl+j`、`Ctrl+Space` 等）。
     - 追加辞書（ユーザー辞書・専門辞書・標準形式/JSON形式辞書）のインポート/エクスポート/削除。
     - 入力設定（確定キー、句読点スタイル等のカスタマイズ）。
  3. **クロスブラウザパッケージング & ドキュメント整備**:
     - Chrome 版 (CRX) / Firefox 版 (XPI) のビルド・検証。
     - プライバシーポリシーの作成（外部通信を行わない完全ローカル動作の明記）。
     - ストア掲載用アイコン、スクリーンショット、説明文の準備。
- **完了条件**:
  - Chrome / Firefox 双方のストア申請ビルドがエラーなく生成され、設定変更がすべてのタブに即時反映されること。
