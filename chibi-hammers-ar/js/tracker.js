// 床トラッカー（iPhone Safari など WebXR が無い端末用の 6DoF 追跡）
//
// しくみ:
//   1. 置いた瞬間に、床（y=0 の平面）に見えている模様の点（コーナー）を検出し、
//      ジャイロの向き＋仮のカメラ高さから、それぞれの点の床上の 3D 位置を決める
//   2. 毎フレーム、その点を画像上で追いかける（ピラミッド Lucas-Kanade オプティカルフロー）
//   3. 「3D の床の点」と「今の画像上の位置」の対応から、カメラの位置と向きを最小二乗で求める
//      （ガウス・ニュートン法＋外れ値に強い Huber 重み。ジャイロの回転を予測と弱い拘束に使う）
//   4. 点が減ったら、今のカメラ姿勢を使って新しい点を床に追加する
//
// カメラ高さは仮定値なので、世界全体の大きさ（スケール）は実際と違うことがあるが、
// 床に乗っている物の見え方はスケールによらず一致する。
import * as THREE from 'three';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();

export class FloorTracker {
  static get available() { return typeof window !== 'undefined' && !!window.jsfeat; }

  constructor({ longSide = 640, maxPoints = 160, levels = 5, win = 17 } = {}) {
    this.longSide = longSide;
    this.maxPoints = maxPoints;
    this.levels = levels;
    this.win = win;
    this.q = new THREE.Quaternion();     // カメラの向き（ワールド ← カメラ）
    this.C = new THREE.Vector3();        // カメラの位置
    this.state = 'idle';                 // idle / tracking / lost
    this.inliers = 0;
    this.count = 0;
    this.frames = 0;
    this.vel = new THREE.Vector3();      // 1 フレームあたりの移動（等速予測用）
    this._mid = [];
  }

  /** 映像サイズと画角（長辺方向, 度）に合わせて内部バッファを用意 */
  setup(vw, vh, longFovDeg) {
    const jsf = window.jsfeat;
    const k = this.longSide / Math.max(vw, vh);
    const W = Math.round(vw * k), H = Math.round(vh * k);
    if (W !== this.W || H !== this.H) {
      this.W = W; this.H = H;
      this.canvas = document.createElement('canvas');
      this.canvas.width = W; this.canvas.height = H;
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
      this.prevPyr = new jsf.pyramid_t(this.levels);
      this.currPyr = new jsf.pyramid_t(this.levels);
      this.prevPyr.allocate(W, H, jsf.U8_t | jsf.C1_t);
      this.currPyr.allocate(W, H, jsf.U8_t | jsf.C1_t);
      const n = this.maxPoints;
      this.prevXY = new Float32Array(n * 2);
      this.currXY = new Float32Array(n * 2);
      this.world = new Float32Array(n * 3);
      this.status = new Uint8Array(n);
      this.bad = new Uint8Array(n);
      this.err = new Float32Array(n);
      this.skip = new Uint8Array(n);
      this.corners = [];
      for (let i = 0; i < W * H / 8; i++) this.corners.push(new jsf.keypoint_t(0, 0, 0, 0));
    }
    this.fx = this.fy = (Math.max(W, H) / 2) / Math.tan(THREE.MathUtils.degToRad(longFovDeg) / 2);
    this.cx = W / 2; this.cy = H / 2;
  }

  _grab(src) {
    // 一度に大きく縮小すると細かい模様（カーペットなど）がちらつく（エイリアシング）ので、
    // 半分ずつ縮小して平均をとる
    const sw = src.videoWidth || src.width, sh = src.videoHeight || src.height;
    let cur = src, cw = sw, ch = sh, k = 0;
    while (cw > this.W * 2 + 1) {
      const nw = Math.max(this.W, Math.round(cw / 2)), nh = Math.max(this.H, Math.round(ch / 2));
      const mid = this._mid[k] || (this._mid[k] = document.createElement('canvas'));
      if (mid.width !== nw || mid.height !== nh) { mid.width = nw; mid.height = nh; }
      mid.getContext('2d').drawImage(cur, 0, 0, nw, nh);
      cur = mid; cw = nw; ch = nh; k++;
    }
    this.ctx.drawImage(cur, 0, 0, this.W, this.H);
    const img = this.ctx.getImageData(0, 0, this.W, this.H);
    window.jsfeat.imgproc.grayscale(img.data, this.W, this.H, this.currPyr.data[0]);
    this.currPyr.build(this.currPyr.data[0], true);
  }

