// カメラ撮影と、写真から「荒地のデザイン情報」を取り出す解析

export async function startCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('no-camera-api');
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play().catch(() => {});
  return stream;
}

export function stopCamera(stream) {
  stream?.getTracks().forEach((t) => t.stop());
}

/** video / image から最大 maxSide px の canvas を切り出す（画面に見えている範囲 = cover 切り抜き） */
export function grabFrame(src, maxSide = 640, aspect = null) {
  const sw = src.videoWidth || src.naturalWidth || src.width;
  const sh = src.videoHeight || src.naturalHeight || src.height;
  let cx = 0, cy = 0, cw = sw, ch = sh;
  if (aspect) {
    // 画面の縦横比に合わせて中央を切り抜く
    if (sw / sh > aspect) { cw = sh * aspect; cx = (sw - cw) / 2; }
    else { ch = sw / aspect; cy = (sh - ch) / 2; }
  }
  const s = Math.min(1, maxSide / Math.max(cw, ch));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(cw * s));
  c.height = Math.max(1, Math.round(ch * s));
  c.getContext('2d').drawImage(src, cx, cy, cw, ch, 0, 0, c.width, c.height);
  return c;
}

export function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve(img); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    img.onerror = reject;
    img.src = url;
  });
}

/** カメラが無いとき用の「それっぽい景色」 */
export function makeSamplePhoto(seed = Date.now()) {
  const rnd = mulberry32(seed >>> 0);
  const c = document.createElement('canvas');
  c.width = 480; c.height = 640;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 300);
  const dusk = rnd() < 0.4;
  sky.addColorStop(0, dusk ? '#f39c6b' : '#7ec8f0');
  sky.addColorStop(1, dusk ? '#ffd9a0' : '#e3f4ff');
  g.fillStyle = sky; g.fillRect(0, 0, 480, 300);
  // 遠くの建物
  for (let i = 0; i < 9; i++) {
    const w = 30 + rnd() * 60, h = 60 + rnd() * 160, x = rnd() * 480;
    g.fillStyle = `hsl(${200 + rnd() * 40},10%,${45 + rnd() * 25}%)`;
    g.fillRect(x, 300 - h, w, h);
    g.fillStyle = 'rgba(255,255,255,.35)';
    for (let wy = 300 - h + 10; wy < 290; wy += 18) for (let wx = x + 6; wx < x + w - 8; wx += 14) if (rnd() < 0.6) g.fillRect(wx, wy, 7, 9);
  }
  // 地面
  const gr = g.createLinearGradient(0, 300, 0, 640);
  gr.addColorStop(0, '#9b8a73'); gr.addColorStop(1, '#6f5d48');
  g.fillStyle = gr; g.fillRect(0, 300, 480, 340);
  // 草むら・石・がれき
  for (let i = 0; i < 70; i++) {
    const x = rnd() * 480, y = 310 + rnd() * 330, s = 6 + rnd() * 26 * (y / 640);
    const k = rnd();
    if (k < 0.4) { g.fillStyle = `hsl(${90 + rnd() * 40},45%,${28 + rnd() * 20}%)`; g.beginPath(); g.ellipse(x, y, s * 1.4, s, 0, 0, 7); g.fill(); }
    else if (k < 0.75) { g.fillStyle = `hsl(30,${rnd() * 15}%,${35 + rnd() * 30}%)`; g.fillRect(x, y, s * 1.5, s); }
    else { g.fillStyle = `hsl(${10 + rnd() * 20},55%,${30 + rnd() * 15}%)`; g.fillRect(x, y, s * 2, s * 0.8); }
  }
  // 手前の木
  g.fillStyle = '#5b4636'; g.fillRect(380, 200, 18, 200);
  g.fillStyle = '#4f8a3c'; g.beginPath(); g.arc(389, 200, 60, 0, 7); g.fill();
  return c;
}

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

/**
 * 写真を N×N の盤面にマッピングし、マスごとの特徴量と全体の雰囲気を返す。
 * 写真の上 → 盤面の奥、写真の下 → 盤面の手前。
 */
