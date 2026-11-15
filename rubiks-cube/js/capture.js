// カメラ・写真からキューブの面の色を読み取る
import { STD_COLORS } from './render.js';

const GRID = 0.72; // 枠の大きさ（表示領域に対する割合）

export class FaceCapture {
  constructor(canvas, onSample) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d', { willReadFrequently: true });
    this.video = null; this.stream = null; this.image = null;
    this.pan = { x: 0, y: 0 }; this.zoom = 1;
    this.onSample = onSample; this.running = false;
    this._bindPan();
  }
  get mode() { return this.stream ? 'camera' : this.image ? 'image' : 'none'; }

  async startCamera() {
    this.stop();
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('このブラウザではカメラが使えません');
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    const v = document.createElement('video'); v.playsInline = true; v.muted = true; v.autoplay = true;
    v.setAttribute('playsinline', ''); v.srcObject = this.stream;
    await v.play().catch(() => {});
    this.video = v; this.image = null; this._loop();
  }
  loadFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file); const img = new Image();
      img.onload = () => { this.stopCamera(); this.image = img; this.pan = { x: 0, y: 0 }; this.zoom = 1; this._loop(); resolve(); };
      img.onerror = () => reject(new Error('画像を読み込めませんでした'));
      img.src = url;
    });
  }
  stopCamera() { if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; this.video = null; } }
  stop() { this.stopCamera(); this.image = null; this.running = false; }
  setZoom(z) { this.zoom = z; }

  _bindPan() {
    let last = null;
    this.canvas.addEventListener('pointerdown', (e) => { if (this.image) { last = { x: e.clientX, y: e.clientY }; this.canvas.setPointerCapture(e.pointerId); } });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!last) return; const r = this.canvas.getBoundingClientRect();
      this.pan.x += (e.clientX - last.x) / r.width; this.pan.y += (e.clientY - last.y) / r.height; last = { x: e.clientX, y: e.clientY };
    });
    const up = () => { last = null; };
    this.canvas.addEventListener('pointerup', up); this.canvas.addEventListener('pointercancel', up);
  }

  _loop() {
    if (this.running) return; this.running = true;
    let lastSample = 0;
    const step = (t) => {
      if (!this.running || (!this.video && !this.image)) { this.running = false; return; }
      this._draw();
      if (t - lastSample > 120) { lastSample = t; this.onSample?.(this.sample()); }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  _draw() {
    const c = this.canvas, r = c.getBoundingClientRect();
    const size = Math.round(Math.min(720, r.width * Math.min(2, devicePixelRatio || 1)));
    if (c.width !== size) { c.width = size; c.height = size; }
    const src = this.video || this.image; if (!src) return;
    const sw = this.video ? this.video.videoWidth : src.naturalWidth, sh = this.video ? this.video.videoHeight : src.naturalHeight;
    if (!sw || !sh) return;
    const scale = Math.max(size / sw, size / sh) * (this.image ? this.zoom : 1);
    const dw = sw * scale, dh = sh * scale;
    const dx = (size - dw) / 2 + this.pan.x * size, dy = (size - dh) / 2 + this.pan.y * size;
    this.ctx.fillStyle = '#000'; this.ctx.fillRect(0, 0, size, size);
    this.ctx.drawImage(src, dx, dy, dw, dh);
  }
  // 枠内 9 マスの平均色 [r,g,b] を返す
  sample() {
    const c = this.canvas, size = c.width; if (!size) return null;
    const g = size * GRID, x0 = (size - g) / 2, cell = g / 3, out = [];
    for (let r = 0; r < 3; r++) for (let col = 0; col < 3; col++) {
      const w = Math.max(2, Math.floor(cell * 0.36));
      const cx = x0 + (col + 0.5) * cell, cy = x0 + (r + 0.5) * cell;
      const d = this.ctx.getImageData(Math.round(cx - w / 2), Math.round(cy - w / 2), w, w).data;
      // 明るさの中央付近だけを平均（反射・影の影響を減らす）
      const px = [];
      for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i + 1], d[i + 2], d[i] + d[i + 1] + d[i + 2]]);
      px.sort((a, b) => a[3] - b[3]);
      const lo = Math.floor(px.length * 0.2), hi = Math.ceil(px.length * 0.8);
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let i = lo; i < hi; i++) { sr += px[i][0]; sg += px[i][1]; sb += px[i][2]; n++; }
      out.push([sr / n, sg / n, sb / n]);
    }
    return out;
  }
}

// ---- 色の判定 ----
function toLab([r, g, b]) {
  const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const R = f(r), G = f(g), B = f(b);
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, y = R * 0.2126 + G * 0.7152 + B * 0.0722, z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const h = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = h(x); y = h(y); z = h(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
// 明るさの差は小さめに、色味の差を重く見る
const dist = (a, b) => 0.55 * (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const hex = (rgb) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

function permutations(n) {
  const out = [], a = [...Array(n).keys()];
  const rec = (k) => { if (k === n) { out.push(a.slice()); return; } for (let i = k; i < n; i++) { [a[k], a[i]] = [a[i], a[k]]; rec(k + 1); [a[k], a[i]] = [a[i], a[k]]; } };
  rec(0); return out;
}
const PERMS6 = permutations(6);

/**
 * faces: URFDLB 順に、各面 9 色（[r,g,b]）の配列
 * 戻り値: { state: 54 個の色番号（= その色の中心がある面番号）, palette: 表示色 6 個 }
 */
export function classify(faces) {
  const labs = faces.flat().map(toLab);
  let centers = [0, 1, 2, 3, 4, 5].map((f) => labs[f * 9 + 4].slice());
  let assign = new Array(54).fill(-1);
  for (let iter = 0; iter < 4; iter++) {
    // 各色ちょうど 9 枚になるよう、近い組から順に決める
    const pairs = [];
    for (let i = 0; i < 54; i++) for (let k = 0; k < 6; k++) pairs.push([dist(labs[i], centers[k]), i, k]);
    pairs.sort((a, b) => a[0] - b[0]);
    assign = new Array(54).fill(-1); const cnt = [0, 0, 0, 0, 0, 0];
    for (let f = 0; f < 6; f++) { assign[f * 9 + 4] = f; cnt[f]++; }
    for (const [, i, k] of pairs) { if (assign[i] >= 0 || cnt[k] >= 9) continue; assign[i] = k; cnt[k]++; }
    const next = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < 54; i++) { const c = next[assign[i]]; c[0] += labs[i][0]; c[1] += labs[i][1]; c[2] += labs[i][2]; c[3]++; }
    centers = next.map((c) => [c[0] / c[3], c[1] / c[3], c[2] / c[3]]);
  }
  return { state: assign, palette: paletteFor(faces) };
}

// 6 つの中心色に、見やすい標準色を割り当てる
export function paletteFor(faces) {
  const centers = [0, 1, 2, 3, 4, 5].map((f) => toLab(faces[f][4]));
  const std = STD_COLORS.map((h) => toLab([1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))));
  let best = null, bestCost = Infinity;
  for (const p of PERMS6) {
    let cost = 0; for (let k = 0; k < 6; k++) cost += dist(centers[k], std[p[k]]);
    if (cost < bestCost) { bestCost = cost; best = p; }
  }
  return best.map((j) => STD_COLORS[j]);
}
export { hex };
