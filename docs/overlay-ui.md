# オーバーレイのブラウザ検証

ビルド済み拡張機能を一時プロファイルへ読み込み、設定画面から検証辞書を取り込みます。変換操作には Puppeteer の実ブラウザキーボード入力を使います。

```sh
npm run build
npm run build:firefox
CHROME_PATH=/path/to/chrome node test/overlay-e2e.mjs chrome
FIREFOX_PATH=/path/to/firefox node test/overlay-e2e.mjs firefox
```

実行ディレクトリにソース、依存パッケージ、`.output/chrome-mv3` と `.output/firefox-mv2` が必要です。Firefox の Snap 版で `/tmp` のファイルが見えない場合は、ブラウザから読める作業ディレクトリへコピーして実行します。

結果は `.output/overlay-e2e-chrome` と `.output/overlay-e2e-firefox` に保存します。検証、ブラウザ終了、manifest 復元、サーバー停止が全て成功した実行だけが `metrics.json` に `result: "PASS"` を記録します。後処理は個別に実行し、検証と後処理の両方が失敗した場合は元のエラーも `failure.json` に残します。失敗時は `failure.json` にシナリオ名とエラーを記録し、可能な場合は `failure-state.json` と `failure.png` も保存します。再実行の開始時に前回の成功・失敗 JSON を削除します。スクリーンショットの更新日時も併せて確認します。

検証内容は、ライト／ダークの実背景と文字コントラスト、18px の主文字、注釈全文のキーボード表示・スクロール、候補の正確なキー対応、Space と x／Backspace によるページ移動、リサイズ後の候補確定、四隅の実キャレットと入力行を避ける配置、スクロール後の再配置、短い読みのコンパクトな幅、長い読みの末尾表示、登録・再帰登録中の配色と候補確定です。短い候補の専用辞書では、通常幅で注釈プレビューが実際に表示されること、高さ不足時にプレビューが隠れて「注釈あり」が表示されることを確認します。プレビュー・省略表示・全文の注釈は14pxと4.5:1以上を検証します。最初の3候補は単独表示、4回目の Space から一覧になることも確認します。

Firefox の明暗切り替えは、一時ビルドにだけ `browserSettings` 権限を追加し、使い捨てプロファイルの [`overrideContentColorScheme`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/browserSettings/overrideContentColorScheme) 設定を変更します。ソースの製品権限は変更せず、実行後はビルド済み manifest も元へ戻します。

Chrome の拡大検証は CDP の `Emulation.setPageScaleFactor` による visual viewport の倍率変更です。ウィンドウサイズ変更やツールバーのブラウザ拡大とは区別します。Firefox のブラウザ拡大と Android 実機は、このランナーの成功だけでは確認済みになりません。既存の入力・送り仮名・学習の回帰検証には、別途 `npm run test:all` と単体テストを実行します。
