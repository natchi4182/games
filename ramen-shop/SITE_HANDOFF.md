# air-io.com（AirIo Creative の入口ページ）引き継ぎ書

2026-10-19、オーナーの指示により、air-io.com の管理を「らーめん開業日誌」のセッションから **AirIo Creative サイト管理** へ引き継ぐ。
以後、入口ページ・ドメイン・AdSense のサイト登録まわりはサイト管理の担当。らーめん開業日誌のセッションはゲームに専念する。

## 1. いまの構成

| アドレス | 中身 | 動いている場所 |
|---|---|---|
| `air-io.com` | AirIo Creative の入口ページ | fly.io アプリ **ramen-kaigyo** の nginx（ゲームと同居） |
| `www.air-io.com` | → `air-io.com` へ 301（ただし DNS・証明書は未設定なので今は開けない） | 同上 |
| `ramen.air-io.com` | らーめん開業日誌 | ramen-kaigyo |
| `ramen-kaigyo.fly.dev` | 旧アドレス。セーブを引き継いで ramen.air-io.com へ移す（move.html） | ramen-kaigyo |
| `mawaru.air-io.com` | MAWARU | fly.io アプリ **mawaru**（リポジトリ natchi4182/mawaru） |
| `mawaru.fly.dev` | → mawaru.air-io.com へ 301（環境変数 CANONICAL_HOST） | mawaru |
| `music.air-io.com` | AirIo Music Library | 音楽ライブラリ側の担当（このリポジトリの外） |

**注意：入口ページは、らーめん開業日誌と同じ fly.io アプリ・同じ nginx で配信している。** 入口ページを変えると ramen-kaigyo が再デプロイされる。いずれ入口ページを独立したアプリ（またはリポジトリ）に分けるかは、サイト管理の判断で。分けるときは下の「DNS」の `@` の行と、nginx の air-io.com の server ブロックを移す。

## 2. ファイル（リポジトリ natchi4182/games、ブランチ `claude/ramen-shop`、フォルダ `ramen-shop/`）

入口ページに関係するもの：
- `portal.html` … 入口ページ本体（`air-io.com/` で返す）
- `portal-icon.svg`・`portal-icon-512/192/180/32.png`・`portal.webmanifest` … 入口ページ専用アイコン（オーナー提供の水色の円の画像を SVG に描き直したもの。切れ込みは透明、180 だけ白地）
- `make_portal_icons.sh` … 画像1枚から portal-icon を書き出すスクリプト
- `mawaru-512.png` … 入口ページの MAWARU カード用アイコン
- `privacy.html`・`terms.html`・`legal.css` … らーめん開業日誌と入口ページのプライバシーポリシー・利用規約（air-io.com/privacy.html でも返す）。MAWARU は MAWARU 側の規約が適用されると明記
- `ads.txt` … `google.com, pub-3139313132637994, DIRECT, f08c47fec0942fa0`（全アドレスで返す）
- `nginx.conf`・`common.inc`・`headers.inc` … 3つのアドレスの振り分け（air-io.com の server ブロックが入口ページ）
- `Dockerfile` … 上のファイルを nginx の公開フォルダにコピー
- `DOMAIN.md` … air-io.com の取得と fly.io 接続の手順（実際にやった内容）

デプロイ：`claude/ramen-shop` に push すると GitHub Actions（`.github/workflows/ramen-shop-fly-deploy.yml`）が ramen-kaigyo を自動デプロイする（`ramen-shop/**` が変わったとき）。

## 3. ドメインと DNS

- `air-io.com` は **Cloudflare Registrar** で取得（オーナーの Cloudflare アカウント、Google ログイン）。自動更新オン。WHOIS は Cloudflare が伏せている
- DNS は Cloudflare。**すべて DNS only（灰色の雲）**。証明書は fly.io が発行（Let's Encrypt）

