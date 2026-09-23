# 0.1.2 ストア提出用資料

## 配布物

- Chrome: `.output/herissonskk-browser-0.1.2-chrome.zip`
- Firefox（未署名）: `.output/herissonskk-browser-0.1.2-firefox.zip`
- Firefox 審査用ソース: `.output/herissonskk-browser-0.1.2-sources.zip`
- バージョンノート: [0.1.2 リリースノート](./release-notes-0.1.2.md)
- タイトル・概要・説明: [掲載文案](./store-listing.md)
- 画像: [採用済み素材](../assets/store/README.md)

Firefox の ID は `herissonskk@yhayase` を維持します。同じ ID の既存アドオンへの更新として扱い、`herissonskk@hayase` への移行は行いません。

## Mozilla 審査担当者への説明文案

本拡張機能は TypeScript を WXT／Vite で変換・結合・最小化しています。独自の難読化処理はありません。別添のソース ZIP のルート README に、OS・Node.js・npm のバージョンと、依存取得から配布 ZIP 作成までの手順を記載しています。`bash scripts/release/build-firefox.sh` で再現できます。

初回起動時に基本辞書 S を raw.githubusercontent.com から取得し、ブラウザー内に保存します。配布物には SKK 辞書を同梱していません。入力内容や登録語を変換サーバーや AI サービスへ送信しません。辞書取得後の変換はローカルで行います。

動作確認には通常の Web ページの入力欄を使います。Ctrl+j でかな入力を開始し、Nihongo と入力して Space で変換、Enter で確定できます。iframe 内の入力欄にも対応しています。Android では物理キーボードを使用します。

## 公開前に残る確認

- GitHub リポジトリは公開済みです。以下の問い合わせ・プライバシーポリシーとリポジトリの URL は認証なしでアクセスできることを確認しました。
  - 問い合わせ: https://github.com/yhayase/HerissonSKK-browser/issues
  - プライバシーポリシー: https://github.com/yhayase/HerissonSKK-browser/blob/main/docs/privacy-policy.md
  - 操作説明: https://github.com/yhayase/HerissonSKK-browser/blob/main/README.md
- アイコンは公式アプリの配布・紹介に利用可、別製品への流用は個別許可と確定しました。利用条件を配布物に同梱しています。
- Firefox 0.1.2 の署名済み XPI を取得し、提出物との一致を確認しました。保存先は `.local/releases/0.1.2/herissonskk-browser-0.1.2-firefox-signed.xpi` です。作者の判断により、Android の追加確認は今回のリリース条件から外しました。
- Chrome 開発者登録・提出状況を確認し、準備が整ったストアから提出します。

非掲載版 0.1.2 の提出と署名済み XPI の取得は完了しました。GitHub リポジトリの公開は完了しました。ストア掲載と署名済み 0.1.2 の実機確認は未実施です。
