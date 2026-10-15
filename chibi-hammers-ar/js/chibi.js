// 大きなハンマーを持った小さなかわいいやつら
import * as THREE from 'three';

const BODY_COLORS = [0xffb3c7, 0x9be7ff, 0xc5f27a, 0xffd59b, 0xd7b8ff, 0xfff08a, 0xffc2a8, 0xa8f0d8, 0xffffff, 0xb8d4ff, 0xffa8e0, 0xe0e0e0];
const NAMES = ['ポコ', 'ドン', 'ガン', 'トン', 'バキ', 'ゴン', 'カン', 'ズン', 'ペタ', 'ボコ', 'ドカ', 'ゴロ'];

const REST = -0.5, BACK = -2.5, SLAM = 1.72;
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

const GEO = {
  body: new THREE.SphereGeometry(0.2, 18, 14),
  eye: new THREE.SphereGeometry(0.028, 10, 8),
  shine: new THREE.SphereGeometry(0.01, 6, 4),
  cheek: new THREE.SphereGeometry(0.028, 10, 6),
  hat: new THREE.SphereGeometry(0.17, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  brim: new THREE.CylinderGeometry(0.2, 0.2, 0.025, 18),
  foot: new THREE.SphereGeometry(0.06, 10, 8),
  hand: new THREE.SphereGeometry(0.045, 10, 8),
  handle: new THREE.CylinderGeometry(0.022, 0.026, 0.56, 8),
  head: new THREE.CylinderGeometry(0.11, 0.11, 0.3, 14),
  band: new THREE.CylinderGeometry(0.115, 0.115, 0.035, 14),
  shadow: new THREE.CircleGeometry(0.2, 20).rotateX(-Math.PI / 2),
  pick: new THREE.SphereGeometry(0.32, 8, 6),
};
const MAT = {
  eye: new THREE.MeshBasicMaterial({ color: 0x2d1e17 }),
  white: new THREE.MeshBasicMaterial({ color: 0xffffff }),
  cheek: new THREE.MeshBasicMaterial({ color: 0xff7fa5, transparent: true, opacity: 0.7 }),
  hat: new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.4 }),
  handle: new THREE.MeshStandardMaterial({ color: 0xb07a4a, roughness: 0.7 }),
  head: new THREE.MeshStandardMaterial({ color: 0x9aa5b8, roughness: 0.35, metalness: 0.55 }),
  band: new THREE.MeshStandardMaterial({ color: 0xe0574a, roughness: 0.5 }),
  shadow: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }),
  pick: new THREE.MeshBasicMaterial({ visible: false }),
};
const FEVER_MAT = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xff8a00, emissiveIntensity: 0.6, roughness: 0.25, metalness: 0.7 });

