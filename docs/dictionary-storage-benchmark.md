# JSON 辞書ストレージ比較ベンチマーク

## 目的と範囲

Phase 3.1 の初期レイアウト判断として、同じ辞書レコードを実ブラウザーの IndexedDB に保存し、次の2案を比較します。

- A（`single`）: 現行 `IndexedDbJisyoStore` と同じ `keyPath: "key"` の単一 `system_jisyo` ストア
- B（`split`）: 同じレコードを `okuri_ari` と `okuri_nasi` の2ストアに分割

レコードは両案とも `{ key, candidates: [{ word, annotation? }] }` です。完全一致は、既存の `lookup(key)` に送り有無の引数がないため、B の両ストアへ同時に `get(key)` を発行します。公式辞書の `okuri_nasi` には `Cyrillic` や `#bit` のように英小文字で終わる見出しがあるため、末尾文字によるストア選択は正しくありません。固定した S/L ではセクション間に同じ見出しはありません。

前方一致では両ストアへ現行と同じ `getAll(range, limit)` を発行し、`indexedDB.cmp` の順序でマージしてから全体の `limit` を適用します。

この比較はストレージレイアウトだけを分離したマイクロベンチマークです。v4 の辞書ID・generationを含む複合キー、active generation メタデータ、安全な置換処理、拡張機能のメッセージ経路、候補生成全体の時間は含みません。最終実装の回帰判断には、実装後の production store と候補表示までのエンドツーエンド計測が別途必要です。

## 入力データの固定

次の公式生成物だけを受け付けます。実行時にバイト数と SHA-256 を検証し、一致しない場合は計測を開始しません。`SKK-JISYO.L.json` はリポジトリへ追加しません。

| 辞書 | URL | バイト数 | SHA-256 |
| --- | --- | ---: | --- |
| S | `https://skk-dict.github.io/jisyo/json/SKK-JISYO.S.json` | 93,963 | `729e562f963ec06186c251c116510d6ed89aa525be78d6e2795920786741f0bc` |
| L | `https://skk-dict.github.io/jisyo/json/SKK-JISYO.L.json` | 6,450,342 | `6ae463c99442ba5d09a58a3b5fd68f1e179e25c117d9696de930e881039d2f41` |

JSON は upstream converter が候補をデコード済み文字列として出力した形式です。元辞書の注釈は converter で除去されるため、このベンチマークから注釈の解析・保持コストは分かりません。

## 実行方法

S と L を `/tmp/skk-phase31` に配置した場合は次を実行します。

```sh
npm run bench:dictionary -- --browser both --dataset all --output /tmp/dictionary-benchmark.json
```

既定値は同一ブラウザープロセス・一時プロファイル内での fresh DB 3反復、完全一致96件、前方一致48件、前方一致上限20件、ウォームアップ1回、ウォーム計測3回、投入バッチ2,000件です。実行時間を抑えた動作確認例は次のとおりです。

```sh
npm run bench:dictionary -- --browser chrome --dataset S --runs 1 --exact-queries 8 --prefix-queries 4 --warmup-rounds 0 --measured-rounds 1 --output /tmp/dictionary-benchmark-smoke.json
```

環境変数は `DICTIONARY_BENCH_DATA_DIR`、`CHROME_BIN`、`GECKODRIVER_PATH`、`FIREFOX_PATH` に対応します。Chrome は既存の Chrome for Testing のパス、Firefox は既存 E2E と同じ geckodriver と Firefox の検出規則を使います。追加パッケージは不要です。

## 計測方法

各反復で production の `parseJsonJisyo` と `iterateJsonJisyoEntries` を使って同じ入力を解析し、保存レコードへ正規化して IndexedDB のキー順に並べます。重複した簡易パーサーは持ちません。見出しを固定し、等間隔に選んだ同一クエリ列を A/B に使います。完全一致は80%をヒット、残りを確実なミスにし、送りなしで英小文字に終わる見出しも必ず含めます。前方一致は長さ1〜4の接頭辞を決定的に選びます。