| Type | Name | 値 | 用途 |
|---|---|---|---|
| A | `@` | 66.241.125.15 | air-io.com → ramen-kaigyo |
| AAAA | `@` | 2a09:8280:1::1bd:1ee0:0 | 同上 |
| A | `ramen` | 66.241.125.15 | ramen-kaigyo |
| AAAA | `ramen` | 2a09:8280:1::1bd:1ee0:0 | 同上 |
| A | `mawaru` | 66.241.125.102 | mawaru |
| AAAA | `mawaru` | 2a09:8280:1::1b2:faac:0 | 同上 |

- fly.io の証明書：ramen-kaigyo に `air-io.com`・`ramen.air-io.com`、mawaru に `mawaru.air-io.com`（いずれも Issued）
- `music.air-io.com` の DNS は音楽ライブラリ側で設定（この表には含めていない）

## 4. AdSense

- パブリッシャーID：`ca-pub-3139313132637994`
- サイトとして登録したのは **air-io.com だけ**（サブドメインは登録しない。mawaru.fly.dev の登録は削除済み）
- 所有確認：`<meta name="google-adsense-account" content="ca-pub-3139313132637994">` を portal.html・らーめん開業日誌・privacy/terms に入れて確認済み
- **2026-10-18 に審査をリクエスト、結果待ち**。結果のメールはオーナーに届く
- 審査中は入口ページを開ける状態に保つ。審査では中身を見られるので、内容の薄いページや壊れたリンクを増やさない
- Web ゲーム向け広告（H5 Games Ads）の申し込みは未。ゲーム側の広告の組み込みは各ゲームのセッションが担当（らーめん：`ramen-shop/ADS.md`、MAWARU：環境変数 ADSENSE_CLIENT）

## 5. 入口ページの中身（2026-10-19 時点）

- タイトル「AirIo Creative｜ゲーム・音楽・小説・医療用アプリ」
- ゲーム：らーめん開業日誌（ramen.air-io.com）、MAWARU（mawaru.air-io.com、「18歳以上」表示）
- 音楽：AirIo Music Library（https://music.air-io.com、新アドレス）
- 医療用アプリ：医療系プロモーション担当の一覧どおり5本。小見出し「肩の病状・手術の説明」「スポーツ動作の説明」
  - ひとことは指定文のまま。効果をうたう言葉は足さない。価格は書かない。指定の注記1行あり（医療広告ガイドライン・薬機法・景品表示法への配慮）
  - アイコンは**仮の文字タイル**（作業環境から App Store に接続できなかったため）。正式アイコンは App Store の公開情報（`https://itunes.apple.com/lookup?id=アプリID&country=jp` の artworkUrl512）か、オーナーから画像をもらって差し替える
- 小説：「準備中」
- フッター：らーめん・MAWARU それぞれの利用規約とプライバシーポリシー、お問い合わせ（airio.creative@gmail.com）、Instagram（@_air_io_）

## 6. 引き継ぐ未完了・待ち

1. 医療用アプリの正式アイコンに差し替え
2. 「人工肩関節モデル」→「人工肩関節モデル3D」への改名と、ひとことの差し替え（医療系プロモーション担当から連絡が来る予定）
3. ほかの医療用アプリの追加（同上）
4. AdSense の審査結果への対応（通らなかった場合は理由を見て修正）
5. `www.air-io.com` を使うなら：Cloudflare に `www` の A/AAAA（@ と同じ値、DNS only）を足し、`fly certs add www.air-io.com -a ramen-kaigyo`
6. 入口ページの規約・ポリシー：今はらーめん開業日誌のものを兼ねている。音楽・医療用アプリ・小説も含めた AirIo Creative 全体の規約にするかはサイト管理の判断
7. 入口ページをゲームのアプリから分けるかどうか（上の「注意」）

## 7. らーめん開業日誌のセッションとの境界

- らーめん開業日誌のセッションは、`ramen-shop/` のうちゲームに関係するもの（index.html の元・bgm・ゲームの広告・move.html など）だけを触る
- 入口ページ関係のファイル（上の 2 の一覧のうち portal 系・mawaru-512.png・DOMAIN.md、nginx の air-io.com ブロック）はサイト管理が触る
- privacy.html・terms.html・ads.txt・nginx.conf・Dockerfile は両方に関係するので、変えるときは STATUS.md に一言残す
