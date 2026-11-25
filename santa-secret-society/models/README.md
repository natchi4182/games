# リアルバトル（fight3d.html）用データ

| ファイル | 中身 |
|---|---|
| santa.glb | サンタのモデル（Tripo で生成・自動リグ。テクスチャを 1024px/JPEG に軽量化） |
| blackruf.glb | ブラックルフのモデル（同上） |
| motions.json | Mixamo のモーション 19 本から、主要な骨（20本）の回転と腰の位置を 30fps で取り出したもの |

motions.json の元データは `assets/santa-mixamo` ブランチの `santa-secret-society/mixamo/*.fbx`（FBX Binary・Without Skin・30fps）。
ページの読み込み時に、Mixamo の T ポーズと Tripo の A ポーズの差を補正しながら、各モデルの骨へ移し替えて再生する。

- サンタ：idle / walk / punch / kick / guard / hit / ko / win / jump / special_santa
- ブラックルフ：mutant_idle / mutant_walk / mutant_punch / mutant_swipe（キック）/ guard / hit / mutant_ko / mutant_win / jump / special_blackruf、開幕に mutant_roar