反復ごとに新しいデータベース名を使い、A/B の投入・検索順とシリアライズ順を交互にします。シリアライズ順は各反復の結果にも記録します。投入後、計時前に全クエリの返却レコード、候補順、前方一致の全体順序と上限が一致することを検証します。その後に接続を閉じて開き直し、最初のクエリ列を `cold-ish` として記録します。OS のファイルキャッシュや IndexedDB エンジン内部キャッシュは強制消去できないため、完全なコールド計測ではありません。ウォームアップ後の計測値は `warm` として分けます。反復終了時にデータベースを削除します。ブラウザーごとに S/L と全反復で同じプロセスと一時プロファイルを共有するため、反復を独立試行とは扱いません。Chrome のプロファイルとビルド済み一時ファイルは終了時に削除し、Firefox のプロファイルは geckodriver が作成・破棄します。

次を JSON に記録します。

- JSON の解析・正規化・並べ替え、保存表現の `JSON.stringify`、IndexedDB 投入の所要時間
- 完全一致と前方一致のレイテンシーの median と p95
- 前方一致で JavaScript に返ったレコード数
- `navigator.storage.estimate()` の投入前後差分
- 利用できる場合の `performance.measureUserAgentSpecificMemory()` と Chromium 固有 `performance.memory`
- User-Agent、`crossOriginIsolated`、設定、入力ハッシュ、生の反復値

前方一致の「返却レコード数」は、A では最大 `limit`、B では各ストア最大 `limit` です。ブラウザー内部の B-tree ページ読み取り数やカーソル訪問数を Web API から取得することはできないため、その代用値として明記します。`storage.estimate()` はオリジン全体の概算・丸め値であり、IndexedDB ファイルの実測サイズではありません。シリアライズ後のバイト数も IndexedDB のディスク使用量ではなく、レコード表現の比較用プロキシです。メモリー値はページの JS ヒープなどを含み、GC 時点を固定していない参考値です。未対応ブラウザーでは欠落します。

## 判定方法と結果

絶対時間の閾値は使いません。同じブラウザー、辞書、反復番号における B/A 比を比較します。出力の `pairedRatiosSplitOverSingle` は反復ごとの比の median、最小、最大を示しますが、反復3回の範囲であり信頼区間ではありません。

保守的な自動判定として、ウォーム完全一致 median、ウォーム前方一致 median、投入時間の3指標すべてで、B/A が全反復にわたり1未満の場合だけ B を推奨します。差が反復間のばらつきに収まる場合、またはいずれかの主要経路で一貫した改善がない場合は A を推奨します。median/p95、cold-ish、返却レコード数、概算容量も併記し、単一の集約値だけでは決めません。

### 実行結果（2026-09-09）

Google Chrome for Testing 152.0.7977.82 と Firefox 155.0.1 のヘッドレス実ブラウザーで、S/L を各 fresh DB 3反復しました。全条件で、計時前の完全一致96件と前方一致48件の結果、候補順、全体順序、上限が A/B で一致しました。

[正式結果JSON](./benchmarks/phase31-layout.json) は 661,670 bytes、SHA-256 946eaabe4ee64cafa5b5f69a08eac44a017d058efb253a9f1d887ce559dd3478 です。結果内に次の再現情報を保存しています。

- Git HEAD f2411410bff912caeca07e0bd043812dbb5f3872、dirty: true
- Node v24.1.0、Linux 7.0.0-29-generic x64
- Intel Core i7-13700K、24 logical CPU、総メモリー 67,167,006,720 bytes
- Chrome、Firefox、geckodriver 0.37.1 の呼び出しパス・実体パス・バージョン
- 実行引数、fresh DB と共有ブラウザー・プロファイルの条件
- ランナー SHA-256 4b31e6d4c43ccf1871cafe5b921fdf03898768d7a964060395cadd70a48122f3
- ブラウザー側ハーネス SHA-256 1ac018ab2dc6807222e4e2ded308a97f082059d22413900fd7020de3782d6693

| ブラウザー | 辞書 | 見出し数 | 解析 median (ms) | A serialize median (ms / bytes) | B serialize median (ms / bytes) |
| --- | --- | ---: | ---: | ---: | ---: |
| Chrome 152 | S | 3,379 | 19.275 | 0.440 / 224,661 | 0.445 / 224,690 |
| Chrome 152 | L | 175,786 | 345.720 | 23.880 / 12,301,978 | 23.080 / 12,302,007 |
| Firefox 155 | S | 3,379 | 7.520 | 0.740 / 224,661 | 0.520 / 224,690 |
| Firefox 155 | L | 175,786 | 439.360 | 35.240 / 12,301,978 | 35.000 / 12,302,007 |

