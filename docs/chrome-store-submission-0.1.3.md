# Chrome Web Store 初回提出（0.1.3）

## 登録と提出物

Google Play とは別に Chrome Web Store の開発者登録が必要です。`herisson@haya.se` の Google アカウントで [開発者ダッシュボード](https://chrome.google.com/webstore/devconsole/) を開き、規約と登録料の画面を確認します。登録料は一度限りです。支払いは作者が行います。

登録後、新しいアイテムとして次の ZIP をアップロードします。

```text
.local/releases/0.1.3/chrome-store/herissonskk-browser-0.1.3-chrome.zip
SHA-256: 695f329b54903bb080fa0e8b23bcbb17dfe752878708aca97169b0c13a429674
```

親ディレクトリにある旧 Chrome ZIP ではなく、`chrome-store/` 内の ZIP を使います。Firefox 提出済みの ZIP とソース ZIP はそのまま保持しています。

## 掲載内容と画像

- 名前: HerissonSKK for Chrome
- 言語: 日本語
- 説明: [掲載文案](./store-listing.md) の説明・制作と AI の利用・基本操作を使用します。対応範囲は PC の Chrome とし、Android の Firefox の説明は転記しません。
- サポート: https://github.com/yhayase/HerissonSKK-browser/issues
- ホームページ: https://github.com/yhayase/HerissonSKK-browser
- プライバシーポリシー: https://github.com/yhayase/HerissonSKK-browser/blob/main/docs/privacy-policy.md
- アイコン: `public/icon/128.png`
- スクリーンショット: `assets/store/chrome-01-conversion.png`、`chrome-02-registration.png`、`chrome-03-dictionaries.png`、`chrome-04-vscode.png`（いずれも 1280 × 800）
- 小さいプロモーション画像: `assets/store/promo-440x280.png`

## 単一の目的

Web ページの入力欄で SKK 方式の日本語入力を提供します。かな漢字変換、単語登録、候補の学習、変換に使用する辞書の設定はこの入力機能のために使用します。

## 権限の理由

Web ページの入力欄と iframe 内でキー入力を処理し、変換候補や単語登録画面を表示するため、対象ページにコンテンツスクリプトを読み込みます。VS Code for the Web の入力欄にも対応します。

`https://raw.githubusercontent.com/*` は初回の基本辞書取得と、同じ配信元にある辞書の追加・更新に使います。任意の HTTP/HTTPS ホスト権限は、利用者が指定した辞書 URL から取得するために、その配信先への許可を要求する用途です。辞書取得の要求に変換中の読みや登録語を含めません。

Chrome 版に `storage` 権限はありません。辞書・学習・設定は IndexedDB に保存します。

## リモートコード

リモートコードは使用しません。外部から取得するものは JSON またはテキストの辞書データで、実行コードではありません。

## データ利用の申告

ローカル処理であることだけを理由に「データを扱わない」とは回答しません。[公式 FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) は端末内だけの処理・保存も開示対象としています。

入力欄のテキストとキー操作を日本語入力のために処理し、登録語と学習結果をブラウザー内に保存します。入力内容の外部送信、広告利用、販売、アクセス解析、ブラウザー間の同期は実装していません。辞書配信先には IP アドレスなど通信に必要な情報が伝わります。

申告画面では「ウェブサイトのコンテンツ」「ユーザーのアクティビティ」（キー入力）に関する設問を確認します。実際の選択肢と定義を読んでから確定し、申告とプライバシーポリシーを一致させます。現時点ではストア画面での申告は未実施です。

## 審査時の動作確認

ログインや有料サービスは不要です。初回の辞書取得にはネット接続が必要です。通常の Web ページの入力欄で `Ctrl+j`、`Nihongo`（先頭のみ大文字）、Space、Enter の順に操作すると「日本語」を入力できます。ブラウザー内部ページやストアなど拡張機能を制限するページは対象外です。

## 提出前の検証

2026-09-23 に型検査、Chrome の入力 E2E（input、textarea、contenteditable、Monaco、単語登録・学習）、辞書管理と同一プロファイルでのオフライン再起動 E2E が成功しました。旧 Chrome ZIP との差分は manifest の未使用 `storage` 権限と Firefox 専用設定の削除のみです。Firefox ZIP の全 26 ファイルは提出用保管物とバイト単位で一致しています。Android の追加試験は行っていません。
