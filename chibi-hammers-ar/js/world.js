// 写真の解析結果から「荒地と廃墟の盤面」を組み立てる
import * as THREE from 'three';
import { mulberry32 } from './photo.js';

export const CELL = 1;

export const TYPES = {
  pebbles: { name: '小石', hp: 3, coin: 2, mat: 'stone', icon: '·', color: '#bdb5a6' },
  weeds: { name: '草むら', hp: 4, coin: 2, mat: 'plant', icon: '"', color: '#6aa84f' },
  rubble: { name: 'がれき', hp: 7, coin: 4, mat: 'brick', icon: '▪', color: '#b0705a' },
  rock: { name: '岩', hp: 9, coin: 5, mat: 'stone', icon: '●', color: '#8d8d8d' },
  tree: { name: '枯れ木', hp: 8, coin: 5, mat: 'wood', icon: 'Y', color: '#7a5c45' },
  junk: { name: '廃材', hp: 10, coin: 6, mat: 'metal', icon: '◎', color: '#c0703a' },
  wall: { name: '崩れた壁', hp: 13, coin: 8, mat: 'brick', icon: '▮', color: '#9a8a7a' },
  ruin: { name: '廃屋', hp: 45, coin: 30, mat: 'brick', icon: '▣', color: '#5d4e44', size: 2 },
};

// ---------------------------------------------------------------------------
// レイアウト計画（写真 → どのマスに何を置くか）
// ---------------------------------------------------------------------------
export function planLayout(an, level = 1, variant = 0) {
  const N = an.N;
  const rng = mulberry32((an.seed + variant * 7919 + level * 104729) >>> 0);
  const cell = (i, j) => an.cells[j * N + i];
  const used = new Array(N * N).fill(false);
  const plan = [];

  // ちびたちのスタート地点（中央 2×2）は最初からきれい
  const c0 = Math.floor(N / 2) - 1;
  const spawn = [];
  for (let j = c0; j < c0 + 2; j++) for (let i = c0; i < c0 + 2; i++) { used[j * N + i] = true; spawn.push({ i, j }); }

  // 1) 廃屋（2×2）: エッジが強くて暗めの場所
  const maxRuins = 1 + Math.round(an.ruin * 2.4 + Math.min(1, (level - 1) * 0.25));
  const cands = [];
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const cs = [cell(i, j), cell(i + 1, j), cell(i, j + 1), cell(i + 1, j + 1)];
    const e = cs.reduce((s, c) => s + c.edge, 0) / 4;
    const dark = 1 - cs.reduce((s, c) => s + c.lumRel, 0) / 4;
    const gr = cs.reduce((s, c) => s + c.green, 0) / 4;
    cands.push({ i, j, score: e * 0.7 + dark * 0.3 - gr * 0.6 + rng() * 0.15 });
  }
  cands.sort((a, b) => b.score - a.score);
  let ruins = 0;
  for (const c of cands) {
    if (ruins >= maxRuins || c.score < 0.35) break;
    const ids = [c.j * N + c.i, c.j * N + c.i + 1, (c.j + 1) * N + c.i, (c.j + 1) * N + c.i + 1];
    if (ids.some((k) => used[k])) continue;
    // 隣接する廃屋同士はくっつけない
    let near = false;
    for (const p of plan) if (Math.abs(p.cells[0].i - c.i) < 3 && Math.abs(p.cells[0].j - c.j) < 3) near = true;
    if (near) continue;
    ids.forEach((k) => (used[k] = true));
    plan.push({ type: 'ruin', cells: [{ i: c.i, j: c.j }, { i: c.i + 1, j: c.j }, { i: c.i, j: c.j + 1 }, { i: c.i + 1, j: c.j + 1 }], tone: cell(c.i, c.j) });
    ruins++;
  }

  // 2) のこりのマス
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    if (used[j * N + i]) continue;
    const c = cell(i, j);
    const r = rng();
    let type;
    if (c.green > 0.35) type = r < 0.22 ? 'tree' : r < 0.35 ? 'pebbles' : 'weeds';
    else if (c.edge > 0.62) type = c.lumRel < 0.45 ? (r < 0.75 ? 'wall' : 'junk') : (r < 0.6 ? 'junk' : 'rubble');
    else if (c.edge > 0.4) type = c.lumRel < 0.5 ? (r < 0.6 ? 'rock' : 'rubble') : (r < 0.6 ? 'rubble' : 'rock');
    else if (c.lumRel > 0.72) type = r < 0.7 ? 'pebbles' : 'weeds';
    else type = r < 0.35 ? 'rock' : r < 0.6 ? 'weeds' : r < 0.85 ? 'pebbles' : 'tree';
    // ちょっとだけランダムに入れ替え（にぎやかさ）
    if (rng() < 0.12) type = ['weeds', 'rock', 'rubble', 'tree', 'junk', 'pebbles'][Math.floor(rng() * 6)];
    plan.push({ type, cells: [{ i, j }], tone: c });
  }
  return { plan, spawn, seed: rng() * 1e9 };
}