各条件のシリアライズ順は反復0が A→B、反復1が B→A、反復2が A→B で、JSONの各反復にも保存されています。

| ブラウザー | 辞書 | A import median (ms) | B import median (ms) | A storage estimate (bytes) | B storage estimate (bytes) |
| --- | --- | ---: | ---: | ---: | ---: |
| Chrome 152 | S | 36.750 | 33.725 | 462,848 | 466,944 |
| Chrome 152 | L | 1,807.425 | 1,817.590 | 23,781,376 | 24,133,632 |
| Firefox 155 | S | 41.600 | 41.160 | 1,294,088 | 1,327,048 |
| Firefox 155 | L | 1,927.580 | 1,923.600 | 33,007,920 | 33,152,168 |

serialize bytes は保存レコードを JSON 化した比較用プロキシ、storage estimate は navigator.storage.estimate() の投入前後差分です。両者を IndexedDB ファイルサイズとはみなしません。

| ブラウザー | 辞書 | A exact median / p95 (ms) | B exact median / p95 (ms) | A prefix median / p95 (ms) | B prefix median / p95 (ms) |
| --- | --- | ---: | ---: | ---: | ---: |
| Chrome 152 | S | 0.035 / 0.065 | 0.040 / 0.045 | 0.085 / 0.180 | 0.080 / 0.210 |
| Chrome 152 | L | 0.035 / 0.040 | 0.040 / 0.065 | 0.115 / 0.145 | 0.135 / 0.225 |
| Firefox 155 | S | 0.040 / 0.060 | 0.040 / 0.080 | 0.060 / 0.080 | 0.060 / 0.100 |
| Firefox 155 | L | 0.040 / 0.080 | 0.040 / 0.100 | 0.060 / 0.120 | 0.080 / 0.200 |

warm 前方一致で JavaScript に返ったレコード数の median は、S で A/B とも6、L で A/B とも20でした。p95 は全条件で A が20、B が40です。B は各ストアへ limit を適用してからマージするため、同じ返却結果を作る途中で最大2倍のレコードを受け取ります。

| ブラウザー | 辞書 | exact B/A 各反復の範囲 | prefix B/A 各反復の範囲 | import B/A 各反復の範囲 | 判定 |
| --- | --- | ---: | ---: | ---: | --- |
| Chrome 152 | S | 1.143–1.333 | 0.842–1.250 | 0.833–1.125 | A |
| Chrome 152 | L | 1.143–1.143 | 1.174–1.174 | 0.994–1.008 | A |
| Firefox 155 | S | 1.000–2.000 | 1.000–1.000 | 0.987–1.160 | A |
| Firefox 155 | L | 1.000–2.000 | 1.000–1.500 | 0.998–1.030 | A |

Chrome S の prefix ではBが速い反復もありましたが、他の反復では逆転し、exact は全反復でBが遅くなりました。その他の条件もBの一貫した改善を示していません。個別値はタイマー分解能に近いため、絶対差ではなく同条件の反復比と p95 を合わせて判断します。

Chrome では measureUserAgentSpecificMemory() と performance.memory を取得できました。クエリ後の前者の median は S が A 1,388,612 bytes / B 1,364,273 bytes、L が A 32,159,247 bytes / B 32,143,822 bytes でした。GC 時点を固定していないページ全体の参考値で、レイアウトの優劣を示す差とは扱いません。Firefox では両 API が利用できず、メモリー値は記録されませんでした。

完全一致は B で両ストアを検索する必要があり、前方一致も B で2ストアからの取得とマージが必要です。B の投入・シリアライズ時間が一部で短い場合はあったものの、主要クエリはBの一貫した改善を示しませんでした。保守的な判定規則により、初期レイアウトには A の単一ストアを推奨します。production v4 の複合キー・generation・メタデータを加えた実装後に、同じストレージ指標とエンドツーエンド候補表示時間を再計測します。
