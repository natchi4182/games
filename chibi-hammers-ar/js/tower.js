// 整地したあとに建てる「伝説の塔」。放置していると天井（屋外なら天まで）伸び続ける
import * as THREE from 'three';

// 5 階ごとに様式が変わる
export const STYLES = [
  { name: '石の土台', kind: 'block', body: 0x9c9488, trim: 0x6e675e, roof: 0x7d756b, accent: 0xc9c2b5 },
  { name: '和風の楼閣', kind: 'pagoda', body: 0xf3eadb, trim: 0xb8362c, roof: 0x34404c, accent: 0xe2b13c },
  { name: '洋風の城', kind: 'castle', body: 0xd9d2c3, trim: 0x8a7f70, roof: 0x3f6fb5, accent: 0xf2c94c },
  { name: '時計塔', kind: 'clock', body: 0xb5653d, trim: 0xe8dcc4, roof: 0x2f5d50, accent: 0xf5f0e0 },
  { name: '空中庭園', kind: 'garden', body: 0xe6e0d0, trim: 0xa7b59a, roof: 0x5aa05a, accent: 0xff8fb1 },
  { name: '天空の神殿', kind: 'temple', body: 0xfaf7ef, trim: 0xd8c690, roof: 0xf3d36b, accent: 0x8fd3ff },
  { name: '星の尖塔', kind: 'crystal', body: 0x6b5bd6, trim: 0xb7a8ff, roof: 0xffe680, accent: 0x9ff3ff },
];
const FLOORS_PER_STYLE = 5;
const GROW = 1.004;          // 上の階ほど少しずつ大きくなる（放置で加速する）
const CHUNK = 10;            // 完成した階を何階ずつまとめて描くか

// 高さの節目（屋外向け）
export const MILESTONES = [
  [1, '1m 突破！'],
  [1.8, '人の背たけを超えた！'],
  [5, 'キリンの高さ（約5m）'],
  [15, '奈良の大仏の高さ（約15m）'],
  [93, '自由の女神（台座込み 約93m）'],
  [333, '東京タワー（333m）'],
  [634, '東京スカイツリー（634m）'],
  [828, 'ブルジュ・ハリファ（828m）'],
  [3776, '富士山（3776m）'],
  [8849, 'エベレスト（8849m）'],
  [10000, '飛行機の高さ（約1万m）'],
  [100000, '宇宙に到達！（100km）'],
  [400000, '国際宇宙ステーション（約400km）'],
  [384400000, '月に到達！'],
];

// 単位形状（位置・大きさは行列で変える）
const GEO = {
  box: () => new THREE.BoxGeometry(1, 1, 1),
  cyl: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
  cone: () => new THREE.ConeGeometry(0.5, 1, 10),
  pyramid: () => new THREE.ConeGeometry(0.5, 1, 4).rotateY(Math.PI / 4),
  sphere: () => new THREE.SphereGeometry(0.5, 10, 8),
  ico: () => new THREE.IcosahedronGeometry(0.5, 0),
  octa: () => new THREE.OctahedronGeometry(0.5, 0),
};

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _c = new THREE.Color();

/** 部品 1 個を、頂点色つき・位置変換済みのジオメトリにする */
function partGeometry(p) {
  let g = GEO[p.t]();
  g = g.index ? g.toNonIndexed() : g;
  _q.setFromEuler(_e.set(p.rx || 0, p.ry || 0, p.rz || 0));
  _m.compose(new THREE.Vector3(p.x, p.y, p.z), _q, new THREE.Vector3(p.sx, p.sy, p.sz));
  g.applyMatrix4(_m);
  _c.set(p.c);
  const n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}

