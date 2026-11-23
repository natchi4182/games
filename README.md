# games

スマホのブラウザで遊べるゲーム集です。ビルド不要の静的サイトなので、GitHub Pages でそのまま公開できます。

| ゲーム | フォルダ | 内容 |
| --- | --- | --- |
| ちびハンマーズ AR | [`chibi-hammers-ar/`](chibi-hammers-ar/) | 撮影した景色から荒地と廃墟を作り、ハンマーを持ったちびたちが整地していく AR3D ゲーム |
| 秘密結社 S.A.N.T.A. | [`santa-secret-society/`](santa-secret-society/) | 秘密結社の幹部としてクリスマス作戦を指揮。市場調査（神経衰弱）・資金調達（キャッチ）・プレゼント調達（3マッチ）・輸送護衛（ガンシューティング）・幹部撃退（格闘）・配達（煙突投下）の6ミッションの達成率で最終評価が決まる |

## 遊び方（GitHub Pages）

Settings → Pages で「Deploy from a branch」、Branch を `main` / `/ (root)` にすると
`https://<ユーザー名>.github.io/games/` でゲーム一覧が開きます。
カメラを使うゲームは HTTPS が必要なので、スマホで試すときは Pages の URL を使ってください。

## ローカルで動かす

```sh
python3 -m http.server 8000
# → http://localhost:8000/
```
