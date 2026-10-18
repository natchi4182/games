# air-io.com を Cloudflare で取得して fly.io につなぐ手順

最終形：

| アドレス | 中身 | fly.io のアプリ |
|---|---|---|
| `air-io.com` | AirIo Creative の入口ページ（ゲーム一覧・規約・問い合わせ） | ramen-kaigyo（同じ nginx で配信） |
| `ramen.air-io.com` | らーめん開業日誌 | ramen-kaigyo |
| `mawaru.air-io.com` | MAWARU（オーナーの承認後） | MAWARU のアプリ |

DNS は Cloudflare、https の証明書は fly.io が発行する。Cloudflare のプロキシ（オレンジの雲）は使わず「DNS only」にする。

---

## 1. Cloudflare のアカウントを作る（5分）
1. https://dash.cloudflare.com/sign-up でメールアドレスとパスワードを登録
2. 届いた確認メールのリンクを押す
3. 右上の人のアイコン →「My Profile」→「Authentication」で **2段階認証（Two-Factor Authentication）をオンにする**。ドメインを乗っ取られないため。必須だと思ってよい

## 2. air-io.com を取得する（10分）
1. ダッシュボード左のメニュー「Domain Registration」→「Register Domains」
2. 検索欄に `air-io.com` と入れて検索 →「Purchase」
3. 登録年数は 1年でよい。**Auto-renew（自動更新）はオンのまま**
4. 連絡先（Registrant contact）を入力する。英語（ローマ字）で、実際の住所・氏名・電話番号を入れる
   - 住所は WHOIS で公開されない（Cloudflare が無料で伏せる）。嘘の情報を入れると、ドメインを止められることがある
   - 電話番号は `+81.9012345678` の形（先頭の 0 を取る）
5. 支払い方法（カードか PayPal）を登録して購入。.com は年 10ドル前後（原価で、更新料も同じ）

### 購入後すぐにやること（忘れると止まる）
- **連絡先の確認メール**が届く（ICANN のルール）。**15日以内にリンクを押す**。押さないとドメインが止められ、サイトが表示されなくなる
- 迷惑メールフォルダも確認する

購入すると、Cloudflare に `air-io.com` の DNS の設定画面（ゾーン）が自動でできる。

## 3. Cloudflare の SSL 設定（念のため）
DNS only で使うので本来は影響しないが、あとで誤ってプロキシをオンにしたときに無限リダイレクトにならないよう、先に設定しておく。
- `air-io.com` を開く → 左の「SSL/TLS」→「Overview」→ 暗号化モードを **Full (strict)** にする

## 4. fly.io で証明書を申し込む（Mac のターミナル）
どのフォルダで実行してもよい（`-a ramen-kaigyo` でアプリを指定しているため）。

```sh
fly ips list -a ramen-kaigyo
```
- `v6` の行（`2a09:` などで始まる）と `v4` の行（`shared` と書かれていることが多い）が出る
- **v6 の行が無いとき**だけ、次を実行してから、もう一度 `fly ips list` を見る
  ```sh
  fly ips allocate-v6 -a ramen-kaigyo
  ```

続けて、2つのアドレスの証明書を申し込む。

```sh
fly certs add air-io.com -a ramen-kaigyo
fly certs add ramen.air-io.com -a ramen-kaigyo
```
それぞれ、DNS に入れるべきレコードが表示される。**表示された値を正として**、次の 5 で Cloudflare に入れる。

## 5. Cloudflare に DNS レコードを入れる
`air-io.com` を開く → 左の「DNS」→「Records」→「Add record」。
**どのレコードも「Proxy status」のスイッチを切って、灰色の雲（DNS only）にする。** TTL は Auto のまま。

| Type | Name | Content（値） | Proxy |
|---|---|---|---|
| A | `@` | `fly ips list` の v4 のアドレス（または `fly certs add` が示した値） | DNS only |
| AAAA | `@` | `fly ips list` の v6 のアドレス | DNS only |
| CNAME | `ramen` | `ramen-kaigyo.fly.dev` | DNS only |
| CNAME | `_acme-challenge` | `fly certs add air-io.com` が示した値（`air-io.com.xxxx.flydns.net` のような形） | DNS only |
| CNAME | `_acme-challenge.ramen` | `fly certs add ramen.air-io.com` が示した値 | DNS only |

- Name の `@` は `air-io.com` そのものを意味する
- `_acme-challenge` の2行は、証明書の発行と自動更新のための確認用。`fly certs add` の表示に出なかったものは入れなくてよい
- `fly certs add` が `_fly-ownership` の TXT レコードを示した場合は、それも追加する
- Cloudflare が自動で入れたレコード（`air-io.com` の A など、中身が違うもの）が既にあれば、上の値に書き換えるか削除する

## 6. 証明書が出たか確かめる（数分〜30分）
```sh
fly certs show air-io.com -a ramen-kaigyo
fly certs show ramen.air-io.com -a ramen-kaigyo
```
- `Status` が **Ready**（または Issued）になれば完了
- 30分たっても Ready にならないとき：
  ```sh
  fly certs check air-io.com -a ramen-kaigyo
  ```
  の表示を Claude に貼る（鍵やパスワードは出ないので貼ってよい）。多くは「雲がオレンジのまま」か「値の打ち間違い」

ブラウザで `https://ramen.air-io.com` を開き、ゲームが出れば OK。

## 7. ここから先は Claude が対応する
証明書が Ready になったら知らせてもらえれば、次をまとめて行ってデプロイする。
1. `air-io.com` に AirIo Creative の入口ページ（ゲーム一覧・規約・問い合わせ）を出す
2. `ramen-kaigyo.fly.dev` で開いた人を `ramen.air-io.com` に移す
   - **注意**：ゲームのセーブはブラウザのアドレスごとに保存されるため、ただ転送するとこれまでのセーブが見えなくなる。そこで、fly.dev 側で一度セーブを読み取り、新しいアドレスへ引き継いでから移す仕組みを入れる
3. ADS.md・DEPLOY.md・プライバシーポリシーのアドレスを更新

## 8. そのあと（AdSense）
- AdSense の「サイト」に **`air-io.com`** を追加して審査を申し込む（サブドメインは個別に登録しない）
- 審査中に `air-io.com/ads.txt` を求められたら、表示された1行を Claude に伝える（公開しても問題ない情報）

## 任意：問い合わせ用のメールアドレス
Cloudflare の「Email」→「Email Routing」を使うと、`info@air-io.com` に届いたメールを今の Gmail に無料で転送できる。規約の問い合わせ先をドメインのアドレスにしたいときに使う（今の Gmail のままでも審査上の問題はない）。
