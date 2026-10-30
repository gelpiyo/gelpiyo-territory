# ゲルぴよ陣取りゲーム

同じ行・列に駒を2個ずつ置いて相手の駒を挟んで取り、3×3の四隅を押さえて陣地を広げる対戦ボードゲームです。
ビルド不要の静的サイトで、スマートフォンとPCの両方で動きます。

- **シンプル / イベント** … 2D盤（9×9〜）
- **エキストラ** … Three.js による 9×9×9 の3D盤。挟む向きにZ軸が加わり、陣地が2段階になります

---

## 起動方法

### 2Dだけ遊ぶ場合

`index.html` をブラウザで開くだけです。

```bash
start "" "index.html"
```

### エキストラ（3D）も遊ぶ場合

3D表示は ES モジュールを使うため、`file://` では読み込めません。ローカルサーバー経由で開いてください。

```bash
python -m http.server 8000
```

ブラウザで `http://localhost:8000/` を開きます。Three.js はリポジトリ内の `three/` を参照するので、インターネット接続は不要です。

---

## 画面の流れ

```
タイトル ──[はじめる]──▶ 操作説明 ──[設定へ進む]──▶ 設定 ──[ゲーム開始]──▶ 対局
   └────────[操作説明をとばして設定へ]────────────────▶
```

- 操作説明の「タイトルに戻る」、設定の「操作説明を見る」でいつでも行き来できます
- 対局中に「設定」を押した場合だけ「対局に戻る」が出るので、変更せず盤面へ戻れます

---

## 設定項目

| 項目 | 選択肢 |
|---|---|
| あなたの手番 | 先攻 / 後攻 |
| 対戦相手 | 人間と対戦 / AIと対戦 |
| AIの強さ | 弱い / 普通 / 強い |
| 盤面サイズ | シンプル（9×9 / 11×11 / 13×13）/ イベント（マップ選択）/ エキストラ |
| 候補ガイド | ON / OFF |

右上のボタンでライト／ダークテーマを切り替えられます。初回はOSの設定に追従し、選択内容は `localStorage`（キー `gelpiyo-theme`）に保存されます。

---

## ルール

### 共通（シンプル・イベント）

- 1手で、同じ行または列に駒を **2個** 置きます
- 2個は1マス空けて置き、**間に挟まれた相手の駒が消えます**。挟めない置き方は選べません
- 相手の駒が「相手 / 空白 / 相手」と並んでいる空白には置けません
- 3×3の四隅を自分の色でそろえると **陣（平面陣）** が成立し、その3×3内の相手の駒と灰色の駒が消えます
- 相手の陣の中には、新しく駒を置けません
- 置ける手がない側は自動パス。両者が続けてパスすると対局終了です
- **勝敗＝ 駒の数 ＋ 陣の数 × 3**

灰色の駒は中立で、挟んでも消えません（陣の中に入ると消えます）。

### エキストラ（3D）の追加ルール

9×9×9 の立体盤で、上記に加えて次が変わります。

- 挟む向きが X・Y に加えて **Z（奥行き）** にも増えます
- 陣地が **2段階** になります
  - **平面陣** … 軸に沿った 3×3 の四隅（XY / XZ / YZ の3向き）
  - **立方陣** … 3×3×3 の **八隅**
- **平面陣の中の駒は、その平面の法線方向からは挟めません（XY面ならZ方向）**
- **立方陣の八隅は、X・Y・Zどの方向からも挟めなくなります**
- **平面陣が成立**したとき、四隅以外の5マスにある相手の駒は消えますが、**相手の平面陣を形成している駒（成立中の平面陣の四隅）は残ります**
- **立方陣が成立**したとき、27マス内の相手の駒を **平面陣を形成している駒も含めて** 消します。さらに、その立方体に重なっている相手の平面陣を解体し、**立方体の外にはみ出した分の駒までまとめて消します**
- **勝敗＝ 駒の数 ＋ 平面陣 × 3 ＋ 立方陣 × 9**

2Dと3Dはエンジンが完全に別ファイルで、互いに影響しません。

---

## 操作

### 2D盤

マスをタップします。**緑の点** が1個目を置ける場所、タップすると **橙の点** で2個目の候補が出ます。同じマスをもう一度タップすると選択が外れます。

### 3D盤（エキストラ）