  /** 置いた瞬間：カメラ姿勢を決めて床の点を集める。集まった点の数を返す */
  start(src, q, C) {
    this.q.copy(q); this.C.copy(C);
    this.count = 0;
    this._grab(src);
    this._detect(this.maxPoints);
    this.state = this.count >= 12 ? 'tracking' : 'lost';
    this.inliers = this.count;
    this.frames = 0;
    this.vel.set(0, 0, 0);
    return this.count;
  }

  /**
   * 新しいフレームを処理して姿勢を更新する
   * @param src     video / canvas
   * @param dq      前フレームからのジャイロの回転（カメラローカル）。無ければ null
   * @param qAbs    ジャイロの絶対姿勢（重力方向の手がかり）。無ければ null
   */
  update(src, dq, qAbs) {
    if (this.state === 'idle') return;
    this.frames++;
    // ピラミッドを入れ替えて新しい画像を取り込む
    const t = this.prevPyr; this.prevPyr = this.currPyr; this.currPyr = t;
    this.prevXY.set(this.currXY);
    this._grab(src);

    // 予測：回転はジャイロ、位置は直前の速度で進める
    const qPred = _q2.copy(this.q);
    if (dq) qPred.multiply(dq);
    this.q.copy(qPred);
    const Cprev = _v2.copy(this.C);
    this.C.add(this.vel);

    const n = this.count;
    if (n > 0) {
      // 予測した姿勢で各点の行き先を計算し、そこから探す（速く振っても見失いにくい）
      this._predictPoints();
      self.__lkUseGuess = true;
      window.jsfeat.optical_flow_lk.track(this.prevPyr, this.currPyr, this.prevXY, this.currXY, n, this.win, 30, this.status, 0.01, 0.0005);
      self.__lkUseGuess = false;
      this._compact();
    }

    let good = false;
    this.medErr = 0;
    if (this.count < 6) {
      // 点がほとんど残っていない：前のフレームの数字を使い回さず、見失った扱いにする
      this.inliers = 0;
    } else {
      this.skip.fill(0);
      this._solve(qPred, qAbs);
      // 2 段階目：明らかに外れた点を除いて解き直す（外れ点に引っぱられないように）
      const med = this._medianErr();
      let ex = 0;
      const thr = Math.max(3, med * 3);
      for (let i = 0; i < this.count; i++) if (this.err[i] > thr) { this.skip[i] = 1; ex++; }
      if (ex > 0 && this.count - ex >= 6) this._solve(qPred, qAbs);
      this._rejectOutliers();
      this.medErr = this._medianErr();
      good = this.inliers >= 10 && this.inliers >= this.count * 0.6 && this.medErr < 2.5;
    }
    this.state = this.inliers >= 10 ? 'tracking' : 'lost';
    if (this.state === 'lost') { this.q.copy(qPred); this.C.copy(Cprev); this.vel.set(0, 0, 0); }
    else this.vel.subVectors(this.C, Cprev).multiplyScalar(0.7);

    // 点が減ってきたら補充（推定がしっかりしているフレームだけ。ずれた姿勢で足すとずれが残るため）
    // 点がかなり減ったときや見失ったときは、条件がそろわなくても探し直す（でないと二度と立ち直れない）
    const starving = this.count < this.maxPoints * 0.3;
    if (this.count < this.maxPoints * 0.6 && (good || ((starving || this.state === 'lost') && this.frames % 3 === 0))) {
      this._detect(this.maxPoints - this.count);
    }
  }

  _predictPoints() {
    _m.makeRotationFromQuaternion(this.q);
    const e = _m.elements;
    const fx = this.fx, fy = this.fy, cx = this.cx, cy = this.cy, W = this.W, H = this.H;
    for (let i = 0; i < this.count; i++) {
      const dx = this.world[i * 3] - this.C.x, dy = this.world[i * 3 + 1] - this.C.y, dz = this.world[i * 3 + 2] - this.C.z;
      const X = e[0] * dx + e[1] * dy + e[2] * dz;
      const Y = e[4] * dx + e[5] * dy + e[6] * dz;
      const Z = e[8] * dx + e[9] * dy + e[10] * dz;
      let u = this.prevXY[i * 2], v = this.prevXY[i * 2 + 1];
      if (-Z > 1e-3) {
        const pu = cx + fx * X / -Z, pv = cy - fy * Y / -Z;
        if (pu > 0 && pv > 0 && pu < W && pv < H) { u = pu; v = pv; }
      }
      this.currXY[i * 2] = u; this.currXY[i * 2 + 1] = v;
    }
  }