/** 頂点色つきの非インデックスジオメトリを 1 つにまとめる */
function mergeGeometries(list) {
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

export class Tower {
  constructor(root, seed = 1) {
    this.root = root;
    this.group = new THREE.Group();
    root.add(this.group);
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.75 });
    this.floors = [];          // { y, h, w, geo, mesh }
    this.chunks = [];
    this.topY = 0;             // いちばん上の床の高さ（盤面ローカル）
    this.building = null;      // 建設中の階
    this.rng = seed;
    this.anims = [];
    this.done = false;
    // 足場（ちびたちが乗る輪）
    this.scaffold = new THREE.Group();
    const plank = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 6, 40).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xa07850, roughness: 0.9 }));
    plank.scale.set(1, 1, 1);
    this.scaffold.add(plank);
    this.scaffoldRing = plank;
    this.group.add(this.scaffold);
    this.scaffoldY = 0;
    this._startFloor();
  }

  _rand() { this.rng = (this.rng * 16807) % 2147483647; return this.rng / 2147483647; }

  get floorCount() { return this.floors.length; }
  styleOf(k) {
    const s = STYLES[Math.floor(k / FLOORS_PER_STYLE) % STYLES.length];
    const cycle = Math.floor(k / (FLOORS_PER_STYLE * STYLES.length));
    if (!cycle) return s;
    // 2 周目以降は少し色を変える
    const shift = (c) => new THREE.Color(c).offsetHSL(cycle * 0.11, 0, 0).getHex();
    return { ...s, body: shift(s.body), trim: shift(s.trim), roof: shift(s.roof), accent: shift(s.accent) };
  }

  /** k 階を建てるのに必要な力 */
  costOf(k) { return 8 * Math.pow(1.015, k); }
  /** k 階のコイン */
  rewardOf(k) { return Math.round(6 * Math.pow(1.012, k)); }
  sizeOf(k) {
    const g = Math.pow(GROW, k);
    const w = 3.2 * g * (0.9 + 0.1 * Math.cos(k * 0.9)) * (1 - 0.035 * (k % FLOORS_PER_STYLE));
    const kindH = { block: 1.0, pagoda: 0.95, castle: 1.15, clock: 1.25, garden: 0.85, temple: 1.1, crystal: 1.2 };
    const h = 1.05 * g * (kindH[this.styleOf(k).kind] || 1);
    return { w, h, g };
  }
  /** 次の階の高さ */
  nextFloorHeight() { return this.sizeOf(this.floors.length).h; }

  _startFloor(maxH = Infinity) {
    const k = this.floors.length;
    const st = this.styleOf(k);
    const sz = this.sizeOf(k);
    const h = Math.min(sz.h, maxH);
    const parts = buildParts(st, sz.w, h, () => this._rand());
    // 下から順に積み上がるように並べる
    parts.sort((a, b) => (a.y - a.sy / 2) - (b.y - b.sy / 2));
    this.building = { k, st, w: sz.w, h, scale: sz.g, parts, shown: 0, progress: 0, cost: this.costOf(k), meshes: [] };
  }

  /** ちびのハンマー 1 発ぶん。完成した階があればその情報を返す */
  addProgress(power) {
    const b = this.building;
    if (!b || this.done) return null;
    b.progress = Math.min(1, b.progress + power / b.cost);
    // 進み具合に合わせて部品をぽんぽん出す
    const want = Math.floor(b.progress * b.parts.length);
    while (b.shown < want) this._showPart(b.parts[b.shown++]);
    if (b.progress < 1) return null;
    return this._completeFloor();
  }

  _showPart(p) {
    const b = this.building;
    const g = partGeometry(p);
    const m = new THREE.Mesh(g, this.mat);
    m.position.y = this.topY;
    m.castShadow = this.floors.length < 8;
    m.scale.setScalar(0.01);
    this.group.add(m);
    b.meshes.push(m);
    this.anims.push({ t: 0, dur: 0.35, fn: (u) => {
      const s = 1 + Math.sin(u * Math.PI) * 0.25 * (1 - u);
      m.scale.setScalar(Math.max(0.01, Math.min(1, u * 1.6)) * s);
    } });
  }

  _completeFloor() {
    const b = this.building;
    while (b.shown < b.parts.length) this._showPart(b.parts[b.shown++]);
    // 部品をまとめて 1 つの形にする
    const geo = mergeGeometries(b.parts.map(partGeometry));
    for (const m of b.meshes) { this.group.remove(m); m.geometry.dispose(); }
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.position.y = this.topY;
    mesh.castShadow = this.floors.length < 8;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    const floor = { k: b.k, y: this.topY, h: b.h, w: b.w, geo, mesh, style: b.st };
    this.floors.push(floor);
    this.topY += b.h;
    this._maybeChunk();
    const info = { k: b.k, style: b.st, styleChanged: b.k % FLOORS_PER_STYLE === 0, top: this.topY, reward: this.rewardOf(b.k) };
    this.building = null;
    return info;
  }

  /** 次の階を始める。maxH を超える場合は天井まで（最後の階） */
  startNext(maxH = Infinity) {
    if (this.done) return;
    this._startFloor(maxH);
  }

  // 完成した階を CHUNK 階ずつ 1 つの形にまとめて、描く数を減らす
  _maybeChunk() {
    const n = this.floors.length;
    if (n % CHUNK !== 0) return;
    const fl = this.floors.slice(n - CHUNK);
    const geos = fl.map((f) => f.geo.clone().translate(0, f.y, 0));
    const geo = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    for (const f of fl) { this.group.remove(f.mesh); f.geo.dispose(); f.geo = null; f.mesh = null; }
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.castShadow = n <= CHUNK;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.chunks.push(mesh);
  }

  /** ちびたちが乗る足場の半径と高さ */
  get workRadius() { return (this.building ? this.building.w : this.sizeOf(this.floors.length).w) / 2 + 0.6 * this.workScale; }
  get workScale() { return this.building ? this.building.scale : Math.pow(GROW, this.floors.length); }

  update(dt) {
    // 足場をいまの作業高さへ
    this.scaffoldY += (this.topY - this.scaffoldY) * Math.min(1, dt * 3);
    this.scaffold.position.y = this.scaffoldY + 0.02;
    const r = this.workRadius;
    this.scaffoldRing.scale.set(r, this.workScale, r);
    this.scaffold.visible = !this.done;
    for (let k = this.anims.length - 1; k >= 0; k--) {
      const a = this.anims[k];
      a.t += dt;
      const u = Math.min(1, a.t / a.dur);
      a.fn(u);
      if (u >= 1) this.anims.splice(k, 1);
    }
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.mat.dispose();
  }
}

