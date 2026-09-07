# 開発ロードマップ (Development Roadmap)

本書は、ブラウザ向け汎用 SKK 入力拡張機能（Chrome / Firefox 対応、VS Code for Web 完全対応）の開発フェーズ、マイルストーン、および進捗状況を管理するロードマップです。

全体のアーキテクチャおよび技術的課題・方針については [docs/architecture.md](file:///home/hayase/Documents/devel/skk-browser-extension/docs/architecture.md) を参照してください。

---

## 全体フェーズ一覧

| フェーズ | テーマ | 状態 | 主な成果物・マイルストーン |
| :--- | :--- | :---: | :--- |
| **Phase 1** | **汎用入力 & Monaco Editor PoC** | **完了 ✅** | キー横取り、汎用要素・Monaco への文字挿入、キャレット追従 HUD、フルスクリーン対応、ヘッドレス E2E テスト |
| **Phase 2** | **SKK コアエンジン & 状態遷移マシンの移植** | **着手 🚀** | `skk-vscode` からの純粋 TypeScript コア移植（ローマ字変換、各入力モード、接頭辞/接尾辞、ブラウザ用エディタアダプタ） |
| **Phase 3** | **辞書ストレージ & 検索エンジン (IndexedDB)** | 未着手 ⏳ | 大容量 SKK 辞書（SKK-JISYO.L 等）のローカル IndexedDB 格納、高速前方一致/完全一致検索、個人学習辞書 |
| **Phase 4** | **UI/UX 改善 & 候補選択メニュー** | 未着手 ⏳ | 複数候補一覧メニュー（1〜9 選択、Space 送り、x 戻り）、ビューポート端へのクランプ、ダーク/ライトテーマ追従 |
| **Phase 5** | **設定画面・ドメイン制御 & ストア公開準備** | 未着手 ⏳ | ポップアップ UI（有効/無効・除外サイト）、オプション画面（キーバインド・辞書管理）、Chrome/Firefox パッケージング |

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

### Phase 2: SKK コアエンジン & 状態遷移マシンの移植（着手 🚀）

- **目的**: `skk-vscode` で実績のある SKK 状態遷移マシンおよびローマ字変換ロジックを、VS Code API に依存しない純粋な TypeScript ライブラリとして移植・統合する。
- **タスク一覧**:
  1. **ローマ字変換エンジンの移植**:
     - `romaji/RomKanaRule.ts`, `romaji/RomajiInput.ts` の移植。
     - ひらがな、カタカナ、半角カナ、全角英数の変換ルールの整備。
  2. **入力モード状態遷移マシンの移植**:
     - `IInputMode` インターフェースの定義。
     - 各種モードの実装（`HiraganaMode`, `KatakanaMode`, `HankakuKanaMode`, `ZeneiMode`, `AsciiMode`）。
     - 変換モードの実装（`MidashigoMode`, `InlineHenkanMode`, `MenuHenkanMode`, `AbbrevMode`）。
     - 送りあり・送りなし変換、および接頭辞・接尾辞（`>`）変換の制御。
  3. **ブラウザ向けエディタアダプタ (`BrowserEditorAdapter`) の構築**:
     - `skk-vscode` の `IEditor` インターフェースを、Phase 1 で構築した `CaretPosition.ts`, `TextInserter.ts`, `FloatingHUD.ts` をラップする形で実装。
  4. **単体テストの整備**:
     - Vitest 等によるローマ字バッファ・状態遷移の自動テスト環境の構築。
- **完了条件**:
  - 固定のインメモリ辞書データを用いて、ひらがな入力、カタカナ変換、送りあり/なし変換、確定がブラウザ上でスムーズに動作すること。

---

### Phase 3: 辞書ストレージ & 検索エンジン (IndexedDB)（未着手 ⏳）

- **目的**: ネットワーク通信を行わず完全ローカル・オフラインで動作する高速な SKK 辞書システムを構築する。
- **タスク一覧**:
  1. **SKK 辞書パーサーの移植**:
     - `skk-vscode` の `candidate.ts`, `entry.ts`, `okuri.ts`, `jisyo.ts` 等のモデルとパースロジックの移植。
  2. **IndexedDB 辞書ストレージの実装**:
     - `SKK-JISYO.L` などの大容量辞書を IndexedDB にインデックス付きで格納。
     - 見出し語による高速完全一致および前方一致クエリの実装（クエリ応答時間 5ms 未満を目標）。
  3. **個人学習辞書（User Jisyo）の実装**:
     - 確定履歴の学習と候補並び替え。
     - ユーザー独自登録単語の永続化。
  4. **初期辞書ロード機構**:
     - 拡張機能バンドル辞書の初回自動インポート、または設定からの辞書ファイル読み込み機能。
- **完了条件**:
  - `SKK-JISYO.L` を取り込み、数十万語の辞書から体感遅延なく漢字変換が行えること。

---

### Phase 4: UI/UX 改善 & 候補選択メニュー（未着手 ⏳）

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

### Phase 5: 設定画面・ドメイン制御 & ストア公開準備（未着手 ⏳）

- **目的**: ユーザーが自由に設定を変更できる UI を整備し、公式ストア（Chrome ウェブストア、Firefox Add-ons）への申請要件を満たす。
- **タスク一覧**:
  1. **ポップアップ UI (Popup Entrypoint)**:
     - サイト単位での有効/無効トグル（ブラックリスト/ホワイトリスト）。
     - 現在のステータス表示。
  2. **設定ページ (Options Entrypoint)**:
     - SKK 起動キーバインド設定（`Ctrl+j`、`Ctrl+Space` 等）。
     - 追加辞書（ユーザー辞書・専門辞書）のインポート/エクスポート/削除。
     - 入力設定（確定キー、句読点スタイル等のカスタマイズ）。
  3. **クロスブラウザパッケージング & ドキュメント整備**:
     - Chrome 版 (CRX) / Firefox 版 (XPI) のビルド・検証。
     - プライバシーポリシーの作成（外部通信を行わない完全ローカル動作の明記）。
     - ストア掲載用アイコン、スクリーンショット、説明文の準備。
- **完了条件**:
  - Chrome / Firefox 双方のストア申請ビルドがエラーなく生成され、設定変更がすべてのタブに即時反映されること。