| 操作 | 動作 |
|---|---|
| マスを直接タップ | そのマスへカーソルを移動して決定 |
| 左下の軸の矢印・球をタップ | X（赤）・Y（緑）・Z（青）方向にカーソルを1マス移動 |
| 左下中央の白い点をタップ | 現在のカーソル位置で決定 |
| ドラッグ | 視点を回転 |

カーソル位置は盤面の左上に常時表示されます。

---

## ファイル構成

| ファイル | 役割 |
|---|---|
| `index.html` | 画面構造（対局画面・タイトル・操作説明・設定・結果） |
| `style.css` | 全体のスタイル。ライト／ダークのテーマ変数、盤面が画面内に収まるレイアウト |
| `script.js` | 2Dのゲームエンジンと、画面遷移・UI更新・3Dモードの進行管理 |
| `map.js` | イベントマップのデータと背景画像の指定 |
| `extra-rules.js` | エキストラ（3D）のルールエンジン。外部依存なし |
| `extra3d.js` | エキストラの3D描画（Three.js）。ESモジュール |
| `gelpyto-model.js` | 3D駒のモデルデータ（量子化して埋め込み済み・27KB） |
| `three/` | Three.js r185.1 本体と TrackballControls |
| `tools/build-gelpyto-model.mjs` | 3Dモデルの再生成スクリプト |
| `images/` | 駒の画像と盤面の背景画像 |

---

## カスタマイズ

### イベントマップを追加する

`map.js` の `window.EVENT_MAPS` 配列にオブジェクトを1つ足すだけで、設定画面のプルダウンに自動的に増えます。`index.html` を編集する必要はありません。

```js
Object.freeze({
  "name": "公園③",                  // プルダウンに表示される名前
  "background": "images/park_3.png", // 省略すると背景なし（白い盤面）
  "cells": [
    [ "W", "W", "W", ... ],
    ...
  ]
})
```

`cells` で使える記号は **W**＝空きマス、**X**＝設置禁止マス、**R**＝先攻の駒、**B**＝後攻の駒、**G**＝中立の灰色駒です。行の長さはすべて同じにしてください。

新しいマップを作ったら、開始時に両者へ合法手があるか（いきなり終了しないか）を確認してください。

### 「シンプル」の背景画像を変える

`map.js` の先頭にある `window.SIMPLE_BOARD_BACKGROUND` を書き換えます。`''` にすると背景なしの白い盤面になります。

背景画像を敷いたマスは半透明（20%の白）になり、画像が透けて見えます。濃さは `style.css` の `.board.has-background .cell` の値で調整できます。

### 3D盤の見た目を調整する

`extra3d.js` の先頭にまとめてあります。

```js
const PLANE_OPACITY = 0.25;   // 平面陣の濃さ
const CUBE_OPACITY  = 0.50;   // 立方陣の濃さ（発光あり）
```

### 3Dモデルを差し替える

`tools/build-gelpyto-model.mjs` の先頭に、GLTF から `gelpyto-model.js` を生成する手順（gltf-transform による簡略化 → 量子化）が書いてあります。`--ratio` / `--error` で三角形数を調整できます。

現在は元データ 19,966三角形・877KB を **1,447三角形・27.4KB** まで削減し、GLTFLoader を使わずに読み込めるようにしています。駒は `InstancedMesh` で描画するため、盤上の駒が何個あっても描画命令は12回で固定です。

---

## 既知の注意点

- **3D表示は `file://` では動きません。** ES モジュールが読み込めないためです。2Dはそのままダブルクリックで動きます
- 2Dは合法手が平均2.4手前後と少なめです。これは意図した仕様で、ルールは変更していません

---

## iPhone アプリ版（Godot）

同じゲームを Godot 4.7（GDScript）で作り直したものです。Web版のファイルはそのまま残してあり、両方を並行して使えます。Godot プロジェクトは `godot/project.godot` で、Godot 用のファイルはすべて `godot/` にまとめてあります。Godot で開くときは `godot/` フォルダを開いてください。

画像の実体は Web版と同じ作業フォルダ直下の `images/` だけです。Godot はプロジェクトのフォルダの外を読めないため、`godot/images` に `../images` へのリンク（シンボリックリンク）を置いています。画像を差し替えるときは `images/` だけを更新すれば、Web版と Godot版の両方に反映されます。

### ファイル構成（Godot 版）