export function analyzePhoto(photo, N) {
  const W = 64, H = Math.max(24, Math.round(64 * photo.height / photo.width));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(photo, 0, 0, W, H);
  const data = g.getImageData(0, 0, W, H).data;

  const n = W * H;
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  const L = new Float32Array(n), S = new Float32Array(n), Hh = new Float32Array(n);
  let hash = 2166136261;
  for (let p = 0; p < n; p++) {
    const r = data[p * 4] / 255, gg = data[p * 4 + 1] / 255, b = data[p * 4 + 2] / 255;
    R[p] = r; G[p] = gg; B[p] = b;
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
    L[p] = 0.299 * r + 0.587 * gg + 0.114 * b;
    S[p] = mx === 0 ? 0 : (mx - mn) / mx;
    let h = 0;
    if (mx !== mn) {
      if (mx === r) h = ((gg - b) / (mx - mn) + 6) % 6;
      else if (mx === gg) h = (b - r) / (mx - mn) + 2;
      else h = (r - gg) / (mx - mn) + 4;
    }
    Hh[p] = h * 60;
    hash ^= data[p * 4] ^ (data[p * 4 + 1] << 8) ^ (data[p * 4 + 2] << 16);
    hash = Math.imul(hash, 16777619);
  }

  // エッジ（ごちゃごちゃ度）
  const E = new Float32Array(n);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x;
    const dx = x < W - 1 ? Math.abs(L[p + 1] - L[p]) : 0;
    const dy = y < H - 1 ? Math.abs(L[p + W] - L[p]) : 0;
    E[p] = dx + dy;
  }
  const isGreen = (p) => Hh[p] > 65 && Hh[p] < 170 && S[p] > 0.18 && L[p] > 0.08;

  // 全体統計
  let sr = 0, sg = 0, sb = 0, sl = 0, ss = 0, se = 0, sgreen = 0;
  for (let p = 0; p < n; p++) { sr += R[p]; sg += G[p]; sb += B[p]; sl += L[p]; ss += S[p]; se += E[p]; if (isGreen(p)) sgreen++; }
  const avg = [sr / n, sg / n, sb / n];
  const brightness = sl / n, saturation = ss / n, edgeAbs = se / n, green = sgreen / n;

  const regionAvg = (y0, y1) => {
    let r = 0, gg = 0, b = 0, k = 0;
    for (let y = Math.floor(y0 * H); y < Math.ceil(y1 * H); y++) for (let x = 0; x < W; x++) { const p = y * W + x; r += R[p]; gg += G[p]; b += B[p]; k++; }
    return [r / k, gg / k, b / k];
  };
  const skyColor = regionAvg(0, 0.3);
  const groundColor = regionAvg(0.62, 1);

  // マスごとの特徴
  const cells = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x0 = Math.floor(i * W / N), x1 = Math.floor((i + 1) * W / N);
    const y0 = Math.floor(j * H / N), y1 = Math.floor((j + 1) * H / N);
    let r = 0, gg = 0, b = 0, l = 0, e = 0, gr = 0, s = 0, k = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const p = y * W + x;
      r += R[p]; gg += G[p]; b += B[p]; l += L[p]; e += E[p]; s += S[p]; if (isGreen(p)) gr++; k++;
    }
    k = Math.max(1, k);
    cells.push({ i, j, color: [r / k, gg / k, b / k], lum: l / k, edgeAbs: e / k, green: gr / k, sat: s / k });
  }
  // 相対＋絶対で正規化（どんな写真でもバリエーションが出るように）
  const es = cells.map((c) => c.edgeAbs), eMin = Math.min(...es), eMax = Math.max(...es);
  const ls = cells.map((c) => c.lum), lMin = Math.min(...ls), lMax = Math.max(...ls);
  for (const cl of cells) {
    const rel = (cl.edgeAbs - eMin) / Math.max(1e-4, eMax - eMin);
    cl.edge = 0.6 * rel + 0.4 * Math.min(1, cl.edgeAbs / 0.16);
    cl.lumRel = (cl.lum - lMin) / Math.max(1e-4, lMax - lMin);
  }

  const palette = kmeans(R, G, B, n, 5);
  const ruinScore = clamp01(edgeAbs / 0.12) * 0.7 + (1 - clamp01(green * 3)) * 0.3;
  const warmth = avg[0] - avg[2];

  return {
    seed: hash >>> 0,
    N, avg, brightness, saturation, edge: clamp01(edgeAbs / 0.14), green: clamp01(green * 2.2),
    ruin: clamp01(ruinScore), warmth, skyColor, groundColor, palette, cells,
    skyLabel: brightness < 0.28 ? '夜っぽい' : warmth > 0.12 ? '夕焼け' : brightness > 0.6 ? 'はれ' : 'くもり',
  };
}

