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
const GROW = 1.004;          // 上の階ほど少しずつ大きくなる
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
    this.floors = [];          // 完成した階 { k, y, h, w, mesh }
    this.chunks = [];
    this.topY = 0;             // いちばん上の床の高さ（盤面ローカル）
    this.building = null;      // 建設中（階 or 天井のマス）
    this.rng = seed;
    this.anims = [];
    this.phase = 'tower';      // tower → canopy（天井に届いたら横へ広げる）
    // 天井
    this.ceilY = null;
    this.wall = null;          // { px, pz, nx, nz } この平面の向こうには広げない
    this.cells = [];           // 完成した天井のマス
    this.cellQueue = [];
    this.ring = 0;
    this.cellSize = 1.5;
    // 足場（ちびたちが乗る輪）
    this.scaffold = new THREE.Group();
    this.scaffoldRing = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.06, 6, 40).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xa07850, roughness: 0.9 }),
    );
    this.scaffold.add(this.scaffoldRing);
    this.group.add(this.scaffold);
    this.work = { x: 0, y: 0, z: 0, r: 1, s: 1 };   // いまの作業場所（なめらかに追従）
    this._startFloor();
    this._snapWork();
  }

  _rand() { this.rng = (this.rng * 16807) % 2147483647; return this.rng / 2147483647; }

  get floorCount() { return this.floors.length; }
  get cellCount() { return this.cells.length; }
  /** 天井を埋めた広さ（盤面ローカルの面積） */
  get canopyArea() { return this.cells.length * this.cellSize * this.cellSize; }

  styleOf(k) {
    const s = STYLES[Math.floor(k / FLOORS_PER_STYLE) % STYLES.length];
    const cycle = Math.floor(k / (FLOORS_PER_STYLE * STYLES.length));
    if (!cycle) return s;
    // 2 周目以降は少し色を変える
    const shift = (c) => new THREE.Color(c).offsetHSL(cycle * 0.11, 0, 0).getHex();
    return { ...s, body: shift(s.body), trim: shift(s.trim), roof: shift(s.roof), accent: shift(s.accent) };
  }

  /** k 階の大きさ。土台は整地した土地いっぱい、上に行くほどゆるやかに細くなる */
  sizeOf(k) {
    const g = Math.pow(GROW, k);
    const taper = 0.72 + 0.28 * Math.exp(-k / 14);
    const w = 6.2 * g * taper * (0.95 + 0.05 * Math.cos(k * 0.9)) * (1 - 0.025 * (k % FLOORS_PER_STYLE));
    const kindH = { block: 1.0, pagoda: 0.95, castle: 1.15, clock: 1.25, garden: 0.85, temple: 1.1, crystal: 1.2 };
    const h = 1.5 * g * (kindH[this.styleOf(k).kind] || 1);
    return { w, h, g };
  }
  /** 建てるのに必要な作業量は、階の体積に比例（太い階ほど時間がかかる） */
  costOf(w, h, k) { return 2.2 * w * w * h * Math.pow(1.01, k); }
  rewardOf(k) { return Math.round(12 * Math.pow(1.012, k)); }
  nextFloorHeight() { return this.sizeOf(this.floors.length).h; }

  _startFloor(maxH = Infinity) {
    const k = this.floors.length;
    const st = this.styleOf(k);
    const sz = this.sizeOf(k);
    const h = Math.min(sz.h, maxH);
    const parts = buildParts(st, sz.w, h, () => this._rand());
    parts.sort((a, b) => (a.y - a.sy / 2) - (b.y - b.sy / 2));   // 下から積み上がる
    this.building = {
      kind: 'floor', k, st, w: sz.w, h, scale: sz.g, parts, shown: 0, progress: 0,
      cost: this.costOf(sz.w, h, k), meshes: [], ox: 0, oy: this.topY, oz: 0,
    };
  }

  /** ちびのハンマー 1 発ぶん。完成したらその情報を返す */
  addProgress(power) {
    const b = this.building;
    if (!b) return null;
    b.progress = Math.min(1, b.progress + power / b.cost);
    const want = Math.floor(b.progress * b.parts.length);
    while (b.shown < want) this._showPart(b.parts[b.shown++]);
    if (b.progress < 1) return null;
    return b.kind === 'floor' ? this._completeFloor() : this._completeCell();
  }

  _showPart(p) {
    const b = this.building;
    const m = new THREE.Mesh(partGeometry(p), this.mat);
    m.position.set(b.ox, b.oy, b.oz);
    m.castShadow = b.kind === 'floor' && this.floors.length < 8;
    m.scale.setScalar(0.01);
    this.group.add(m);
    b.meshes.push(m);
    this.anims.push({ t: 0, dur: 0.35, fn: (u) => {
      m.scale.setScalar(Math.max(0.01, Math.min(1, u * 1.6)) * (1 + Math.sin(u * Math.PI) * 0.25 * (1 - u)));
    } });
  }

  // 部品をまとめて 1 つの形にする
  _finishMesh(b) {
    while (b.shown < b.parts.length) this._showPart(b.parts[b.shown++]);
    const geo = mergeGeometries(b.parts.map(partGeometry));
    for (const m of b.meshes) { this.group.remove(m); m.geometry.dispose(); }
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.position.set(b.ox, b.oy, b.oz);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  _completeFloor() {
    const b = this.building;
    const mesh = this._finishMesh(b);
    mesh.castShadow = this.floors.length < 8;
    this.floors.push({ k: b.k, y: this.topY, h: b.h, w: b.w, mesh, style: b.st });
    this.topY += b.h;
    this._chunk(this.floors, CHUNK);
    this.building = null;
    return { kind: 'floor', k: b.k, style: b.st, styleChanged: b.k % FLOORS_PER_STYLE === 0, reward: this.rewardOf(b.k) };
  }

  /** 次の階を始める。maxH を超える場合は天井まで（最後の階） */
  startNext(maxH = Infinity) {
    if (this.phase === 'tower') this._startFloor(maxH);
    else this._startCell();
  }

  // ---- 天井に届いたら、天井に沿って横へ広げる ----
  /**
   * @param ceilY  天井の高さ（盤面ローカル）
   * @param wall   壁（盤面ローカル）{ px, pz, nx, nz }。n は部屋の内側向き。無ければ null
   */
  startCanopy(ceilY, wall) {
    this.phase = 'canopy';
    this.ceilY = ceilY;
    this.wall = wall;
    const topW = this.floors.length ? this.floors[this.floors.length - 1].w : 4;
    this.cellSize = Math.max(1.2, topW / 3);
    this.ring = Math.ceil((topW / 2) / this.cellSize);
    this.cellQueue = [];
    this._startCell();
  }

  _nextCellPos() {
    let guard = 0;
    while (!this.cellQueue.length && guard++ < 40) {
      this.ring++;
      const r = this.ring, list = [];
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
        const x = i * this.cellSize, z = j * this.cellSize;
        // 壁の向こうには広げない
        if (this.wall && (x - this.wall.px) * this.wall.nx + (z - this.wall.pz) * this.wall.nz < this.cellSize * 0.5) continue;
        list.push({ x, z, a: Math.atan2(z, x) });
      }
      list.sort((p, q) => p.a - q.a);
      this.cellQueue.push(...list);
    }
    return this.cellQueue.shift() || null;
  }

  _startCell() {
    const pos = this._nextCellPos();
    if (!pos) { this.building = null; return; }
    const n = this.cells.length;
    const st = this.styleOf(Math.floor(this.ring * 1.5) + this.floors.length);
    const c = this.cellSize, g = this.sizeOf(this.floors.length).g;
    const parts = buildCeilingParts(st, c, () => this._rand());
    parts.sort((a, b) => (b.y + b.sy / 2) - (a.y + a.sy / 2));   // 天井側から下へ
    this.building = {
      kind: 'cell', k: n, st, w: c, h: c, scale: g, parts, shown: 0, progress: 0,
      cost: 30 * Math.pow(1.012, n) * (c / 1.5) ** 2, meshes: [], ox: pos.x, oy: this.ceilY, oz: pos.z,
    };
  }

  _completeCell() {
    const b = this.building;
    const mesh = this._finishMesh(b);
    this.cells.push({ x: b.ox, z: b.oz, mesh });
    this._chunk(this.cells, 16);
    this.building = null;
    return { kind: 'cell', k: b.k, style: b.st, reward: Math.round(10 * Math.pow(1.01, b.k)) };
  }

  // 完成したものを n 個ずつ 1 つの形にまとめて、描く数を減らす
  _chunk(list, n) {
    if (list.length % n !== 0) return;
    const items = list.slice(list.length - n);
    const geos = items.map((it) => it.mesh.geometry.clone().translate(it.mesh.position.x, it.mesh.position.y, it.mesh.position.z));
    const geo = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    for (const it of items) { this.group.remove(it.mesh); it.mesh.geometry.dispose(); it.mesh = null; }
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.castShadow = list === this.floors && list.length <= CHUNK;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.chunks.push(mesh);
  }

  /** いまの作業場所（ちびたちが乗る足場の中心・高さ・半径） */
  _workTarget() {
    const b = this.building;
    if (this.phase === 'canopy') {
      const x = b ? b.ox : this.work.x, z = b ? b.oz : this.work.z;
      const s = this.sizeOf(this.floors.length).g;
      return { x, z, y: this.ceilY - this.cellSize * 0.9 - 1.0 * s, r: this.cellSize * 0.75, s };
    }
    const sz = b ? { w: b.w, g: b.scale } : this.sizeOf(this.floors.length);
    return { x: 0, z: 0, y: this.topY, r: sz.w / 2 + 0.6 * sz.g, s: sz.g };
  }
  _snapWork() { Object.assign(this.work, this._workTarget()); }

  get workRadius() { return this.work.r; }
  get workScale() { return this.work.s; }
  get workCenter() { return this.work; }
  get scaffoldY() { return this.work.y; }

  update(dt) {
    const t = this._workTarget(), k = Math.min(1, dt * 2.5);
    for (const key of ['x', 'y', 'z', 'r', 's']) this.work[key] += (t[key] - this.work[key]) * k;
    this.scaffold.position.set(this.work.x, this.work.y + 0.02, this.work.z);
    this.scaffoldRing.scale.set(this.work.r, this.work.s, this.work.r);
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i];
      a.t += dt;
      const u = Math.min(1, a.t / a.dur);
      a.fn(u);
      if (u >= 1) this.anims.splice(i, 1);
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