/** 解析画面に出す「荒地マップ」のプレビュー */
export function drawPlanPreview(canvas, an, layout) {
  const N = an.N;
  canvas.width = N * 16; canvas.height = N * 16;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  const sx = canvas.width / N, sy = canvas.height / N;
  for (const s of layout.spawn) { g.fillStyle = 'rgba(126,224,138,.75)'; g.fillRect(s.i * sx + 1, s.j * sy + 1, sx - 2, sy - 2); }
  for (const p of layout.plan) {
    const t = TYPES[p.type];
    const i0 = Math.min(...p.cells.map((c) => c.i)), j0 = Math.min(...p.cells.map((c) => c.j));
    const w = (t.size || 1);
    g.fillStyle = t.color + 'cc';
    g.fillRect(i0 * sx + 1, j0 * sy + 1, sx * w - 2, sy * w - 2);
    g.fillStyle = '#fff';
    g.font = `bold ${Math.round(sx * 0.6 * w)}px sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(t.icon, (i0 + w / 2) * sx, (j0 + w / 2) * sy + 1);
  }
}

// ---------------------------------------------------------------------------
// メッシュ
// ---------------------------------------------------------------------------
const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  ico: new THREE.IcosahedronGeometry(1, 0),
  dode: new THREE.DodecahedronGeometry(1, 0),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 9),
  taper: new THREE.CylinderGeometry(0.55, 1, 1, 7),
  cone: new THREE.ConeGeometry(1, 1, 5),
  torus: new THREE.TorusGeometry(1, 0.42, 6, 14),
  sphere: new THREE.SphereGeometry(1, 10, 8),
};
const UP = new THREE.Vector3(0, 1, 0);

function srgb([r, g, b]) { return new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace); }
function mixc(hex, rgb, t) { return new THREE.Color(hex).lerp(srgb(rgb), t); }

function canvasTex(w, h, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}

export class World {
  constructor(an, photoTexCanvas, layout, level) {
    this.an = an;
    this.N = an.N;
    this.level = level;
    this.group = new THREE.Group();
    this.rng = mulberry32(layout.seed >>> 0);
    this.grid = new Array(this.N * this.N).fill(null);
    this.obstacles = [];
    this.tiles = [];
    this.anims = [];
    this.matCache = new Map();
    this.disposables = [];
    this.totalCells = 0;
    this.clearedCells = 0;
    this.time = 0;

    this._buildPhotoMats(photoTexCanvas);
    this._buildBase();
    for (const s of layout.spawn) this._makeTile(s.i, s.j, true);
    const hpMul = 1 + (level - 1) * 0.35;
    for (const p of layout.plan) this._addObstacle(p, hpMul);
  }

  // ---- 座標ユーティリティ ----
  cellCenter(i, j, out = new THREE.Vector3()) {
    return out.set((i - (this.N - 1) / 2) * CELL, 0, (j - (this.N - 1) / 2) * CELL);
  }
  cellOf(x, z) {
    const i = Math.round(x / CELL + (this.N - 1) / 2), j = Math.round(z / CELL + (this.N - 1) / 2);
    if (i < 0 || j < 0 || i >= this.N || j >= this.N) return null;
    return { i, j };
  }
  inside(i, j) { return i >= 0 && j >= 0 && i < this.N && j < this.N; }
  obstacleAt(i, j) { return this.inside(i, j) ? this.grid[j * this.N + i] : null; }
  isFree(i, j) { return this.inside(i, j) && !this.grid[j * this.N + i]; }
  get progress() { return this.totalCells ? this.clearedCells / this.totalCells : 1; }
  get done() { return this.obstacles.every((o) => o.dead); }

  _mat(color, opts = {}) {
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    const key = c.getHexString() + JSON.stringify(opts);
    if (!this.matCache.has(key)) {
      const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.88, metalness: 0, flatShading: true, ...opts });
      this.matCache.set(key, m);
      this.disposables.push(m);
    }
    return this.matCache.get(key);
  }

  _buildPhotoMats(canvas) {
    // 撮影した景色がしみついた壁材
    const base = new THREE.CanvasTexture(canvas);
    base.colorSpace = THREE.SRGBColorSpace;
    base.wrapS = base.wrapT = THREE.RepeatWrapping;
    this.disposables.push(base);
    this.photoMats = [];
    const pal = this.an.palette;
    for (let k = 0; k < 6; k++) {
      const t = base.clone();
      t.repeat.set(0.3 + this.rng() * 0.2, 0.3 + this.rng() * 0.2);
      t.offset.set(this.rng() * 0.6, this.rng() * 0.6);
      t.needsUpdate = true;
      this.disposables.push(t);
      const tint = new THREE.Color(0xffffff).lerp(srgb(pal[k % pal.length]), 0.25);
      const m = new THREE.MeshStandardMaterial({ map: t, color: tint, roughness: 0.95, flatShading: true });
      this.disposables.push(m);
      this.photoMats.push(m);
    }
  }

  _buildBase() {
    const N = this.N, an = this.an;
    // 地面の色は写真の下の方の色 + 土っぽさ
    const gc = mixc(0x8b7355, an.groundColor, 0.55);
    const hsl = {}; gc.getHSL(hsl);
    gc.setHSL(hsl.h, Math.min(hsl.s, 0.45), Math.min(0.55, Math.max(0.3, hsl.l)));
    const gcss = '#' + gc.getHexString();
    const rnd = mulberry32(this.an.seed);
    const topTex = canvasTex(512, 512, (g, w, h) => {
      g.fillStyle = gcss; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 2600; i++) {
        const l = rnd() < 0.5 ? 0 : 255;
        g.fillStyle = `rgba(${l},${l},${l},${0.03 + rnd() * 0.07})`;
        const s = 1 + rnd() * 5;
        g.fillRect(rnd() * w, rnd() * h, s, s);
      }
      for (let i = 0; i < 30; i++) {
        const x = rnd() * w, y = rnd() * h, r = 20 + rnd() * 60;
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, `rgba(30,20,10,${0.08 + rnd() * 0.12})`); gr.addColorStop(1, 'rgba(30,20,10,0)');
        g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
      }
      g.strokeStyle = 'rgba(40,25,15,.35)'; g.lineWidth = 2;
      for (let i = 0; i < 18; i++) {
        let x = rnd() * w, y = rnd() * h; g.beginPath(); g.moveTo(x, y);
        for (let k = 0; k < 5; k++) { x += (rnd() - 0.5) * 60; y += (rnd() - 0.5) * 60; g.lineTo(x, y); }
        g.stroke();
      }
    }, 2);
    const sideTex = canvasTex(256, 64, (g, w, h) => {
      const layers = ['#7a5a3f', '#8b6a4a', '#6d4f37', '#5d4330', '#4e382a'];
      let y = 0;
      for (let k = 0; y < h; k++) { const lh = 6 + rnd() * 14; g.fillStyle = layers[k % layers.length]; g.fillRect(0, y, w, lh); y += lh; }
      g.fillStyle = gcss; g.fillRect(0, 0, w, 7);
      for (let i = 0; i < 80; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.25})`; g.beginPath(); g.arc(rnd() * w, 10 + rnd() * h, 1 + rnd() * 3, 0, 7); g.fill(); }
    });
    sideTex.repeat.set(4, 1);
    this.disposables.push(topTex, sideTex);
    const top = new THREE.MeshStandardMaterial({ map: topTex, roughness: 1 });
    const side = new THREE.MeshStandardMaterial({ map: sideTex, roughness: 1 });
    const bottom = new THREE.MeshStandardMaterial({ color: 0x3d2b1f, roughness: 1 });
    this.disposables.push(top, side, bottom);
    const size = N * CELL + 0.5;
    const geo = new THREE.BoxGeometry(size, 0.6, size);
    geo.translate(0, -0.3, 0);
    this.disposables.push(geo);
    this.base = new THREE.Mesh(geo, [side, side, top, bottom, side, side]);
    this.base.receiveShadow = true;
    this.base.userData.ground = true;
    this.group.add(this.base);

    // 整地後のタイル（ふかふかの土 → クリア時に芝生）
    const soil = (alt) => canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = alt ? '#c9a27a' : '#c29a70'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(120,80,45,.35)'; g.lineWidth = 3;
      for (let y = 8; y < h; y += 14) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      g.fillStyle = 'rgba(255,240,210,.18)';
      for (let y = 4; y < h; y += 14) g.fillRect(0, y, w, 3);
      g.strokeStyle = 'rgba(90,60,30,.5)'; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4);
    });
    const grass = (alt) => canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = alt ? '#7ed36a' : '#6cc75b'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '40,120,40' : '190,255,160'},.35)`; g.fillRect(rnd() * w, rnd() * h, 2, 5); }
    });
    const s0 = soil(0), s1 = soil(1), g0 = grass(0), g1 = grass(1);
    this.disposables.push(s0, s1, g0, g1);
    this.tileMats = [new THREE.MeshStandardMaterial({ map: s0, roughness: 1 }), new THREE.MeshStandardMaterial({ map: s1, roughness: 1 })];
    this.grassMats = [new THREE.MeshStandardMaterial({ map: g0, roughness: 1 }), new THREE.MeshStandardMaterial({ map: g1, roughness: 1 })];
    this.disposables.push(...this.tileMats, ...this.grassMats);
    this.tileGeo = new THREE.PlaneGeometry(CELL * 0.98, CELL * 0.98).rotateX(-Math.PI / 2);
    this.disposables.push(this.tileGeo);
  }

  _makeTile(i, j, instant = false) {
    const m = new THREE.Mesh(this.tileGeo, this.tileMats[(i + j) % 2]);
    this.cellCenter(i, j, m.position);
    m.position.y = 0.012;
    m.receiveShadow = true;
    m.userData.ground = true;
    m.userData.cell = { i, j };
    this.group.add(m);
    this.tiles.push(m);
    if (!instant) {
      m.scale.setScalar(0.01);
      this.anims.push({ t: 0, dur: 0.45, fn: (u) => m.scale.setScalar(Math.max(0.01, easeOutBack(u))) });
    }
  }

  // ---- 障害物 ----
  _addObstacle(p, hpMul) {
    const t = TYPES[p.type];
    const g = new THREE.Group();
    const cen = new THREE.Vector3();
    for (const c of p.cells) cen.add(this.cellCenter(c.i, c.j));
    cen.divideScalar(p.cells.length);
    g.position.copy(cen);
    g.rotation.y = p.type === 'ruin' ? Math.floor(this.rng() * 4) * Math.PI / 2 : this.rng() * Math.PI * 2;
    const chunks = [];
    const add = (geo, mat, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0, cast = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.set(rx, ry, rz);
      m.castShadow = cast; m.receiveShadow = true;
      g.add(m); chunks.push(m);
      return m;
    };
    this['_build_' + p.type](add, p.tone);

    const maxHp = Math.round(t.hp * hpMul);
    const ob = {
      type: p.type, def: t, cells: p.cells, group: g, center: cen.clone(),
      radius: p.type === 'ruin' ? 0.95 : 0.45,
      hp: maxHp, maxHp, dead: false, shake: 0, flung: 0, attackers: 0,
      chunks: chunks.sort((a, b) => (b.position.y + b.scale.y * 0.5) - (a.position.y + a.scale.y * 0.5)),
      color: TYPES[p.type].color,
    };
    g.traverse((o) => { o.userData.obstacle = ob; });
    for (const c of p.cells) this.grid[c.j * this.N + c.i] = ob;
    this.totalCells += p.cells.length;
    this.obstacles.push(ob);
    this.group.add(g);
  }

  _build_pebbles(add, tone) {
    const r = this.rng;
    const stone = mixc(0xb5ada0, tone.color, 0.35);
    for (let k = 0; k < 6 + Math.floor(r() * 4); k++) {
      const a = r() * 6.28, d = 0.1 + r() * 0.3, s = 0.05 + r() * 0.06;
      add(GEO.ico, this._mat(stone.clone().offsetHSL(0, 0, (r() - 0.5) * 0.15)), Math.cos(a) * d, s * 0.5, Math.sin(a) * d, s * 1.2, s * 0.7, s, r(), r(), r(), false);
    }
    for (let k = 0; k < 3; k++) {
      const a = r() * 6.28, d = r() * 0.35, h = 0.12 + r() * 0.12;
      add(GEO.cone, this._mat(0x8fae5a), Math.cos(a) * d, h / 2, Math.sin(a) * d, 0.04, h, 0.04, (r() - 0.5) * 0.5, 0, (r() - 0.5) * 0.5, false);
    }
  }

  _build_weeds(add, tone) {
    const r = this.rng;
    const green = mixc(0x5f9e3f, tone.color, tone.green > 0.2 ? 0.45 : 0.15);
    const dry = new THREE.Color(0xc9b458);
    add(GEO.sphere, this._mat(green.clone().offsetHSL(0, 0, -0.06)), (r() - 0.5) * 0.3, 0.1, (r() - 0.5) * 0.3, 0.24, 0.17, 0.22);
    add(GEO.sphere, this._mat(green), (r() - 0.5) * 0.4, 0.08, (r() - 0.5) * 0.4, 0.17, 0.13, 0.19);
    for (let k = 0; k < 7 + Math.floor(r() * 4); k++) {
      const a = r() * 6.28, d = r() * 0.36, h = 0.25 + r() * 0.35;
      const c = r() < 0.25 ? dry : green.clone().offsetHSL((r() - 0.5) * 0.04, 0, (r() - 0.5) * 0.12);
      add(GEO.cone, this._mat(c), Math.cos(a) * d, h / 2, Math.sin(a) * d, 0.055 + r() * 0.03, h, 0.055, (r() - 0.5) * 0.6, r() * 3, (r() - 0.5) * 0.6);
    }
  }

  _build_tree(add, tone) {
    const r = this.rng;
    const bark = mixc(0x6b5443, tone.color, 0.2);
    const H = 0.7 + r() * 0.35;
    // 根っこ
    for (let k = 0; k < 3; k++) { const a = k * 2.1 + r(); add(GEO.box, this._mat(bark), Math.cos(a) * 0.12, 0.03, Math.sin(a) * 0.12, 0.16, 0.06, 0.07, 0, -a, 0.2); }
    // 幹（2段）
    add(GEO.taper, this._mat(bark), 0, H * 0.25, 0, 0.11, H * 0.5, 0.11);
    add(GEO.taper, this._mat(bark.clone().offsetHSL(0, 0, 0.04)), 0.02, H * 0.72, 0, 0.075, H * 0.46, 0.075, 0, 0, -0.08);
    // 枝
    for (let k = 0; k < 4; k++) {
      const a = k * 1.6 + r(), tilt = 0.6 + r() * 0.5, len = 0.25 + r() * 0.2, y0 = H * (0.45 + r() * 0.4);
      const dir = new THREE.Vector3(Math.sin(tilt) * Math.cos(a), Math.cos(tilt), Math.sin(tilt) * Math.sin(a));
      const m = add(GEO.taper, this._mat(bark), dir.x * len / 2, y0 + dir.y * len / 2, dir.z * len / 2, 0.03, len, 0.03);
      m.quaternion.setFromUnitVectors(UP, dir);
    }
    // 枯れ葉
    if (r() < 0.6) for (let k = 0; k < 2; k++) add(GEO.ico, this._mat(0xa08a4a), (r() - 0.5) * 0.4, H * (0.8 + r() * 0.3), (r() - 0.5) * 0.4, 0.1, 0.07, 0.1, r(), r(), r());
  }

  _build_rock(add, tone) {
    const r = this.rng;
    const gray = mixc(0x8a8680, tone.color, 0.35);
    add(GEO.dode, this._mat(gray), 0, 0.15, 0, 0.36, 0.2, 0.32, 0, r() * 3, 0);
    add(GEO.dode, this._mat(gray.clone().offsetHSL(0, 0, 0.05)), 0.04, 0.33, -0.02, 0.24, 0.16, 0.22, r(), r(), r());
    add(GEO.ico, this._mat(gray.clone().offsetHSL(0, 0, -0.05)), -0.02, 0.47, 0.02, 0.14, 0.11, 0.13, r(), r(), r());
    for (let k = 0; k < 3; k++) {
      const a = r() * 6.28, s = 0.07 + r() * 0.07;
      add(GEO.ico, this._mat(gray.clone().offsetHSL(0, 0, (r() - 0.5) * 0.1)), Math.cos(a) * 0.38, s * 0.6, Math.sin(a) * 0.38, s, s * 0.8, s, r(), r(), r());
    }
  }

  _build_rubble(add, tone) {
    const r = this.rng, pal = this.an.palette;
    const concrete = mixc(0x9c9a94, tone.color, 0.3);
    const brick = mixc(0xa0523d, pal[1] || tone.color, 0.2);
    let n = 7 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) {
      const a = r() * 6.28, d = r() * 0.33, s = 0.1 + r() * 0.18;
      const h = s * (0.5 + r() * 0.5);
      const y = h / 2 + Math.max(0, (0.35 - d) * 0.6) * r();
      add(GEO.box, this._mat(r() < 0.5 ? concrete.clone().offsetHSL(0, 0, (r() - 0.5) * 0.1) : brick), Math.cos(a) * d, y, Math.sin(a) * d, s, h, s * (0.6 + r() * 0.6), (r() - 0.5) * 0.6, r() * 3, (r() - 0.5) * 0.6);
    }
    // 鉄筋
    add(GEO.cyl, this._mat(0x8a4b2a, { metalness: 0.4 }), 0.05, 0.3, 0, 0.012, 0.5, 0.012, 0.4, 0, 0.3, false);
  }

  _build_junk(add, tone) {
    const r = this.rng;
    const rust = mixc(0xb0562b, tone.color, 0.2);
    // ドラム缶
    const bx = (r() - 0.5) * 0.2;
    add(GEO.cyl, this._mat(rust, { metalness: 0.3, roughness: 0.7 }), bx, 0.17, -0.12, 0.14, 0.34, 0.14, 0, 0, r() < 0.4 ? 0.15 : 0);
    add(GEO.cyl, this._mat(rust.clone().offsetHSL(0, 0, -0.1), { metalness: 0.3 }), bx, 0.35, -0.12, 0.145, 0.025, 0.145);
    // 古タイヤ
    add(GEO.torus, this._mat(0x2f2c2a), 0.2, 0.05, 0.18, 0.12, 0.12, 0.12, Math.PI / 2, 0, 0);
    // 板きれ
    const wood = mixc(0x9c7650, tone.color, 0.15);
    for (let k = 0; k < 3; k++) add(GEO.box, this._mat(wood.clone().offsetHSL(0, 0, (r() - 0.5) * 0.1)), -0.15 + r() * 0.2, 0.12 + k * 0.06, 0.1 + (r() - 0.5) * 0.2, 0.6, 0.035, 0.09, (r() - 0.5) * 0.3, r() * 3, 0.3 + (r() - 0.5) * 0.3);
    // トタン
    add(GEO.box, this._mat(0x7f8c8d, { metalness: 0.5, roughness: 0.6 }), -0.18, 0.18, -0.15, 0.32, 0.02, 0.3, 0.9, 0.5, 0);
  }

  _build_wall(add) {
    const r = this.rng;
    const segs = 4, w = 0.88 / segs, d = 0.16;
    for (let k = 0; k < segs; k++) {
      const x = -0.44 + w * (k + 0.5);
      const h = 0.35 + r() * 0.55;
      const m = this.photoMats[Math.floor(r() * this.photoMats.length)];
      const h1 = Math.min(h, 0.3);
      add(GEO.box, m, x, h1 / 2, 0, w * 0.98, h1, d);
      if (h > h1) add(GEO.box, m, x + (r() - 0.5) * 0.02, h1 + (h - h1) / 2, 0, w * 0.98, h - h1, d, 0, 0, (r() - 0.5) * 0.08);
      if (r() < 0.6) add(GEO.box, this._mat(0x9a6a55), x, h + 0.04, (r() - 0.5) * 0.05, w * 0.5, 0.07, 0.1, 0, 0, (r() - 0.5) * 0.5);
    }
    // 崩れ落ちたブロック
    for (let k = 0; k < 3; k++) add(GEO.box, this.photoMats[k % this.photoMats.length], (r() - 0.5) * 0.7, 0.05, 0.22 + r() * 0.15, 0.15, 0.1, 0.12, 0, r() * 3, 0);
  }

  _build_ruin(add, tone) {
    const r = this.rng;
    const S = 1.75, half = S / 2, t = 0.11;
    const H = 0.95 + tone.edge * 0.5 + r() * 0.25;
    const pm = () => this.photoMats[Math.floor(r() * this.photoMats.length)];
    const sides = [
      { x: 0, z: -half, ry: 0 }, { x: 0, z: half, ry: 0 },
      { x: -half, z: 0, ry: Math.PI / 2 }, { x: half, z: 0, ry: Math.PI / 2 },
    ];
    sides.forEach((sd, si) => {
      const segs = 3, w = S / segs;
      for (let k = 0; k < segs; k++) {
        const off = -half + w * (k + 0.5);
        const x = sd.x + (sd.ry ? 0 : off), z = sd.z + (sd.ry ? off : 0);
        const broken = r() < 0.35;
        const h = broken ? 0.25 + r() * 0.35 : H * (0.75 + r() * 0.25);
        const isDoor = si === 1 && k === 1;
        const m = pm();
        if (isDoor) {
          // 入り口：上だけ残す
          add(GEO.box, m, x, h - 0.12, z, w * 0.98, 0.24, t, 0, sd.ry, 0);
          continue;
        }
        const h1 = h * 0.45;
        add(GEO.box, m, x, h1 / 2, z, w * 0.98, h1, t, 0, sd.ry, 0);
        if (!broken && r() < 0.5 && k === 1) {
          // 窓（左右の柱＋上）
          add(GEO.box, m, x - (sd.ry ? 0 : w * 0.36), h1 + 0.15, z - (sd.ry ? w * 0.36 : 0), w * 0.26, 0.3, t, 0, sd.ry, 0);
          add(GEO.box, m, x + (sd.ry ? 0 : w * 0.36), h1 + 0.15, z + (sd.ry ? w * 0.36 : 0), w * 0.26, 0.3, t, 0, sd.ry, 0);
          if (h > h1 + 0.3) add(GEO.box, m, x, h1 + 0.3 + (h - h1 - 0.3) / 2, z, w * 0.98, h - h1 - 0.3, t, 0, sd.ry, 0);
        } else {
          add(GEO.box, m, x, h1 + (h - h1) / 2, z, w * 0.98, h - h1, t, 0, sd.ry, (r() - 0.5) * 0.05);
        }
      }
    });
    // 角の柱
    for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const ph = H * (0.6 + r() * 0.5);
      add(GEO.box, this._mat(0x7d7066), cx * half, ph / 2, cz * half, 0.17, ph, 0.17);
    }
    // 落ちかけの屋根
    const roof = mixc(0x6e4b3a, this.an.palette[2] || tone.color, 0.25);
    add(GEO.box, this._mat(roof), -0.2, H * 0.55, 0.1, S * 0.75, 0.06, S * 0.9, 0, 0, 0.55);
    add(GEO.box, this._mat(roof.clone().offsetHSL(0, 0, 0.05)), 0.45, H * 0.9, -0.2, S * 0.45, 0.05, S * 0.6, 0.1, 0.2, -0.25);
    // 中のがれき
    for (let k = 0; k < 4; k++) add(GEO.box, this._mat(0x8f8a82), (r() - 0.5) * 1.1, 0.07, (r() - 0.5) * 1.1, 0.2 + r() * 0.2, 0.12, 0.2, 0, r() * 3, 0);
  }

  /**
   * ハンマーで叩く。power だけ HP を減らし、壊れ具合に応じてパーツを飛ばす。
   * 戻り値: 壊れたら true
   */
  hit(ob, power, fromPos, fx) {
    if (ob.dead) return false;
    ob.hp -= power;
    ob.shake = Math.min(1, ob.shake + 0.6);
    const ratio = 1 - Math.max(0, ob.hp) / ob.maxHp;
    const want = Math.floor(ratio * ob.chunks.length * 0.85);
    while (ob.flung < want && ob.flung < ob.chunks.length - 1) {
      fx.fling(ob.chunks[ob.flung++], ob.center);
    }
    if (ob.hp > 0) return false;

    // こわれた！
    ob.dead = true;
    while (ob.flung < ob.chunks.length) fx.fling(ob.chunks[ob.flung++], ob.center);
    this.group.remove(ob.group);
    for (const c of ob.cells) {
      this.grid[c.j * this.N + c.i] = null;
      this._makeTile(c.i, c.j);
    }
    this.clearedCells += ob.cells.length;
    return true;
  }

  /** 全部きれいになったら芝生とお花 */
  bloom() {
    const flowerCols = [0xff7aa2, 0xffd23f, 0xffffff, 0x9b8cff, 0xff9f43];
    const stem = this._mat(0x3f9b4a);
    const geoHead = new THREE.SphereGeometry(0.06, 8, 6);
    const geoStem = new THREE.CylinderGeometry(0.012, 0.012, 0.16, 5);
    this.disposables.push(geoHead, geoStem);
    this.tiles.forEach((tile, idx) => {
      const delay = (Math.abs(tile.position.x) + Math.abs(tile.position.z)) * 0.08;
      this.anims.push({ t: -delay, dur: 0.4, fn: (u) => {
        if (u > 0.5 && tile.material !== this.grassMats[idx % 2]) tile.material = this.grassMats[idx % 2];
        tile.scale.setScalar(1 + Math.sin(u * Math.PI) * 0.12);
      } });
      if (this.rng() < 0.55) {
        const f = new THREE.Group();
        const n = 1 + Math.floor(this.rng() * 3);
        for (let k = 0; k < n; k++) {
          const ox = (this.rng() - 0.5) * 0.7, oz = (this.rng() - 0.5) * 0.7;
          const s = new THREE.Mesh(geoStem, stem); s.position.set(ox, 0.08, oz);
          const h = new THREE.Mesh(geoHead, this._mat(flowerCols[Math.floor(this.rng() * flowerCols.length)], { flatShading: false, roughness: 0.6 }));
          h.position.set(ox, 0.17, oz); h.scale.set(1, 0.6, 1);
          f.add(s, h);
        }
        f.position.copy(tile.position);
        f.scale.setScalar(0.01);
        this.group.add(f);
        this.anims.push({ t: -delay - 0.3, dur: 0.5, fn: (u) => f.scale.setScalar(Math.max(0.01, easeOutBack(u))) });
      }
    });
  }

  update(dt) {
    this.time += dt;
    for (const ob of this.obstacles) {
      if (ob.dead || ob.shake <= 0) continue;
      ob.shake = Math.max(0, ob.shake - dt * 3.5);
      const s = ob.shake;
      ob.group.position.x = ob.center.x + Math.sin(this.time * 70) * 0.03 * s;
      ob.group.position.z = ob.center.z + Math.cos(this.time * 55) * 0.03 * s;
      ob.group.scale.set(1 + 0.06 * s, 1 - 0.1 * s, 1 + 0.06 * s);
    }
    for (let k = this.anims.length - 1; k >= 0; k--) {
      const a = this.anims[k];
      a.t += dt;
      if (a.t < 0) continue;
      const u = Math.min(1, a.t / a.dur);
      a.fn(u);
      if (u >= 1) this.anims.splice(k, 1);
    }
  }

  dispose() {
    this.group.removeFromParent();
    for (const d of this.disposables) d.dispose?.();
  }
}

export function easeOutBack(u) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
}