export class Chibi {
  constructor(game, index) {
    this.game = game;
    this.index = index;
    this.name = NAMES[index % NAMES.length];
    this.root = new THREE.Group();
    this.root.userData.chibi = this;
    this.state = 'idle';
    this.target = null;
    this.path = [];
    this.stand = new THREE.Vector3();
    this.face = 0;
    this.swingT = Math.random();
    this.hitDone = false;
    this.boost = 0;
    this.jump = 0;
    this.jumpV = 0;
    this.walkPhase = Math.random() * 6;
    this.thinkCd = 0;
    this.hurrah = 0;

    const bodyMat = new THREE.MeshStandardMaterial({ color: BODY_COLORS[index % BODY_COLORS.length], roughness: 0.55 });
    this.bodyMat = bodyMat;

    const shadow = new THREE.Mesh(GEO.shadow, MAT.shadow);
    shadow.position.y = 0.015; shadow.renderOrder = 1;
    this.root.add(shadow);
    this.shadow = shadow;

    // 体（squash 用のピボット）
    this.pivot = new THREE.Group();
    this.root.add(this.pivot);
    const body = new THREE.Mesh(GEO.body, bodyMat);
    body.position.y = 0.2; body.scale.set(1, 0.92, 0.95);
    body.castShadow = true;
    this.pivot.add(body);

    // 顔
    const face = new THREE.Group();
    face.position.set(0, 0.2, 0);
    this.pivot.add(face);
    for (const sx of [-1, 1]) {
      const e = new THREE.Mesh(GEO.eye, MAT.eye);
      e.position.set(0.065 * sx, 0.02, 0.175); e.scale.set(0.9, 1.25, 0.6);
      const s = new THREE.Mesh(GEO.shine, MAT.white);
      s.position.set(0.058 * sx + 0.008, 0.035, 0.192);
      const c = new THREE.Mesh(GEO.cheek, MAT.cheek);
      c.position.set(0.115 * sx, -0.035, 0.145); c.scale.set(1.1, 0.6, 0.4);
      face.add(e, s, c);
    }
    this.eyes = face.children.filter((m) => m.geometry === GEO.eye);
    // 口
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.006, 4, 10, Math.PI), MAT.eye);
    mouth.position.set(0, -0.03, 0.188); mouth.rotation.z = Math.PI;
    face.add(mouth);

    // ヘルメット
    const hat = new THREE.Mesh(GEO.hat, MAT.hat);
    hat.position.y = 0.3; hat.castShadow = true;
    const brim = new THREE.Mesh(GEO.brim, MAT.hat);
    brim.position.set(0, 0.3, 0.03);
    this.pivot.add(hat, brim);

    // 足
    this.feet = [-1, 1].map((sx) => {
      const f = new THREE.Mesh(GEO.foot, bodyMat);
      f.position.set(0.08 * sx, 0.035, 0.04); f.scale.set(1, 0.6, 1.3);
      this.root.add(f);
      return f;
    });

    // ハンマー（手ごと回転）
    this.arm = new THREE.Group();
    this.arm.position.set(0, 0.2, 0.1);
    this.pivot.add(this.arm);
    for (const sx of [-1, 1]) {
      const h = new THREE.Mesh(GEO.hand, bodyMat);
      h.position.set(0.05 * sx, 0.05, 0.04);
      this.arm.add(h);
    }
    const handle = new THREE.Mesh(GEO.handle, MAT.handle);
    handle.position.set(0, 0.24, 0.04);
    handle.castShadow = true;
    this.hammerHead = new THREE.Group();
    this.hammerHead.position.set(0, 0.54, 0.04);
    const head = new THREE.Mesh(GEO.head, MAT.head);
    // 頭は振る方向（前後）に向ける。平らな面が打撃面になる
    head.rotation.x = Math.PI / 2; head.castShadow = true;
    this.headMesh = head;
    for (const bz of [-0.1, 0.1]) {
      const b = new THREE.Mesh(GEO.band, MAT.band);
      b.rotation.x = Math.PI / 2; b.position.z = bz;
      this.hammerHead.add(b);
    }
    this.hammerHead.add(head);
    this.arm.add(handle, this.hammerHead);
    this.arm.rotation.x = REST;

    // タップ判定用の見えない球
    const pick = new THREE.Mesh(GEO.pick, MAT.pick);
    pick.position.y = 0.25;
    pick.userData.chibi = this;
    this.root.add(pick);
    this.pick = pick;

    // 全体を少し大きめに（かわいさ重視）
    this.root.scale.setScalar(1.35);
  }

  get speedMul() { return this.game.swingSpeed * (this.boost > 0 ? 1.8 : 1) * (this.game.fever > 0 ? 2 : 1); }

  setFever(on) { this.headMesh.material = on ? FEVER_MAT : MAT.head; }

  cheerUp() {
    this.boost = 6;
    this.jumpV = 3.2;
    this.game.fx.text(_v.copy(this.root.position).setY(0.8), '♥', '#ff6b9a', 0.32, 1.2);
    this.game.audio.pop();
  }

  celebrate() {
    this.hurrah = 1.2;
    this.jumpV = 2.6;
  }

  // ---- AI ----
  think() {
    const g = this.game, w = g.world;
    if (this.target && this.target.attackers) this.target.attackers--;
    this.target = null;
    const pick = g.chooseTarget(this);
    if (!pick) { this.state = 'idle'; return; }
    this.target = pick.ob;
    this.target.attackers++;
    this.path = pick.path;
    this.stand.copy(pick.stand);
    this.state = 'walk';
  }

  update(dt) {
    const g = this.game, w = g.world;
    this.boost = Math.max(0, this.boost - dt);
    this.hurrah = Math.max(0, this.hurrah - dt);

    // ジャンプ
    if (this.jumpV !== 0 || this.jump > 0) {
      this.jumpV -= 12 * dt;
      this.jump += this.jumpV * dt;
      if (this.jump <= 0) { this.jump = 0; this.jumpV = 0; }
    }

    if (g.cleared) {
      this._idleAnim(dt, true);
      return this._finish(dt);
    }

    if (this.target && this.target.dead) {
      // 他の子に先をこされた / こわし終えた
      this.target.attackers = Math.max(0, this.target.attackers - 1);
      this.target = null;
      this.state = 'idle';
      this.thinkCd = 0.15 + Math.random() * 0.2;
    }
    // 集中攻撃の指示が出たら乗り換え
    if (g.focus && !g.focus.dead && this.target !== g.focus && this.state !== 'swing' && this._focusCheck !== g.focusId) {
      this._focusCheck = g.focusId;
      this.thinkCd = 0;
      this.state = 'idle';
    }

    switch (this.state) {
      case 'idle':
        this._idleAnim(dt);
        this.thinkCd -= dt;
        if (this.thinkCd <= 0) { this.think(); this.thinkCd = 0.5; }
        break;
      case 'walk': this._walk(dt); break;
      case 'swing': this._swing(dt); break;
    }
    this._separate(dt);
    this._finish(dt);
  }

  _finish(dt) {
    this.root.position.y = this.jump;
    this.shadow.position.y = 0.015 - this.jump / this.root.scale.y;
    const s = 1 - Math.min(0.5, this.jump);
    this.shadow.scale.set(s, 1, s);
    let d = this.face - this.root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.root.rotation.y += d * Math.min(1, 12 * dt);
  }

  _idleAnim(dt, happy = false) {
    this.walkPhase += dt * (happy ? 10 : 3);
    const b = Math.sin(this.walkPhase);
    this.pivot.scale.set(1 + b * 0.03, 1 - b * 0.04, 1 + b * 0.03);
    this.arm.rotation.x += ((happy ? -2.8 + Math.sin(this.walkPhase) * 0.4 : REST) - this.arm.rotation.x) * 0.15;
    this.pivot.rotation.x *= 0.8;
    if (happy && this.jump === 0 && Math.random() < 0.02) this.jumpV = 2.4;
    this.feet.forEach((f) => (f.position.y = 0.035));
  }

  _walk(dt) {
    const g = this.game;
    const pos = this.root.position;
    const goal = this.path.length ? this.path[0] : this.stand;
    _v.set(goal.x - pos.x, 0, goal.z - pos.z);
    const dist = _v.length();
    const speed = 1.5 * Math.min(1.6, 0.8 + 0.2 * this.speedMul);
    if (dist < 0.04) {
      if (this.path.length) this.path.shift();
      else { this._startSwing(); return; }
    } else {
      _v.multiplyScalar(Math.min(dist, speed * dt) / dist);
      pos.x += _v.x; pos.z += _v.z;
      this.face = Math.atan2(_v.x, _v.z);
    }
    // ぴょこぴょこ歩き
    this.walkPhase += dt * 16;
    const s = Math.sin(this.walkPhase);
    if (this.jump === 0) this.pivot.position.y = Math.abs(s) * 0.05;
    this.pivot.rotation.z = s * 0.12;
    this.pivot.rotation.x = 0.12;
    this.feet[0].position.y = 0.035 + Math.max(0, s) * 0.06;
    this.feet[1].position.y = 0.035 + Math.max(0, -s) * 0.06;
    this.arm.rotation.x += (REST - 0.2 - this.arm.rotation.x) * 0.2;
    if (Math.random() < dt * 4) g.fx.puff(_w.copy(pos), 1, 0.35);
  }

  _startSwing() {
    if (!this.target || this.target.dead) { this.state = 'idle'; return; }
    this.state = 'swing';
    this.swingT = Math.random() * 0.2;
    this.hitDone = false;
    this.pivot.rotation.set(0, 0, 0);
    this.pivot.position.y = 0;
    const tp = this.game.nearestPointOn(this.target, this.root.position);
    this.face = Math.atan2(tp.x - this.root.position.x, tp.z - this.root.position.z);
  }

  _swing(dt) {
    const T = 0.95;
    this.swingT += dt * this.speedMul / T;
    if (this.swingT >= 1) {
      this.swingT -= 1;
      this.hitDone = false;
      if (!this.target || this.target.dead) { this.state = 'idle'; this.thinkCd = 0.1; return; }
    }
    const u = this.swingT;
    let a, squash = 0, lean = 0;
    if (u < 0.5) { const k = easeOutCubic(u / 0.5); a = REST + (BACK - REST) * k; lean = -0.18 * k; squash = -0.08 * k; }
    else if (u < 0.6) { const k = (u - 0.5) / 0.1; a = BACK + (SLAM - BACK) * k * k; lean = -0.18 + 0.45 * k; }
    else if (u < 0.75) { a = SLAM; lean = 0.27; squash = 0.18 * (1 - (u - 0.6) / 0.15); }
    else { const k = easeInOut((u - 0.75) / 0.25); a = SLAM + (REST - SLAM) * k; lean = 0.27 * (1 - k); }
    this.arm.rotation.x = a;
    this.pivot.rotation.x = lean;
    this.pivot.scale.set(1 + squash * 0.6, 1 - squash, 1 + squash * 0.6);
    this.feet.forEach((f) => (f.position.y = 0.035));

    if (u >= 0.6 && !this.hitDone) {
      this.hitDone = true;
      this.hammerHead.getWorldPosition(_w);
      this.game.fieldRoot.worldToLocal(_w);
      _w.y = Math.max(0.05, _w.y);
      this.game.onHammerHit(this, this.target, _w);
    }
  }

  _separate(dt) {
    // おしくらまんじゅう防止
    const pos = this.root.position;
    for (const o of this.game.chibis) {
      if (o === this) continue;
      const dx = pos.x - o.root.position.x, dz = pos.z - o.root.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 0.0001 && d2 < 0.13) {
        const d = Math.sqrt(d2), push = (0.36 - d) * (this.state === 'swing' ? 0.6 : 2) * dt * 4;
        pos.x += dx / d * push; pos.z += dz / d * push;
      }
    }
    // 障害物にめりこまない
    const w = this.game.world, c = w.cellOf(pos.x, pos.z);
    const lim = (w.N * 1) / 2 - 0.15;
    pos.x = Math.max(-lim, Math.min(lim, pos.x));
    pos.z = Math.max(-lim, Math.min(lim, pos.z));
    if (c && !w.isFree(c.i, c.j) && this.state !== 'walk') {
      const cc = w.cellCenter(c.i, c.j);
      const dx = pos.x - cc.x, dz = pos.z - cc.z;
      if (Math.max(Math.abs(dx), Math.abs(dz)) < 0.45) {
        if (Math.abs(dx) > Math.abs(dz)) pos.x = cc.x + Math.sign(dx || 1) * 0.45;
        else pos.z = cc.z + Math.sign(dz || 1) * 0.45;
      }
    }
  }

  dispose() {
    this.bodyMat.dispose();
    this.root.removeFromParent();
  }
}

function easeOutCubic(u) { return 1 - Math.pow(1 - u, 3); }
function easeInOut(u) { return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; }