  // 追跡に失敗した点を詰める
  _compact() {
    let j = 0;
    const W = this.W, H = this.H;
    for (let i = 0; i < this.count; i++) {
      const x = this.currXY[i * 2], y = this.currXY[i * 2 + 1];
      if (this.status[i] !== 1 || x < 2 || y < 2 || x > W - 3 || y > H - 3) continue;
      if (i !== j) this._move(i, j);
      j++;
    }
    this.count = j;
  }

  _move(i, j) {
    this.currXY[j * 2] = this.currXY[i * 2]; this.currXY[j * 2 + 1] = this.currXY[i * 2 + 1];
    this.prevXY[j * 2] = this.prevXY[i * 2]; this.prevXY[j * 2 + 1] = this.prevXY[i * 2 + 1];
    this.world[j * 3] = this.world[i * 3]; this.world[j * 3 + 1] = this.world[i * 3 + 1]; this.world[j * 3 + 2] = this.world[i * 3 + 2];
    this.bad[j] = this.bad[i];
    this.err[j] = this.err[i];
  }

  /** 画像上の点 → 床（y=0）上の 3D 点。床に当たらなければ null */
  rayToFloor(u, v, out = new THREE.Vector3()) {
    _v.set((u - this.cx) / this.fx, -(v - this.cy) / this.fy, -1).applyQuaternion(this.q);
    if (_v.y > -0.12 * _v.length()) return null;          // 地平線付近はあてにならない
    const t = -this.C.y / _v.y;
    if (t <= 0 || t * _v.length() > Math.max(1, this.C.y) * 7) return null;
    return out.copy(this.C).addScaledVector(_v, t);
  }

  // FAST コーナーを検出して、空いているマスにだけ追加（画面全体にばらけさせる）
  _detect(want) {
    if (want <= 0) return;
    const jsf = window.jsfeat, W = this.W, H = this.H, img = this.currPyr.data[0];
    const cell = 16, gw = Math.ceil(W / cell), gh = Math.ceil(H / cell);
    const occ = new Uint8Array(gw * gh);
    for (let i = 0; i < this.count; i++) {
      const gx = (this.currXY[i * 2] / cell) | 0, gy = (this.currXY[i * 2 + 1] / cell) | 0;
      if (gx >= 0 && gy >= 0 && gx < gw && gy < gh) occ[gy * gw + gx] = 1;
    }
    let found = 0, thr = 24;
    for (let tries = 0; tries < 4; tries++) {
      jsf.fast_corners.set_threshold(thr);
      found = jsf.fast_corners.detect(img, this.corners, 8);
      if (found > want * 2 || thr <= 5) break;
      thr = Math.max(5, thr >> 1);
    }
    const list = this.corners.slice(0, found).sort((a, b) => b.score - a.score);
    const p = new THREE.Vector3();
    for (const c of list) {
      if (want <= 0 || this.count >= this.maxPoints) break;
      const gi = ((c.y / cell) | 0) * gw + ((c.x / cell) | 0);
      if (occ[gi]) continue;
      if (!this.rayToFloor(c.x, c.y, p)) continue;
      occ[gi] = 1;
      const k = this.count++;
      this.currXY[k * 2] = c.x; this.currXY[k * 2 + 1] = c.y;
      this.prevXY[k * 2] = c.x; this.prevXY[k * 2 + 1] = c.y;
      this.world[k * 3] = p.x; this.world[k * 3 + 1] = 0; this.world[k * 3 + 2] = p.z;
      this.bad[k] = 0;
      want--;
    }
  }

