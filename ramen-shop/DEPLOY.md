# らーめん開業日誌 — fly.io で公開する手順

このフォルダ（`ramen-shop/`）だけで公開できる。サーバーは静的ファイルを配る nginx のみ。
※ この環境では Docker を動かせなかったため、イメージのビルドはまだ確認していない。最初の `fly deploy` で失敗したら、そのログを共有してほしい。

## 1. 初回の公開（オーナーの PC で）
1. flyctl を入れる（https://fly.io/docs/flyctl/install/ ）
2. `fly auth login` で自分のアカウントにログイン
3. このフォルダで `fly launch --no-deploy`
   - 既存の `fly.toml` を使うか聞かれたら「使う」。アプリ名（`app = "ramen-kaigyo"`）は空いている名前に変える
   - リージョンは東京（nrt）
4. `fly deploy`
5. `https://<アプリ名>.fly.dev/` で遊べることを確認する

`auto_stop_machines` を有効にしてあるので、アクセスがない間はマシンが止まり、料金を抑えられる（最初のアクセスだけ数秒遅くなる）。

## 2. 独自ドメインをつなぐ（AdSense の審査に必要になる見込み）
AdSense は、自分が持っているドメインでないとサイトを登録できない可能性が高い（`*.fly.dev` は fly.io のドメイン）。
1. ドメインを取得する（例：`ramen-kaigyo.jp` など）
2. `fly certs add <ドメイン>` を実行し、表示された DNS レコードをドメインの管理画面に登録する
3. `fly certs show <ドメイン>` で証明書が発行されたことを確認する

## 3. AdSense をつなぐ
1. AdSense にサイト（独自ドメイン）を登録し、審査を申し込む
2. Web ゲーム向け広告（H5 Games Ads / Ad Placement API）の利用を申し込む（ベータの申し込みフォームがある）
3. 審査に通ったら：
   - `index.html` の `const ADS_CONFIG={client:'',test:true};` の `client` に自分のパブリッシャーID（`ca-pub-…`）を入れる
   - まず `test:true` のまま `fly deploy` し、テスト広告が出る場所を確認する
   - 問題なければ `test:false` にして `fly deploy`
   - `ads.txt.example` を参考に `ads.txt` を作って同じフォルダに置き、`fly deploy`
4. ~~`privacy.html` の運営者名・連絡先・公開日~~ → 記入済み（AirIo Creative）

## 4. 更新のしかた
ゲームを直したら `index.html` を差し替えて `fly deploy` するだけ。進み具合は各プレイヤーのブラウザに保存されているので、更新で消えることはない（旧バージョンのセーブも引き継げる）。
