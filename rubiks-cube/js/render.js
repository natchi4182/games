// three.js でキューブを描き、ドラッグで面を回す
import * as THREE from 'three';
import { STICKERS, parseMove, applyMove } from './cube.js';

export const STD_COLORS = ['#f4f4f0', '#e0262f', '#1aa34a', '#ffd21f', '#ff7a12', '#1f5fd6'];
const AXIS = ['x', 'y', 'z'];
const UNIT = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
const BASES = [
  { axis: 0, layer: 1, name: 'R', q: -1 }, { axis: 0, layer: -1, name: 'L', q: 1 }, { axis: 0, layer: 0, name: 'M', q: 1 },
  { axis: 1, layer: 1, name: 'U', q: -1 }, { axis: 1, layer: -1, name: 'D', q: 1 }, { axis: 1, layer: 0, name: 'E', q: 1 },
  { axis: 2, layer: 1, name: 'F', q: -1 }, { axis: 2, layer: -1, name: 'B', q: 1 }, { axis: 2, layer: 0, name: 'S', q: -1 },
];
function moveName(axis, layer, q) {
  const b = BASES.find((x) => x.axis === axis && x.layer === layer);
  q = ((q % 4) + 4) % 4;
  if (q === 0) return null;
  if (q === 2) return b.name + '2';
  const signed = q === 1 ? 1 : -1;
  return signed === b.q ? b.name : b.name + "'";
}

