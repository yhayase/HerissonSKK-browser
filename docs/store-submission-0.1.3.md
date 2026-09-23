# Firefox 0.1.3 掲載申請

## 提出経路

既存の `herissonskk@yhayase` の管理画面から新しいバージョンを提出します。配布方法は「このサイト上」（On this site／AMO 掲載）を選びます。新規アドオン登録は行いません。

署名済みの非掲載版 0.1.2 と同じ番号は再使用できないため、掲載用は 0.1.3 とします。拡張 ID・機能・コードは変更しません。

- 配布 ZIP: `.output/herissonskk-browser-0.1.3-firefox.zip`
- 審査用ソース ZIP: `.output/herissonskk-browser-0.1.3-sources.zip`
- 対応プラットフォーム: Firefox と Firefox for Android
- ソース提出: はい（WXT／Vite による変換・結合・最小化を使用）
- [バージョンノート](./release-notes-0.1.3.md)

## 掲載項目

| 項目 | 内容 |
| :--- | :--- |
| 名前 | HerissonSKK for Firefox |
| 希望する掲載 URL の末尾 | herissonskk（空いていない場合は herissonskk-for-firefox） |
| 概要 | ブラウザーの入力欄で SKK 方式の日本語入力を使えます。かな漢字変換、単語登録、候補の学習をローカルで処理します。 |
| ライセンス | MIT |
| サポート Web サイト | https://github.com/yhayase/HerissonSKK-browser/issues |
| ホームページ | https://github.com/yhayase/HerissonSKK-browser |
| プライバシーポリシー URL | https://github.com/yhayase/HerissonSKK-browser/blob/main/docs/privacy-policy.md |

説明には [掲載文案](./store-listing.md)の説明・制作と AI の利用・基本操作・対応範囲と制約を使用します。プライバシーポリシーが URL ではなく本文入力欄の場合は [本文](./privacy-policy.md)を転記します。アイコンは本体 MIT の対象外であり、[専用の利用条件](../public/licenses/HerissonSKK-icon.txt)があることも掲載説明に追記します。

## 画像

掲載用の画像欄で次を選びます。アップロード手順中に欄がない場合は、掲載情報の編集画面の「画像」欄を確認します。

- アイコン: `assets/brand/HerissonSKK-512.png`
- 変換: `assets/store/firefox-01-conversion.png`
- 単語登録: `assets/store/firefox-02-registration.png`
- VS Code for the Web: `assets/store/firefox-04-vscode.png`

## 審査担当者へのメモ

TypeScript を WXT／Vite で変換・結合・最小化しています。独自の難読化処理はありません。添付ソース ZIP の README にビルド環境と手順を記載しています。`bash scripts/release/build-firefox.sh` で再現できます。

初回起動時に基本辞書を取得します。通常の Web ページの入力欄で Ctrl+j、Nihongo、Space、Enter の順に操作すると変換・確定できます。iframe 内の入力欄にも対応しています。Android は物理キーボードでの利用を対象とします。入力内容・登録語を変換サーバーや AI サービスへ送信しません。

既存の非掲載版 0.1.2 と機能・コードは同一です。今回、掲載用としてバージョンを 0.1.3 に変更しました。

## 参照

- [Mozilla の提出手順](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/)
- [AMO のバージョン重複検証](https://github.com/mozilla/addons-server/blob/master/src/olympia/versions/utils.py)

この文書の作成時点では AMO 掲載申請は未実施です。アカウント上の操作は作者が行います。