function kmeans(R, G, B, n, k) {
  // 明るさ順の分位点で初期化（決定的）
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => (R[a] + G[a] + B[a]) - (R[b] + G[b] + B[b]));
  let cent = [];
  for (let c = 0; c < k; c++) { const p = idx[Math.floor((c + 0.5) * n / k)]; cent.push([R[p], G[p], B[p]]); }
  const asg = new Int32Array(n);
  let count = new Array(k).fill(0);
  for (let it = 0; it < 8; it++) {
    const sum = cent.map(() => [0, 0, 0]); count = new Array(k).fill(0);
    for (let p = 0; p < n; p++) {
      let best = 0, bd = 1e9;
      for (let c = 0; c < k; c++) {
        const d = (R[p] - cent[c][0]) ** 2 + (G[p] - cent[c][1]) ** 2 + (B[p] - cent[c][2]) ** 2;
        if (d < bd) { bd = d; best = c; }
      }
      asg[p] = best; sum[best][0] += R[p]; sum[best][1] += G[p]; sum[best][2] += B[p]; count[best]++;
    }
    cent = cent.map((c, i) => (count[i] ? [sum[i][0] / count[i], sum[i][1] / count[i], sum[i][2] / count[i]] : c));
  }
  return cent.map((c, i) => ({ c, w: count[i] })).sort((a, b) => b.w - a.w).map((o) => o.c);
}

export function clamp01(v) { return Math.max(0, Math.min(1, v)); }

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rgbToCss([r, g, b]) {
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
}

/** 写真を「廃墟っぽく」くすませたテクスチャ用 canvas */
export function makeGrimyPhoto(photo) {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  g.drawImage(photo, 0, 0, S, S);
  const img = g.getImageData(0, 0, S, S), d = img.data;
  for (let p = 0; p < d.length; p += 4) {
    const l = 0.3 * d[p] + 0.59 * d[p + 1] + 0.11 * d[p + 2];
    // 彩度を落としてセピア寄りに
    d[p] = d[p] * 0.45 + (l * 1.05 + 12) * 0.55;
    d[p + 1] = d[p + 1] * 0.45 + (l * 0.95 + 4) * 0.55;
    d[p + 2] = d[p + 2] * 0.45 + (l * 0.8) * 0.55;
  }
  g.putImageData(img, 0, 0);
  const rnd = mulberry32(7);
  // しみ
  for (let i = 0; i < 40; i++) {
    const x = rnd() * S, y = rnd() * S, r = 10 + rnd() * 60;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(40,30,20,${0.15 + rnd() * 0.25})`); gr.addColorStop(1, 'rgba(40,30,20,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // ひび
  g.strokeStyle = 'rgba(30,20,15,.55)'; g.lineWidth = 1.5;
  for (let i = 0; i < 14; i++) {
    let x = rnd() * S, y = rnd() * S;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (rnd() - 0.5) * 50; y += rnd() * 40; g.lineTo(x, y); }
    g.stroke();
  }
  // レンガ目地
  g.strokeStyle = 'rgba(255,240,220,.12)'; g.lineWidth = 2;
  for (let y = 0; y < S; y += 32) {
    g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke();
    for (let x = (y / 32) % 2 ? 0 : 32; x < S; x += 64) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 32); g.stroke(); }
  }
  return c;
}
