# 0.1.3 リリースノート

Firefox Add-ons と Chrome Web Store への初回掲載に向けたバージョンです。現在は公開待ちです。非掲載版 0.1.2 と入力機能は同じです。Firefox は掲載用のバージョン番号を更新し、Chrome は未使用の storage 権限と Firefox 専用の設定を配布 manifest から削除しています。

- ブラウザーの入力欄と iframe 内の入力欄で SKK 方式の日本語入力を使えます。
- かな漢字変換、単語登録、候補の学習、個人辞書の候補削除に対応しています。
- VS Code for the Web（vscode.dev）でも利用できます。
- 初回起動時に基本辞書をダウンロードし、取得後の変換はブラウザー内で処理します。

PC の Chrome・Firefox、物理キーボードを使う Android の Firefox を対象とします。候補メニューと単語登録画面は iframe の表示領域内に制限されます。