  // ガウス・ニュートン法でカメラ姿勢を求める（6 自由度：回転 3 + 位置 3）
  _solve(qPred, qAbs) {
    const fx = this.fx, fy = this.fy, cx = this.cx, cy = this.cy;
    const Hm = new Float64Array(36), g = new Float64Array(6), J = new Float64Array(12);
    const delta = new Float64Array(6);
    const huber = 2.5;
    for (let it = 0; it < 6; it++) {
      Hm.fill(0); g.fill(0);
      _m.makeRotationFromQuaternion(this.q);
      const e = _m.elements; // 列優先。R の列 = カメラ軸（ワールド）
      // Rt の行 = R の列
      const r00 = e[0], r01 = e[1], r02 = e[2];      // カメラ x 軸
      const r10 = e[4], r11 = e[5], r12 = e[6];      // カメラ y 軸
      const r20 = e[8], r21 = e[9], r22 = e[10];     // カメラ z 軸
      const Cx = this.C.x, Cy = this.C.y, Cz = this.C.z;
      let used = 0;
      for (let i = 0; i < this.count; i++) {
        if (this.bad[i] > 2 || this.skip[i]) continue;
        const dx = this.world[i * 3] - Cx, dy = this.world[i * 3 + 1] - Cy, dz = this.world[i * 3 + 2] - Cz;
        const X = r00 * dx + r01 * dy + r02 * dz;
        const Y = r10 * dx + r11 * dy + r12 * dz;
        const Z = r20 * dx + r21 * dy + r22 * dz;
        const zp = -Z;
        if (zp < 1e-3) continue;
        const iz = 1 / zp;
        const ru = cx + fx * X * iz - this.currXY[i * 2];
        const rv = cy - fy * Y * iz - this.currXY[i * 2 + 1];
        const rn = Math.sqrt(ru * ru + rv * rv);
        const w = rn <= huber ? 1 : huber / rn;
        // d(u,v)/dXc
        const a0 = fx * iz, a2 = fx * X * iz * iz;
        const b1 = -fy * iz, b2 = -fy * Y * iz * iz;
        // dXc/dθ = [Xc]x = [[0,-Z,Y],[Z,0,-X],[-Y,X,0]]
        // du/dθ = a0*row0 + a2*row2
        J[0] = a2 * -Y; J[1] = a0 * -Z + a2 * X; J[2] = a0 * Y;
        // du/dC = -(a0 * Rt row0 + a2 * Rt row2)
        J[3] = -(a0 * r00 + a2 * r20); J[4] = -(a0 * r01 + a2 * r21); J[5] = -(a0 * r02 + a2 * r22);
        // dv/dθ = b1*row1 + b2*row2
        J[6] = b1 * Z + b2 * -Y; J[7] = b2 * X; J[8] = b1 * -X;
        J[9] = -(b1 * r10 + b2 * r20); J[10] = -(b1 * r11 + b2 * r21); J[11] = -(b1 * r12 + b2 * r22);
        for (let r = 0; r < 6; r++) {
          const ju = J[r], jv = J[6 + r];
          g[r] += w * (ju * ru + jv * rv);
          for (let c = r; c < 6; c++) Hm[r * 6 + c] += w * (ju * J[c] + jv * J[6 + c]);
        }
        used++;
      }
      if (used < 6) break;
      // ジャイロからの予測回転（弱い拘束）と、重力方向（絶対姿勢の傾き）
      const wPred = 1.5 * fx * fx, wAbs = 0.4 * fx * fx;
      this._addRotPrior(Hm, g, qPred, wPred);
      if (qAbs) this._addRotPrior(Hm, g, this._tiltOnly(qAbs), wAbs);
      for (let r = 0; r < 6; r++) {
        for (let c = 0; c < r; c++) Hm[r * 6 + c] = Hm[c * 6 + r];
        Hm[r * 6 + r] *= 1.0001; Hm[r * 6 + r] += 1e-6;
      }
      if (!solve6(Hm, g, delta)) break;
      // q ← q · exp(-δθ), C ← C - δc
      const ax = -delta[0], ay = -delta[1], az = -delta[2];
      const ang = Math.sqrt(ax * ax + ay * ay + az * az);
      if (ang > 1e-9) { _q.setFromAxisAngle(_v.set(ax / ang, ay / ang, az / ang), ang); this.q.multiply(_q).normalize(); }
      this.C.x -= delta[3]; this.C.y -= delta[4]; this.C.z -= delta[5];
      if (ang < 1e-5 && Math.abs(delta[3]) + Math.abs(delta[4]) + Math.abs(delta[5]) < 1e-5 * Math.max(1, this.C.y)) break;
    }
    this._computeErr();
  }

