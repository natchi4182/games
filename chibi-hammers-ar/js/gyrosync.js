// ジャイロと映像の時間合わせ
//
// カメラ映像はジャイロより少し遅れて届く。遅れは機種・明るさ・処理の重さで変わるので、
// 追跡がうまくいっているフレームで「映像から求めた 1 フレーム分の回転」と
// 「いろいろな遅れを仮定したジャイロの回転」を比べ、一番よく合う遅れを少しずつ採用する。
// 手ぶれの細かい揺れがよい手がかりになる。ついでにジャイロの回転と映像の回転の
// ずれの大きさも測る（診断表示用）。
import * as THREE from 'three';

const CANDS = [];
for (let l = -40; l <= 200; l += 10) CANDS.push(l);
const DECAY = 0.97;

const _a = new THREE.Quaternion(), _b = new THREE.Quaternion();
const angle = (q) => 2 * Math.acos(Math.min(1, Math.abs(q.w)));

export class GyroSync {
  constructor(lat = 0) {
    this.lat = lat;          // 映像の時刻からさらにこれだけ前のジャイロを使う（ms）
    this.sigma = null;       // ジャイロの 1 フレーム分の回転のずれ（ラジアン, 測れるまで null）
    this.n = 0;
    this.cost = new Float64Array(CANDS.length);
    this._prev = null;
  }

  static get range() { return [CANDS[0], CANDS[CANDS.length - 1]]; }

  reset() { this._prev = null; }

  /**
   * @param t      映像フレームの時刻（ms）
   * @param gyroAt 時刻 → ジャイロの向き（Quaternion）
   * @param q      このフレームで映像から求めたカメラの向き
   * @param good   このフレームの追跡がしっかりしているか
   * @returns 遅れの推定を更新したら true
   */
  learn(t, gyroAt, q, good) {
    const prev = this._prev;
    const gs = good ? CANDS.map((l) => gyroAt(t - l)) : null;
    this._prev = good ? { gs, q: q.clone() } : null;
    if (!prev || !good) return false;
    const dv = _a.copy(prev.q).invert().multiply(q);
    if (angle(dv) < 1e-4) return false;    // ほとんど動いていないと手がかりにならない
    for (let k = 0; k < CANDS.length; k++) {
      _b.copy(prev.gs[k]).invert().multiply(gs[k]).invert().multiply(dv);
      const e = angle(_b);
      this.cost[k] = this.cost[k] * DECAY + e * e;
    }
    this.n++;
    if (this.n < 20) return false;
    let b = 0, worst = 0;
    for (let k = 1; k < CANDS.length; k++) {
      if (this.cost[k] < this.cost[b]) b = k;
      if (this.cost[k] > this.cost[worst]) worst = k;
    }
    // 山がはっきりしない（映像の回転があてにならない）ときは動かさない
    if (this.cost[b] > this.cost[worst] * 0.6) return false;
    // 放物線で候補の間を補間
    let best = CANDS[b];
    if (b > 0 && b < CANDS.length - 1) {
      const c0 = this.cost[b - 1], c1 = this.cost[b], c2 = this.cost[b + 1];
      const den = c0 - 2 * c1 + c2;
      if (den > 1e-12) best += (CANDS[1] - CANDS[0]) * Math.max(-0.5, Math.min(0.5, 0.5 * (c0 - c2) / den));
    }
    this.lat += (best - this.lat) * 0.1;
    const w = (1 - Math.pow(DECAY, this.n)) / (1 - DECAY);
    this.sigma = Math.sqrt(this.cost[b] / w);
    return true;
  }
}
