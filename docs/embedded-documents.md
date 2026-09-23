# 埋め込み文書での入力

HerissonSKK は、通常のページに加え、URL が一致する `iframe` の各文書でも入力を処理します。別ドメインの `iframe`、入れ子の `iframe`、後から追加・再読み込みされた `iframe` も対象です。各文書が独立した入力状態、候補表示、単語登録画面を持ち、辞書と学習結果は拡張の保存領域を共有します。

## 適用条件

- `all_frames` で各フレームに読み込みます。`about:blank` と `srcdoc` は `match_about_blank` で親文書の一致を継承します。
- `match_origin_as_fallback` で、作成元が一致する `data:`、`blob:`、sandbox による不透明な文書にも読み込みます。Firefox ではこの指定が **128 以降**で有効です。Firefox 109～127 では通常の URL のフレームと `match_about_blank` が扱える範囲に限られます。拡張全体の Firefox 最低バージョンは 109 のままです。109～127 の実機確認は行っていません。
- ブラウザーが拡張の実行を禁じる内部ページ、拡張ページ、権限のない文書には読み込みません。適用範囲はブラウザーの権限判定に従います。

トップページでは従来どおり起動時に入力エンジンを用意します。子フレームでは、信頼された入力欄へのフォーカスまたはキー操作が起きた時点で作り、入力欄のない埋め込み文書で HUD や辞書接続を増やしません。最初の `Ctrl+J` でかなモードに切り替え、その直後の文字も辞書の準備が終わるまで保持します。待機中に別の入力欄やフレームへ移ったキーは適用しません。

## 表示上の制約

候補表示と単語登録画面は入力欄を含むフレーム内に置き、フレームの表示領域に合わせて幅・高さを制限します。候補が収まらないときは注釈の省略やスクロールで操作します。極端に小さいフレームでは登録画面を実用的な大きさで表示できません。親ページ上へ表示する仕組みは使っていません。

open Shadow DOM 内の入力欄は既存の探索処理の対象です。closed Shadow DOM の内部とブラウザーの制限でアクセスできない入力欄は対象外です。

VS Code の Web 版に使う Monaco 互換処理も、対象サイトの埋め込み文書に同じフレーム条件で適用します。対象サイトの URL 制限は維持します。

## 再現確認

ローカルの Chromium と Firefox を使う試験は、ビルド後に次のコマンドで実行します。テストは配布物を一時ディレクトリへコピーし、ローカルサーバー上に通常・別オリジン・入れ子・動的追加・特殊 URL のフレームを作ります。

```sh
npm run build
xvfb-run -a node test/embedded-documents-e2e.mjs chrome
npm run build:firefox
xvfb-run -a node test/embedded-documents-e2e.mjs firefox
```

試験対象には、入力と候補、フレーム間の学習共有、単語登録、候補表示の収まり、open Shadow DOM を含めます。実際の MDN サンプルはブラウザーで別途確認します。

### 2026-09-23 の検証結果

- 単体テスト 528 件、TypeScript の型検査、Chrome・Firefox のビルドが成功しました。
- 埋め込み文書の E2E は Chrome・Firefox ともに 16 ケースが成功しました。`blob:`、`data:`、不透明な sandbox も省略せず確認しました。
- 高さ 80px のフレーム内で登録画面が収まり、スクロールして入力できること、未使用フレームに HUD を作らないこと、フォーカス移動後に以前の HUD が非表示を保つことを確認しました。
- 既存の基本入力 E2E は Chrome・Firefox ともに 5 ケースが成功しました。
- PC の Firefox で MDN の `input type="text"` の冒頭の対話サンプルと本文のサンプルにかな入力できることを確認しました。
- Android の署名済み修正版、Firefox 109～127 の実機確認は未実施です。

フレーム適用条件は [Mozilla の content_scripts 仕様](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/content_scripts)と [Chrome の content scripts 仕様](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)を参照しています。