| ファイル | 役割 |
|---|---|
| `godot/main.tscn` / `godot/main.gd` | 画面全体（タイトル・操作説明・設定・対局・結果）と対局の進行 |
| `godot/rules/rules_2d.gd` | シンプル / イベントのルールとAI（`script.js` の 2D エンジンを移植） |
| `godot/rules/rules_3d.gd` | エキストラのルールとAI（`extra-rules.js` を移植） |
| `godot/game/` | 対局の進行（`match_2d.gd` / `match_3d.gd`）、マップ読み込み、中断データの保存 |
| `godot/ui/` | 2D盤・3D盤の表示、配色（`style.css` の色）、3D駒のメッシュ |
| `godot/data/` | `map.js` と `gelpyto-model.js` から書き出した JSON |
| `godot/tests/` | Web版とのルール照合テスト（`rules_check.gd`）、説明画面などのフリックスクロールの確認（`flick_scroll_check.gd`、ウィンドウを開いて実行） |
| `godot/images` | 作業フォルダ直下の `images/` へのリンク（実体は Web版と共用） |
| `godot/project.godot` / `godot/export_presets.cfg` | Godot のプロジェクト設定 / iOS の書き出し設定 |
| `godot/addons/godot_ai/` | エディタを Claude から操作するための godot-ai プラグイン（アプリの書き出し時には取り除かれます） |
| `godot/tools/make_app_icon.gd` | アプリのアイコンを駒の画像から作るスクリプト |

### ルールが Web版と同じであることの確認

ルールとAIは、判定の順序や手の並び順まで Web版と同じにしてあります。Web版のルールで作った照合データ（約720局面）を Godot版に解かせて、合法手・消える駒・陣・次の盤面・AIの選ぶ手がすべて一致するかを確かめます。ルールに手を入れたら、両方を実行してください。

```
node tools/make-rule-fixtures.cjs
godot --headless --path godot --script res://tests/rules_check.gd
```

最後に `照合: 44446 項目 / 不一致 0 件` のように表示されれば一致しています。

「強い」AIの先読みには αβ枝刈り（結果に影響しない枝の計算を省く方法）を使っています。選ぶ手は Web版と同じです。AIは別スレッドで計算するため、考えている間も画面は止まりません。

### マップやモデルを更新したとき

イベントマップは Web版と同じく `map.js` に書きます。書き換えたら、次のコマンドで Godot 用の JSON を作り直してください。

```
node tools/export-godot-data.cjs
```

### Web版との違い

- スマートフォンの縦画面に合わせて並べ直しました。「対戦設定の詳細」と「ルール」はボタンで開く画面です
- 3D盤は、1本指のドラッグで回転、ピンチで拡大縮小、2本指のドラッグで平行移動します（PC ではホイールで拡大縮小、右ドラッグで平行移動）
- テーマ（ライト / ダーク）と中断データは端末内（`user://`）に保存します

### iPhone アプリへの書き出し（Mac が必要）

iOS 用のビルドは Mac と Xcode でしか作れません。

1. Mac に Godot 4.7.2 と Xcode を入れ、Godot のエディタで「エディタ → エクスポートテンプレートを管理」からテンプレートを入れます
2. `godot/` フォルダ（`godot/project.godot`）を Godot で開き、「プロジェクト → エクスポート」で **iOS** を選びます
3. **App Store Team ID** に Apple Developer Program のチームIDを入れます。Bundle Identifier は仮に `jp.co.taica.gelpiyo-territory` にしてあります
4. 「プロジェクトをエクスポート」で Xcode プロジェクトを書き出します（`export_project_only` が有効なので、Xcode プロジェクトだけが作られます）
5. 書き出した `.xcodeproj` を Xcode で開き、署名を確認して「Product → Archive」→「Distribute App」で TestFlight にアップロードします

アプリのアイコン（`godot/icon_1024.png`）は `godot/tools/make_app_icon.gd` で駒の画像から作っています（`godot --headless --path godot --script res://tools/make_app_icon.gd`）。

**リンクについての注意:** `godot/images` は git にシンボリックリンクとして記録されます。Mac ではそのまま使えます。Windows で取り出す（clone する）場合は、開発者モードを有効にし、`git config core.symlinks true` を設定してください。設定がないとリンクがただのテキストファイルになり、Godot から画像を読めなくなります。

---

## Third-Party Licenses

This software includes third-party software as follows:

### Three.js
The MIT License (MIT)
Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