function roundedRect(size, r) {
  const s = new THREE.Shape(), h = size / 2;
  s.moveTo(-h + r, -h); s.lineTo(h - r, -h); s.quadraticCurveTo(h, -h, h, -h + r);
  s.lineTo(h, h - r); s.quadraticCurveTo(h, h, h - r, h); s.lineTo(-h + r, h);
  s.quadraticCurveTo(-h, h, -h, h - r); s.lineTo(-h, -h + r); s.quadraticCurveTo(-h, -h, -h + r, -h);
  return new THREE.ShapeGeometry(s, 4);
}
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class CubeView {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.6));
    const dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(4, 8, 6); this.scene.add(dl);
    const dl2 = new THREE.DirectionalLight(0xffffff, 0.5); dl2.position.set(-6, -3, -4); this.scene.add(dl2);

    this.root = new THREE.Group(); this.scene.add(this.root);
    this.theta = -0.62; this.phi = 0.5; this.offsetY = 0; // カメラの角度
    this.state = null; this.palette = STD_COLORS.slice();
    this.stickerMeshes = new Array(54);
    this.cubies = [];
    this.queue = []; this.busy = false; this.anim = null;
    this.enabled = true; // ドラッグで回せるか
    this.onMove = null; // (move) => void  ユーザーが回したとき
    this.speed = 1;
    this._build();
    this._bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    const loop = (t) => { this._tick(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  _build() {
    const body = new THREE.BoxGeometry(0.97, 0.97, 0.97);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x15161c, roughness: 0.55, metalness: 0.1 });
    const stickerGeo = roundedRect(0.84, 0.14);
    const map = new Map();
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      if (!x && !y && !z) continue;
      const g = new THREE.Group(); g.position.set(x, y, z);
      g.userData.home = [x, y, z];
      const m = new THREE.Mesh(body, bodyMat); m.userData.cubie = g; g.add(m);
      this.root.add(g); this.cubies.push(g); map.set([x, y, z].join(), g);
    }
    STICKERS.forEach((s, i) => {
      const g = map.get(s.pos.join());
      const mat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.32, metalness: 0.0 });
      const m = new THREE.Mesh(stickerGeo, mat);
      const n = new THREE.Vector3(...s.normal);
      m.position.copy(n.clone().multiplyScalar(0.487));
      m.lookAt(n.clone().multiplyScalar(2));
      m.userData.sticker = i; m.userData.cubie = g;
      g.add(m); this.stickerMeshes[i] = m;
    });
    this.pickables = [];
    this.root.traverse((o) => { if (o.isMesh) this.pickables.push(o); });
  }

  setPalette(p) { this.palette = p.slice(); this._paint(); }
  setState(state) {
    this._cancelAll();
    this.state = state.slice(); this._paint();
  }
  _paint() {
    if (!this.state) return;
    for (let i = 0; i < 54; i++) {
      const c = this.state[i];
      this.stickerMeshes[i].material.color.set(c >= 0 ? this.palette[c] : '#5c6070');
    }
  }
  _cancelAll() {
    if (this.anim) { this._resetPivot(); this.anim = null; }
    for (const q of this.queue) q.resolve(false);
    this.queue = []; this.busy = false; this.drag = null;
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px'; this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h;
    const vh = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const hh = Math.atan(Math.tan(vh) * this.camera.aspect);
    this.dist = (2.75 * (this.fitScale || 1)) / Math.sin(Math.min(vh, hh));
    this.camera.updateProjectionMatrix();
    this._placeCamera();
  }
  setFit(scale, offsetY) { this.fitScale = scale; this.offsetY = offsetY || 0; this.resize(); }
  _placeCamera() {
    const c = this.camera, r = this.dist;
    c.position.set(r * Math.cos(this.phi) * Math.sin(-this.theta), r * Math.sin(this.phi), r * Math.cos(this.phi) * Math.cos(this.theta));
    c.lookAt(0, 0, 0);
    // 画面の上下に UI があるぶん、少しずらす
    c.setViewOffset(1000, 1000, 0, -this.offsetY * 1000, 1000, 1000);
    c.updateProjectionMatrix();
  }
  resetView() { this.theta = -0.62; this.phi = 0.5; this._placeCamera(); }

  // ---- 手の実行 ----
  // アニメーション付きで回す。duration ms（speed で割る）
  play(move, duration = 260) {
    return new Promise((resolve) => {
      this.queue.push({ move, duration, resolve });
      this._next();
    });
  }
  playAll(moves, duration) { return moves.reduce((p, m) => p.then(() => this.play(m, duration)), Promise.resolve()); }
  get idle() { return !this.busy && !this.drag && this.queue.length === 0; }
  _next() {
    if (this.busy || this.drag || !this.queue.length) return;
    const item = this.queue.shift();
    const pm = parseMove(item.move);
    this.busy = true;
    this._makePivot(pm.axis, pm.layers);
    this.anim = { axis: pm.axis, from: 0, to: pm.q * Math.PI / 2, start: performance.now(), dur: item.duration / this.speed,
      done: () => { this.state = applyMove(this.state, item.move); this._resetPivot(); this._paint(); this.busy = false; item.resolve(true); this._next(); } };
  }
  _makePivot(axis, layers) {
    this.pivot = new THREE.Group(); this.root.add(this.pivot); this.pivotAxis = axis;
    for (const c of this.cubies) if (layers.includes(c.userData.home[axis])) this.pivot.attach(c);
  }
  _resetPivot() {
    if (!this.pivot) return;
    for (const c of this.cubies) {
      if (c.parent !== this.root) this.root.attach(c);
      c.position.set(...c.userData.home); c.rotation.set(0, 0, 0);
    }
    this.root.remove(this.pivot); this.pivot = null;
  }
  _tick(t) {
    if (this.autoSpin && !this.drag) { this.theta += 0.004; this._placeCamera(); }
    const a = this.anim;
    if (a) {
      const k = Math.min(1, (t - a.start) / Math.max(1, a.dur));
      if (this.pivot) this.pivot.rotation[AXIS[a.axis]] = a.from + (a.to - a.from) * ease(k);
      if (k >= 1) { this.anim = null; a.done(); }
    }
    this.renderer.render(this.scene, this.camera);
  }

  // ---- 入力 ----
  _bindInput() {
    const el = this.renderer.domElement;
    el.style.touchAction = 'none';
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    const toNdc = (e) => { const r = el.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); };
    const project = (v) => { const p = v.clone().project(this.camera); const r = el.getBoundingClientRect(); return new THREE.Vector2((p.x + 1) / 2 * r.width, (1 - p.y) / 2 * r.height); };
    let pointers = new Map();

    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size > 1) { if (this.drag && this.drag.kind === 'layer' && this.drag.axis == null) this.drag = { kind: 'orbit', x: e.clientX, y: e.clientY }; return; }
      if (this.drag) return;
      let hit = null;
      if (this.enabled && !this.busy && this.queue.length === 0 && this.state) {
        toNdc(e); ray.setFromCamera(ndc, this.camera);
        const hits = ray.intersectObjects(this.pickables, false);
        if (hits.length) hit = hits[0];
      }
      if (hit) {
        const cubie = hit.object.userData.cubie;
        let n;
        if (hit.object.userData.sticker != null) n = STICKERS[hit.object.userData.sticker].normal;
        else { const fn = hit.face.normal; n = [Math.round(fn.x), Math.round(fn.y), Math.round(fn.z)]; }
        const home = cubie.userData.home;
        const nAxis = n.findIndex((v) => v !== 0);
        if (home[nAxis] * n[nAxis] <= 0) hit = null; // 内側の面
        else this.drag = { kind: 'layer', x: e.clientX, y: e.clientY, point: hit.point.clone(), normal: nAxis, home, axis: null };
      }
      if (!hit) this.drag = { kind: 'orbit', x: e.clientX, y: e.clientY };
    });
    el.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      const prev = pointers.get(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const d = this.drag; if (!d) return;
      if (d.kind === 'orbit') {
        const s = 0.008;
        this.theta += (e.clientX - prev.x) * s;
        this.phi = Math.max(-1.35, Math.min(1.35, this.phi + (e.clientY - prev.y) * s));
        this._placeCamera(); return;
      }
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (d.axis == null) {
        if (Math.hypot(dx, dy) < 10) return;
        const drag = new THREE.Vector2(dx, dy).normalize();
        let best = null;
        for (let a = 0; a < 3; a++) {
          if (a === d.normal) continue;
          const tangent = new THREE.Vector3().crossVectors(UNIT[a], d.point);
          if (tangent.lengthSq() < 1e-4) continue;
          const p0 = project(d.point), p1 = project(d.point.clone().add(tangent.normalize().multiplyScalar(0.6)));
          const sdir = p1.sub(p0); const len = sdir.length(); if (len < 1e-3) continue;
          sdir.divideScalar(len);
          const dot = drag.dot(sdir);
          if (!best || Math.abs(dot) > Math.abs(best.dot)) best = { a, dot, sdir, pxPerRad: len / 0.6 * 1.5 };
        }
        if (!best) { this.drag = { kind: 'orbit', x: e.clientX, y: e.clientY }; return; }
        d.axis = best.a; d.sdir = best.sdir; d.pxPerRad = Math.max(60, best.pxPerRad);
        d.layer = d.home[d.axis];
        this._makePivot(d.axis, [d.layer]);
      }
      const along = dx * d.sdir.x + dy * d.sdir.y;
      d.angle = along / d.pxPerRad;
      this.pivot.rotation[AXIS[d.axis]] = d.angle;
    });
    const end = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      const d = this.drag; if (!d || pointers.size > 0) return;
      this.drag = null;
      if (d.kind !== 'layer' || d.axis == null) { this._next(); return; }
      const angle = d.angle || 0;
      let q = Math.round(angle / (Math.PI / 2));
      // 少しでも勢いよく回したら 1/4 回転にする
      if (q === 0 && Math.abs(angle) > 0.38) q = Math.sign(angle);
      q = Math.max(-2, Math.min(2, q));
      const name = moveName(d.axis, d.layer, q);
      this.busy = true;
      this.anim = { axis: d.axis, from: angle, to: q * Math.PI / 2, start: performance.now(), dur: 140,
        done: () => {
          if (name) this.state = applyMove(this.state, name);
          this._resetPivot(); this._paint(); this.busy = false;
          if (name && this.onMove) this.onMove(name);
          this._next();
        } };
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => { e.preventDefault(); this.theta += e.deltaX * 0.004; this.phi = Math.max(-1.35, Math.min(1.35, this.phi + e.deltaY * 0.004)); this._placeCamera(); }, { passive: false });
  }
}
