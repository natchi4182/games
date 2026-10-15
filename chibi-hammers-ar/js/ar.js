// AR 表示まわり
//  - screen モード: カメラ映像を背景にして、ジャイロ（端末の向き）で3Dの荒地を空間に固定して見せる
//    ジャイロが無い端末ではドラッグで回せるオービット表示になる
//  - xr モード: WebXR immersive-ar + hit-test で現実の床に荒地を置く（対応端末のみ）
import * as THREE from 'three';

const EYE_H = 1.3, AHEAD = 1.45;
export const BASE_H = 0.6;           // ジオラマ土台の厚み（盤面ローカル単位）
const DEFAULT_LONG_FOV = 67;         // スマホ背面カメラ（標準レンズ）の長辺方向の画角（度）
const Z = new THREE.Vector3(0, 0, 1);
const Q_SCREEN = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));

export class ARView {
  constructor({ renderer, camera, scene, anchor, dom, onTap }) {
    Object.assign(this, { renderer, camera, scene, anchor, dom, onTap });
    this.mode = 'none';
    this.gyro = null;          // 最新の deviceorientation
    this.gyroSeen = false;
    this.yawOffset = null;
    this.targetQ = new THREE.Quaternion();
    this.orbit = { yaw: 0, pitch: 0.8, dist: 1.75 };
    this.shakeAmt = 0;
    this.pointers = new Map();
    this.pinch0 = null;
    this.fieldScale = 0.14;
    this.longFov = DEFAULT_LONG_FOV;
    this.basePos = new THREE.Vector3();

    this._onOrient = (e) => {
      if (e.alpha == null && e.beta == null) return;
      this.gyro = e;
      this.gyroSeen = true;
    };
    window.addEventListener('deviceorientation', this._onOrient);

    // XR 用レティクル
    this.reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.08, 0.11, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffd23f }),
    );
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    scene.add(this.reticle);

    this._bindPointer();
  }

  /** iOS はユーザー操作中にモーションセンサーの許可が必要 */
  static async requestMotionPermission() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const r = await DeviceOrientationEvent.requestPermission();
        return r === 'granted';
      }
    } catch (_) { /* 拒否 or 非対応 */ }
    return true;
  }

  static async xrSupported() {
    try { return !!navigator.xr && await navigator.xr.isSessionSupported('immersive-ar'); } catch (_) { return false; }
  }

  // -------------------------------------------------------------------------
  // カメラ映像 + ジャイロ
  // -------------------------------------------------------------------------
  startScreen() {
    this.mode = 'screen';
    this.anchor.visible = true;
    this.anchor.position.set(0, 0, -AHEAD);
    this.anchor.rotation.set(0, 0, 0);
    this.setFieldScale(this.fieldScale);
    this.camera.position.set(0, EYE_H, 0);
    this.yawOffset = null;
    this.orbit.yaw = 0;
    // 最初の向きでフィールドが見えるように
    this.camera.lookAt(this.anchor.position);
    this.targetQ.copy(this.camera.quaternion);
  }

  get usingGyro() { return this.mode === 'screen' && this.gyroSeen && this.gyroEnabled !== false; }

  recenter() {
    if (this.mode === 'xr') { this.placed = false; this.anchor.visible = false; this.onNeedPlace?.(); return; }
    this.yawOffset = null;
    this.anchor.rotation.y = 0;
    this.orbit.yaw = 0; this.orbit.pitch = 0.8; this.orbit.dist = 1.75;
  }

  shake(a) { if (this.mode === 'screen') this.shakeAmt = Math.min(0.03, this.shakeAmt + a); }

  _deviceQuat(out) {
    const e = this.gyro;
    const d2r = Math.PI / 180;
    const alpha = (e.alpha || 0) * d2r, beta = (e.beta || 0) * d2r, gamma = (e.gamma || 0) * d2r;
    const orient = ((screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0) * d2r;
    const euler = new THREE.Euler(beta, alpha, -gamma, 'YXZ');
    out.setFromEuler(euler);
    out.multiply(Q_SCREEN);
    out.multiply(new THREE.Quaternion().setFromAxisAngle(Z, -orient));
    return out;
  }

  update(dt) {
    if (this.mode !== 'screen') return;
    const cam = this.camera;
    this._applyFov();
    if (this.usingGyro) {
      const q = this._deviceQuat(new THREE.Quaternion());
      if (this.yawOffset === null) {
        // 今向いている方向を「正面（フィールドのある方向）」にする
        const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
        const yaw = Math.atan2(-f.x, -f.z);
        this.yawOffset = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
        this.targetQ.copy(this.yawOffset).multiply(q);
        cam.quaternion.copy(this.targetQ);
      }
      // センサー値をそのまま使う（なめらかにする処理は遅れの原因になるので入れない）
      this.targetQ.copy(this.yawOffset).multiply(q);
      cam.quaternion.copy(this.targetQ);
      cam.position.set(0, EYE_H, 0);
    } else {
      // オービット（PC など）
      const o = this.orbit, c = this.anchor.position;
      cam.position.set(
        c.x + Math.sin(o.yaw) * Math.cos(o.pitch) * o.dist,
        c.y + Math.sin(o.pitch) * o.dist,
        c.z + Math.cos(o.yaw) * Math.cos(o.pitch) * o.dist,
      );
      cam.lookAt(c.x, c.y + 0.05, c.z);
    }
    if (this.shakeAmt > 0) {
      cam.position.x += (Math.random() - 0.5) * this.shakeAmt;
      cam.position.y += (Math.random() - 0.5) * this.shakeAmt;
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 0.15);
    }
  }

  // -------------------------------------------------------------------------
  // タッチ操作（タップ / ドラッグ / ピンチ）
  // -------------------------------------------------------------------------
  _bindPointer() {
    const el = this.dom;
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: performance.now() });
      if (this.pointers.size === 2) this.pinch0 = { d: this._pinchDist(), scale: this.fieldScale, dist: this.orbit.dist };
    });
    el.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (this.mode !== 'screen') return;
      if (this.pointers.size === 2 && this.pinch0) {
        const k = this._pinchDist() / Math.max(1, this.pinch0.d);
        if (this.usingGyro) this.setFieldScale(this.pinch0.scale * k);
        else this.orbit.dist = THREE.MathUtils.clamp(this.pinch0.dist / k, 0.9, 4);
      } else if (this.pointers.size === 1 && Math.hypot(p.x - p.x0, p.y - p.y0) > 10) {
        if (this.usingGyro) this.anchor.rotation.y += dx * 0.01;
        else {
          this.orbit.yaw -= dx * 0.008;
          this.orbit.pitch = THREE.MathUtils.clamp(this.orbit.pitch + dy * 0.006, 0.25, 1.45);
        }
      }
    });
    const up = (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch0 = null;
      const moved = Math.hypot(e.clientX - p.x0, e.clientY - p.y0);
      if (moved < 12 && performance.now() - p.t < 600 && this.mode === 'screen') this.onTap?.(e.clientX, e.clientY);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', (e) => { this.pointers.delete(e.pointerId); this.pinch0 = null; });
    el.addEventListener('wheel', (e) => {
      if (this.mode !== 'screen') return;
      if (this.usingGyro) this.setFieldScale(this.fieldScale * (e.deltaY > 0 ? 0.92 : 1.08));
      else this.orbit.dist = THREE.MathUtils.clamp(this.orbit.dist * (e.deltaY > 0 ? 1.08 : 0.92), 0.9, 4);
    }, { passive: true });
  }

  _pinchDist() {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  setFieldScale(s) {
    this.fieldScale = THREE.MathUtils.clamp(s, this.mode === 'xr' ? 0.03 : 0.06, this.mode === 'xr' ? 0.3 : 0.35);
    this.anchor.scale.setScalar(this.fieldScale);
    // 土台の底が床（y=0）にのるように持ち上げる
    if (this._floorY != null) this.anchor.position.y = this._floorY + BASE_H * this.fieldScale;
    else if (this.mode === 'screen') this.anchor.position.y = BASE_H * this.fieldScale;
  }

  /**
   * カメラ映像の見え方に 3D の画角を合わせる。
   * 映像は object-fit: cover で画面いっぱいに切り抜かれているので、その切り抜き方も考える。
   */
  updateFov(video) {
    const W = window.innerWidth, H = window.innerHeight;
    const vw = video?.videoWidth, vh = video?.videoHeight;
    if (!vw || !vh || !video.srcObject) {
      this.videoFov = null;
    } else {
      const f = (Math.max(vw, vh) / 2) / Math.tan(THREE.MathUtils.degToRad(this.longFov) / 2);
      const s = Math.max(W / vw, H / vh);
      this.videoFov = THREE.MathUtils.radToDeg(2 * Math.atan((H / 2) / (f * s)));
    }
    this.camera.aspect = W / H;
    this._applyFov();
  }

  _applyFov() {
    // 映像に重ねるときだけ映像の画角に合わせる。PC のオービット表示は見やすい画角で
    const fov = this.usingGyro && this.videoFov ? this.videoFov : 62;
    if (this.camera.fov !== fov || this._aspect !== this.camera.aspect) {
      this.camera.fov = fov;
      this._aspect = this.camera.aspect;
      this.camera.updateProjectionMatrix();
    }
  }

  // -------------------------------------------------------------------------
  // WebXR
  // -------------------------------------------------------------------------
  async startXR(overlayRoot, { onPlaced, onRay, onEnd, onNeedPlace }) {
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'local-floor'],
      domOverlay: { root: overlayRoot },
    });
    this.onNeedPlace = onNeedPlace;
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local');
    await this.renderer.xr.setSession(session);
    this.session = session;
    this.mode = 'xr';
    this.placed = false;
    this.anchor.visible = false;
    this.fieldScale = 0.1;
    this.anchor.scale.setScalar(this.fieldScale);
    const viewer = await session.requestReferenceSpace('viewer');
    this.hitSource = await session.requestHitTestSource({ space: viewer });

    session.addEventListener('select', (e) => {
      const ref = this.renderer.xr.getReferenceSpace();
      if (!this.placed) {
        if (!this.reticle.visible) return;
        this.anchor.position.setFromMatrixPosition(this.reticle.matrix);
        this._floorY = this.anchor.position.y;
        this.anchor.position.y += BASE_H * this.fieldScale;
        const cam = this.renderer.xr.getCamera();
        const cp = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
        this.anchor.rotation.set(0, Math.atan2(cp.x - this.anchor.position.x, cp.z - this.anchor.position.z), 0);
        this.anchor.visible = true;
        this.reticle.visible = false;
        this.placed = true;
        onPlaced?.();
        return;
      }
      const pose = e.frame.getPose(e.inputSource.targetRaySpace, ref);
      if (!pose) return;
      const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
      const origin = new THREE.Vector3().setFromMatrixPosition(m);
      const dir = new THREE.Vector3(0, 0, -1).transformDirection(m);
      onRay?.(origin, dir);
    });
    session.addEventListener('end', () => {
      this.hitSource?.cancel?.();
      this.hitSource = null;
      this.session = null;
      this.renderer.xr.enabled = false;
      this._floorY = null;
      this.reticle.visible = false;
      this.mode = 'none';
      onEnd?.();
    });
  }

  endXR() { this.session?.end(); }

  updateXR(frame) {
    if (this.mode !== 'xr' || this.placed || !this.hitSource || !frame) return;
    const ref = this.renderer.xr.getReferenceSpace();
    const res = frame.getHitTestResults(this.hitSource);
    if (res.length) {
      const pose = res[0].getPose(ref);
      this.reticle.visible = true;
      this.reticle.matrix.fromArray(pose.transform.matrix);
    } else this.reticle.visible = false;
  }
}
