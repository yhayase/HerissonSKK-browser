# ストア掲載用素材

2026-09-23 に 0.1.3 で撮影したストア掲載用素材です。日本語フォント指定の修正後に Chrome／Firefox の変換・単語登録・VS Code 画面を再撮影しました。Firefox の辞書設定は作者の手動撮影画像です。

| 内容 | Chrome | Firefox |
| --- | --- | --- |
| かな漢字変換 | [画像](./chrome-01-conversion.png) | [画像](./firefox-01-conversion.png) |
| 単語登録 | [画像](./chrome-02-registration.png) | [画像](./firefox-02-registration.png) |
| 辞書設定 | [画像](./chrome-03-dictionaries.png) | [画像](./firefox-03-dictionaries.png) |
| VS Code for the Web | [画像](./chrome-04-vscode.png) | [画像](./firefox-04-vscode.png) |

スクリーンショットはすべて 1280 × 800 px です。背景の入力デモは撮影専用ページで、拡張機能の画面そのものではありません。変換表示と登録ダイアログは実際の拡張機能をキー操作した結果です。辞書設定は実際の設定画面です。VS Code は `https://vscode.dev` の新規未保存ファイルで実際に変換している画面です。拡張機能の表示を画像合成や CSS の差し替えで変更していません。

Firefox の辞書設定画面は、2026-09-23 に作者が 0.1.3 の Firefox ウィンドウを手動撮影したものです。ブラウザー枠と余白をトリミングし、縦横比を維持して Lanczos 法で縮小しました。上下に背景色の余白を補い、1280 × 800 px に統一しています。表示内容は変更していません。

[小型プロモーション画像](./promo-440x280.png)は Chrome Web Store 向けの 440 × 280 px です。採用済みアイコンと説明文を HTML で組み合わせました。画像サイズは [Chrome Web Store の公式案内](https://developer.chrome.com/docs/webstore/images)に合わせています。Chrome 用画像は透過なしの RGB PNG です。

## 再生成

```sh
npm run build
npm run build:firefox
node scripts/capture-store-screenshots.mjs
```

インストール済みの試験用 Chrome と Firefox、一時ブラウザープロファイルを使用します。基本辞書の初回取得と vscode.dev の表示にはネットワーク接続が必要です。撮影用サーバーは 127.0.0.1 のみで待ち受け、終了時に閉じます。個人のブラウザープロファイルは使用しません。

環境情報は [capture.json](./capture.json)、撮影ページは `scripts/store/`、操作は `scripts/capture-store-screenshots.mjs` にあります。公開版の UI が変わった場合は撮り直してください。

## 掲載時の説明文

- かな漢字変換: Web ページの入力欄で SKK 方式の日本語入力を使えます。
- 単語登録: 辞書にない言葉を入力中に登録し、同じブラウザーで利用できます。
- VS Code for the Web: ブラウザー内の VS Code でも SKK 方式で日本語を入力できます。
- 辞書設定: 基本辞書・追加辞書の選択や、URL・ファイルからの辞書追加ができます。

ブランド画像の再利用条件は `../brand/README.md` を参照してください。

## 撮影ページのフォント

デモページとプロモーション画像は `system-ui, sans-serif` を指定しています。この撮影環境の Chrome では欧文が Noto Sans、日本語が Noto Sans CJK JP で描画されることを開発者プロトコルで確認しました。フォントは固定配信していないため、OS やブラウザーにより異なります。

拡張機能の変換表示・登録ダイアログは `lang="ja"` と、日本語フォントを含む製品側の共通フォント指定（`src/hud/overlayTheme.ts`）を使用します。VS Code の画面は同サービスの標準設定です。