  // 今の姿勢での各点の再投影誤差（px）
  _computeErr() {
    _m.makeRotationFromQuaternion(this.q);
    const e = _m.elements;
    for (let i = 0; i < this.count; i++) {
      const dx = this.world[i * 3] - this.C.x, dy = this.world[i * 3 + 1] - this.C.y, dz = this.world[i * 3 + 2] - this.C.z;
      const X = e[0] * dx + e[1] * dy + e[2] * dz;
      const Y = e[4] * dx + e[5] * dy + e[6] * dz;
      const Z = e[8] * dx + e[9] * dy + e[10] * dz;
      if (-Z < 1e-3) { this.err[i] = 1e3; continue; }
      const u = this.cx + this.fx * X / -Z, v = this.cy - this.fy * Y / -Z;
      this.err[i] = Math.hypot(u - this.currXY[i * 2], v - this.currXY[i * 2 + 1]);
    }
  }

  _medianErr() {
    if (!this.count) return 0;
    const a = Array.from(this.err.subarray(0, this.count)).sort((x, y) => x - y);
    return a[a.length >> 1];
  }

  // 回転の拘束 r = log(qp⁻¹ q)（カメラローカル）。q·exp(δ) に対して dr/dδ ≈ I
  _addRotPrior(Hm, g, qp, w) {
    _q.copy(qp).invert().multiply(this.q);
    if (_q.w < 0) { _q.x = -_q.x; _q.y = -_q.y; _q.z = -_q.z; _q.w = -_q.w; }
    const s = Math.sqrt(_q.x * _q.x + _q.y * _q.y + _q.z * _q.z);
    const ang = 2 * Math.atan2(s, _q.w);
    const k = s > 1e-9 ? ang / s : 2;
    const r = [_q.x * k, _q.y * k, _q.z * k];
    for (let i = 0; i < 3; i++) { Hm[i * 6 + i] += w; g[i] += w * r[i]; }
  }

  // ジャイロの絶対姿勢から「傾き」だけ使う（ヨーは今の推定に合わせる）
  _tiltOnly(qAbs) {
    const yawOf = (q) => { const f = _v.set(0, 0, -1).applyQuaternion(q); return Math.atan2(-f.x, -f.z); };
    const dy = yawOf(this.q) - yawOf(qAbs);
    return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dy).multiply(qAbs);
  }

  _rejectOutliers() {
    let inl = 0, j = 0;
    for (let i = 0; i < this.count; i++) {
      const e = this.err[i];
      if (e > 4) this.bad[i]++; else if (this.bad[i] > 0) this.bad[i]--;
      if (e > 15 || this.bad[i] > 4) continue;   // 捨てる
      if (e <= 4) inl++;
      if (i !== j) this._move(i, j);
      j++;
    }
    this.count = j;
    this.inliers = inl;
  }

  /** デバッグ用：今追いかけている点（トラッキング画像の座標） */
  points() {
    const out = [];
    for (let i = 0; i < this.count; i++) out.push([this.currXY[i * 2], this.currXY[i * 2 + 1], this.err[i]]);
    return out;
  }
}

// 6×6 の連立一次方程式 H x = b（部分ピボット付きガウス消去）
function solve6(H, b, x) {
  const A = new Float64Array(42);
  for (let r = 0; r < 6; r++) { for (let c = 0; c < 6; c++) A[r * 7 + c] = H[r * 6 + c]; A[r * 7 + 6] = b[r]; }
  for (let c = 0; c < 6; c++) {
    let p = c, best = Math.abs(A[c * 7 + c]);
    for (let r = c + 1; r < 6; r++) { const v = Math.abs(A[r * 7 + c]); if (v > best) { best = v; p = r; } }
    if (best < 1e-12) return false;
    if (p !== c) for (let k = 0; k < 7; k++) { const t = A[c * 7 + k]; A[c * 7 + k] = A[p * 7 + k]; A[p * 7 + k] = t; }
    for (let r = c + 1; r < 6; r++) {
      const f = A[r * 7 + c] / A[c * 7 + c];
      if (f === 0) continue;
      for (let k = c; k < 7; k++) A[r * 7 + k] -= f * A[c * 7 + k];
    }
  }
  for (let r = 5; r >= 0; r--) {
    let s = A[r * 7 + 6];
    for (let k = r + 1; k < 6; k++) s -= A[r * 7 + k] * x[k];
    x[r] = s / A[r * 7 + r];
  }
  return true;
}