// 天井からぶら下がる「天井の街」のマス。y=0 が天井、下向きに作る
function buildCeilingParts(st, c, rnd) {
  const P = [];
  const add = (t, x, y, z, sx, sy, sz, col, extra = {}) => P.push({ t, x, y, z, sx, sy, sz, c: col, ...extra });
  const slab = c * 0.16;
  add('box', 0, -slab / 2, 0, c * 0.98, slab, c * 0.98, st.trim);                 // 天井に張りつく板
  add('box', 0, -slab - 0.02, 0, c * 0.9, 0.04, c * 0.9, st.body);
  const kind = Math.floor(rnd() * 4);
  if (kind === 0) {
    // さかさまの家
    add('box', 0, -slab - c * 0.22, 0, c * 0.5, c * 0.4, c * 0.5, st.body);
    add('pyramid', 0, -slab - c * 0.55, 0, c * 0.7, c * 0.3, c * 0.7, st.roof, { rx: Math.PI });
    add('box', 0, -slab - c * 0.2, c * 0.26, c * 0.12, c * 0.16, 0.03, 0x3a3530);
  } else if (kind === 1) {
    // ちょうちん
    for (const [dx, dz] of [[-0.25, -0.25], [0.25, 0.25], [0.25, -0.25]]) {
      const len = c * (0.25 + rnd() * 0.25);
      add('cyl', dx * c, -slab - len / 2, dz * c, 0.03, len, 0.03, 0x5a4636);
      add('sphere', dx * c, -slab - len - c * 0.1, dz * c, c * 0.2, c * 0.26, c * 0.2, st.accent);
    }
  } else if (kind === 2) {
    // さかさまの木
    add('cyl', 0, -slab - c * 0.2, 0, c * 0.08, c * 0.4, c * 0.08, 0x7a5a3a);
    add('ico', 0, -slab - c * 0.5, 0, c * 0.5, c * 0.4, c * 0.5, st.roof);
  } else {
    // 回廊（アーチ）
    add('box', -c * 0.35, -slab - c * 0.25, 0, c * 0.1, c * 0.5, c * 0.1, st.body);
    add('box', c * 0.35, -slab - c * 0.25, 0, c * 0.1, c * 0.5, c * 0.1, st.body);
    add('box', 0, -slab - c * 0.52, 0, c * 0.85, c * 0.08, c * 0.2, st.roof);
  }
  return P;
}