// ---------------------------------------------------------------------------
// 階のデザイン（部品のリスト）。y=0 がその階の床、h が天井
// ---------------------------------------------------------------------------
function buildParts(st, w, h, rnd) {
  const P = [];
  const add = (t, x, y, z, sx, sy, sz, c, extra = {}) => P.push({ t, x, y, z, sx, sy, sz, c, ...extra });
  const slab = Math.max(0.06, h * 0.08);
  add('box', 0, slab / 2, 0, w, slab, w, st.trim);                    // 床板
  const corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const ring = (n, r, f) => { for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; f(Math.cos(a) * r, Math.sin(a) * r, a, i); } };
  const windows = (core, y0, color) => {
    for (const [dx, dz, ry] of [[0, 1, 0], [0, -1, 0], [1, 0, Math.PI / 2], [-1, 0, Math.PI / 2]]) {
      for (const off of [-0.22, 0.22]) {
        add('box', dx * core / 2 + (dz ? off * core : 0), y0, dz * core / 2 + (dx ? off * core : 0), core * 0.14, h * 0.22, 0.04, color, { ry });
      }
    }
  };
  switch (st.kind) {
    case 'block': {
      const core = w * 0.82;
      add('box', 0, slab + (h - slab * 2) / 2, 0, core, h - slab * 2, core, st.body);
      for (const [cx, cz] of corners) add('box', cx * w * 0.44, h / 2, cz * w * 0.44, w * 0.14, h, w * 0.14, st.trim);
      add('box', 0, h - slab / 2, 0, w * 0.96, slab, w * 0.96, st.roof);
      windows(core, h * 0.5, 0x3a3530);
      break;
    }
    case 'pagoda': {
      const core = w * 0.66;
      add('box', 0, slab + (h * 0.62) / 2, 0, core, h * 0.62, core, st.body);
      ring(8, w * 0.42, (x, z) => add('cyl', x, slab + h * 0.31, z, w * 0.05, h * 0.62, w * 0.05, st.trim));
      add('box', 0, slab + h * 0.1, 0, w * 0.9, h * 0.04, w * 0.9, st.trim);          // 手すり
      add('pyramid', 0, h * 0.78, 0, w * 1.45, h * 0.32, w * 1.45, st.roof);           // 大屋根
      for (const [cx, cz] of corners) add('box', cx * w * 0.66, h * 0.66, cz * w * 0.66, w * 0.07, h * 0.12, w * 0.07, st.accent, { rx: cz * 0.5, rz: -cx * 0.5 });
      add('box', 0, h - slab / 2, 0, core * 0.95, slab, core * 0.95, st.roof);
      break;
    }
    case 'castle': {
      const core = w * 0.74;
      add('box', 0, h * 0.45, 0, core, h * 0.9, core, st.body);
      for (const [cx, cz] of corners) {
        add('cyl', cx * w * 0.4, h * 0.5, cz * w * 0.4, w * 0.24, h, w * 0.24, st.trim);
        add('cone', cx * w * 0.4, h + h * 0.22, cz * w * 0.4, w * 0.3, h * 0.45, w * 0.3, st.roof);
      }
      for (let i = -2; i <= 2; i++) {
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (i % 2) add('box', dx * core / 2 + (dz ? i * core * 0.18 : 0), h * 0.95, dz * core / 2 + (dx ? i * core * 0.18 : 0), core * 0.12, h * 0.1, core * 0.12, st.trim);
        }
      }
      add('box', 0, h - slab / 2, 0, core, slab, core, st.accent);
      windows(core, h * 0.55, 0x2d3b55);
      break;
    }
    case 'clock': {
      const core = w * 0.72;
      add('box', 0, slab + (h * 0.8) / 2, 0, core, h * 0.8, core, st.body);
      for (const [cx, cz] of corners) add('box', cx * core * 0.5, slab + h * 0.4, cz * core * 0.5, w * 0.08, h * 0.8, w * 0.08, st.trim);
      for (const [dx, dz, ry] of [[0, 1, 0], [0, -1, 0], [1, 0, Math.PI / 2], [-1, 0, Math.PI / 2]]) {
        add('cyl', dx * (core / 2 + 0.02), h * 0.55, dz * (core / 2 + 0.02), core * 0.5, 0.05, core * 0.5, st.accent, { rx: Math.PI / 2, rz: ry });
        add('box', dx * (core / 2 + 0.06), h * 0.6, dz * (core / 2 + 0.06), core * 0.03, core * 0.2, core * 0.03, 0x222222, { ry });
        add('box', dx * (core / 2 + 0.06), h * 0.55, dz * (core / 2 + 0.06), core * 0.15, core * 0.03, core * 0.03, 0x222222, { ry });
      }
      add('pyramid', 0, h * 0.9, 0, core * 1.2, h * 0.2, core * 1.2, st.roof);
      break;
    }
    case 'garden': {
      const core = w * 0.5;
      add('box', 0, slab + h * 0.3, 0, core, h * 0.6, core, st.body);
      add('box', 0, slab + 0.05, 0, w * 0.95, 0.1, w * 0.95, st.roof);                  // 芝生
      ring(4, w * 0.36, (x, z) => {
        add('cyl', x, slab + h * 0.2, z, w * 0.05, h * 0.4, w * 0.05, 0x7a5a3a);
        add('ico', x, slab + h * 0.5, z, w * 0.24, w * 0.22, w * 0.24, st.roof);
      });
      for (let i = 0; i < 10; i++) {
        const a = rnd() * Math.PI * 2, r = w * (0.3 + rnd() * 0.15);
        add('sphere', Math.cos(a) * r, slab + 0.12, Math.sin(a) * r, 0.12, 0.08, 0.12, [st.accent, 0xffe066, 0xffffff][i % 3]);
      }
      ring(4, w * 0.47, (x, z, a) => add('box', x, slab + h * 0.15, z, w * 0.5, h * 0.06, 0.06, st.trim, { ry: -a + Math.PI / 2 }));
      add('box', 0, h - slab / 2, 0, core * 1.1, slab, core * 1.1, st.trim);
      break;
    }
    case 'temple': {
      add('box', 0, slab + 0.05, 0, w * 0.9, 0.1, w * 0.9, st.trim);                    // 階段
      ring(10, w * 0.4, (x, z) => add('cyl', x, slab + h * 0.4, z, w * 0.09, h * 0.8, w * 0.09, st.body));
      add('box', 0, slab + h * 0.4, 0, w * 0.45, h * 0.8, w * 0.45, st.accent);
      add('box', 0, h - slab, 0, w * 0.98, slab * 2, w * 0.98, st.roof);
      break;
    }
    case 'crystal': {
      add('box', 0, slab + h * 0.4, 0, w * 0.5, h * 0.8, w * 0.5, st.body);
      ring(6, w * 0.38, (x, z, a, i) => add('octa', x, slab + h * (0.35 + (i % 2) * 0.15), z, w * 0.18, h * 0.6, w * 0.18, i % 2 ? st.accent : st.trim, { ry: a }));
      add('octa', 0, h * 0.9, 0, w * 0.4, h * 0.3, w * 0.4, st.roof);
      add('box', 0, h - slab / 2, 0, w * 0.7, slab, w * 0.7, st.trim);
      break;
    }
  }
  return P;
}
