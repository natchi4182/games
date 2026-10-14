// パーティクル・飛び散る破片・土けむり・浮かぶ文字
import * as THREE from 'three';

const GRAV = -14;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();

function softDotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.5, 'rgba(255,255,255,.6)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Fx {
  constructor(root) {
    this.root = root;
    // --- 破片（InstancedMesh 1 個で全部描く）---
    this.max = 360;
    this.debris = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true }),
      this.max,
    );
    this.debris.frustumCulled = false;
    this.debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.debris.setColorAt(0, new THREE.Color());
    this.parts = [];
    for (let i = 0; i < this.max; i++) {
      this.parts.push({ life: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Vector3(), spin: new THREE.Vector3(), size: 0.05, grav: GRAV });
      this.debris.setMatrixAt(i, _m.makeScale(0, 0, 0));
    }
    this.cursor = 0;
    root.add(this.debris);

    // --- 土けむり ---
    this.dotTex = softDotTexture();
    this.dust = [];
    for (let i = 0; i < 48; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.dotTex, transparent: true, depthWrite: false, color: 0xd9c7a8 }));
      sp.visible = false;
      root.add(sp);
      this.dust.push({ sp, life: 0, max: 1, vel: new THREE.Vector3(), s0: 0.2, s1: 0.6 });
    }
    this.dustCursor = 0;

    // --- 衝撃リング ---
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.7, 1, 32).rotateX(-Math.PI / 2);
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
      m.visible = false;
      root.add(m);
      this.rings.push({ m, life: 0, size: 1 });
    }
    this.ringCursor = 0;

    // --- 文字 ---
    this.texCache = new Map();
    this.texts = [];
    // --- 飛んでいくチャンク（障害物のパーツ）---
    this.chunks = [];
  }

  burst(pos, color, count = 8, power = 1, opts = {}) {
    const col = new THREE.Color(color);
    for (let k = 0; k < count; k++) {
      const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
      const p = this.parts[i];
      p.life = 0.9 + Math.random() * 0.6;
      p.pos.copy(pos).add(_p.set((Math.random() - 0.5) * 0.15, Math.random() * 0.1, (Math.random() - 0.5) * 0.15));
      const a = Math.random() * Math.PI * 2, sp = (0.6 + Math.random() * 1.6) * power;
      p.vel.set(Math.cos(a) * sp, (1.5 + Math.random() * 2.5) * power, Math.sin(a) * sp);
      p.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      p.spin.set((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16);
      p.size = (opts.size || 0.05) * (0.5 + Math.random());
      p.grav = opts.grav ?? GRAV;
      if (opts.rainbow) col.setHSL(Math.random(), 0.85, 0.6);
      else col.set(color).offsetHSL(0, 0, (Math.random() - 0.5) * 0.15);
      this.debris.setColorAt(i, col);
    }
    this.debris.instanceColor.needsUpdate = true;
  }

  puff(pos, count = 4, scale = 1, color = 0xd9c7a8) {
    for (let k = 0; k < count; k++) {
      const d = this.dust[this.dustCursor]; this.dustCursor = (this.dustCursor + 1) % this.dust.length;
      d.sp.visible = true;
      d.sp.material.color.set(color);
      d.sp.position.copy(pos).add(_p.set((Math.random() - 0.5) * 0.3 * scale, 0.05, (Math.random() - 0.5) * 0.3 * scale));
      const a = Math.random() * Math.PI * 2;
      d.vel.set(Math.cos(a) * 0.5 * scale, 0.3 + Math.random() * 0.4, Math.sin(a) * 0.5 * scale);
      d.max = d.life = 0.6 + Math.random() * 0.5;
      d.s0 = 0.15 * scale; d.s1 = (0.5 + Math.random() * 0.4) * scale;
    }
  }

  ring(pos, size = 0.6, color = 0xffffff) {
    const r = this.rings[this.ringCursor]; this.ringCursor = (this.ringCursor + 1) % this.rings.length;
    r.m.visible = true; r.m.position.copy(pos); r.m.position.y = 0.02;
    r.m.material.color.set(color);
    r.life = 0.35; r.size = size;
  }

  _textTex(text, color) {
    const key = text + color;
    if (this.texCache.has(key)) return this.texCache.get(key);
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const g = c.getContext('2d');
    g.font = '900 72px "M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.lineWidth = 14; g.strokeStyle = '#4a3426';
    g.strokeText(text, 128, 64);
    g.fillStyle = color; g.fillText(text, 128, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    this.texCache.set(key, t);
    return t;
  }

  text(pos, text, color = '#ffffff', size = 0.5, rise = 0.8) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._textTex(text, color), transparent: true, depthTest: false, depthWrite: false }));
    sp.renderOrder = 10;
    sp.position.copy(pos);
    sp.scale.set(size * 2, size, 1);
    this.root.add(sp);
    this.texts.push({ sp, life: 1, size, rise });
  }

  /** 障害物のパーツをもぎ取って飛ばす */
  fling(mesh, from) {
    this.root.attach(mesh);
    const dir = mesh.getWorldPosition(_p).clone();
    this.root.worldToLocal(dir);
    dir.sub(from).setY(0);
    if (dir.lengthSq() < 1e-4) dir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    dir.normalize().multiplyScalar(1 + Math.random() * 1.5);
    dir.y = 2 + Math.random() * 2.5;
    this.chunks.push({ mesh, vel: dir, spin: new THREE.Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10), life: 1.3, s: mesh.scale.clone() });
  }

  update(dt) {
    // 破片
    let any = false;
    for (let i = 0; i < this.max; i++) {
      const p = this.parts[i];
      if (p.life <= 0) continue;
      any = true;
      p.life -= dt;
      p.vel.y += p.grav * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < p.size / 2) {
        p.pos.y = p.size / 2;
        p.vel.y *= -0.35; p.vel.x *= 0.6; p.vel.z *= 0.6; p.spin.multiplyScalar(0.6);
      }
      p.rot.addScaledVector(p.spin, dt);
      const sc = p.life <= 0 ? 0 : p.size * Math.min(1, p.life / 0.3);
      _q.setFromEuler(_e.set(p.rot.x, p.rot.y, p.rot.z));
      this.debris.setMatrixAt(i, _m.compose(p.pos, _q, _s.set(sc, sc, sc)));
    }
    if (any || this._wasAny) this.debris.instanceMatrix.needsUpdate = true;
    this._wasAny = any;

    for (const d of this.dust) {
      if (!d.sp.visible) continue;
      d.life -= dt;
      if (d.life <= 0) { d.sp.visible = false; continue; }
      const u = 1 - d.life / d.max;
      d.sp.position.addScaledVector(d.vel, dt);
      d.vel.multiplyScalar(1 - 2.5 * dt);
      const s = d.s0 + (d.s1 - d.s0) * (1 - (1 - u) ** 2);
      d.sp.scale.set(s, s, s);
      d.sp.material.opacity = 0.75 * (1 - u);
    }

    for (const r of this.rings) {
      if (!r.m.visible) continue;
      r.life -= dt;
      if (r.life <= 0) { r.m.visible = false; continue; }
      const u = 1 - r.life / 0.35;
      const s = r.size * (0.3 + u);
      r.m.scale.set(s, 1, s);
      r.m.material.opacity = 0.8 * (1 - u);
    }

    for (let k = this.texts.length - 1; k >= 0; k--) {
      const t = this.texts[k];
      t.life -= dt * 1.1;
      if (t.life <= 0) { this.root.remove(t.sp); t.sp.material.dispose(); this.texts.splice(k, 1); continue; }
      t.sp.position.y += dt * t.rise * t.life;
      const pop = t.life > 0.85 ? 1 + (t.life - 0.85) * 3 : 1;
      t.sp.scale.set(t.size * 2 * pop, t.size * pop, 1);
      t.sp.material.opacity = Math.min(1, t.life * 3);
    }

    for (let k = this.chunks.length - 1; k >= 0; k--) {
      const c = this.chunks[k];
      c.life -= dt;
      c.vel.y += GRAV * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      if (c.mesh.position.y < 0.05) { c.mesh.position.y = 0.05; c.vel.y *= -0.3; c.vel.x *= 0.5; c.vel.z *= 0.5; c.spin.multiplyScalar(0.5); }
      c.mesh.rotation.x += c.spin.x * dt; c.mesh.rotation.y += c.spin.y * dt; c.mesh.rotation.z += c.spin.z * dt;
      if (c.life < 0.4) c.mesh.scale.copy(c.s).multiplyScalar(Math.max(0.001, c.life / 0.4));
      if (c.life <= 0) { this.root.remove(c.mesh); this.chunks.splice(k, 1); }
    }
  }

  clear() {
    for (const p of this.parts) p.life = 0;
    for (const d of this.dust) d.sp.visible = false;
    for (const r of this.rings) r.m.visible = false;
    for (const t of this.texts) this.root.remove(t.sp);
    for (const c of this.chunks) this.root.remove(c.mesh);
    this.texts = []; this.chunks = [];
    this.update(0);
  }
}
