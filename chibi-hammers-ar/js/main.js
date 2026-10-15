// ちびハンマーズ AR — ゲーム本体
import * as THREE from 'three';
import { startCamera, stopCamera, grabFrame, loadImageFile, makeSamplePhoto, analyzePhoto, makeGrimyPhoto, rgbToCss, mulberry32 } from './photo.js';
import { World, planLayout, drawPlanPreview } from './world.js';
import { Chibi } from './chibi.js';
import { Fx } from './fx.js';
import { Sfx } from './audio.js';
import { ARView, BASE_H } from './ar.js';

const N = 8;                 // 盤面のマス数（N×N）
const MAX_CREW = 12;
const FEVER_NEED = 36;
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// セーブデータ
// ---------------------------------------------------------------------------
const SAVE_KEY = 'chibiHammers.v1';
const DEFAULTS = { coins: 0, level: 1, crew: 3, power: 1, speed: 1, sound: true, bgm: true, cleared: 0 };
let save = loadSave();
function loadSave() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SAVE_KEY) || '{}') }; } catch (_) { return { ...DEFAULTS }; }
}
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (_) { /* private mode */ } }

const COST = {
  crew: () => (save.crew >= MAX_CREW ? null : Math.round(40 * Math.pow(1.7, save.crew - 3))),
  power: () => (save.power >= 30 ? null : Math.round(20 * Math.pow(1.42, save.power - 1))),
  speed: () => (save.speed >= 15 ? null : Math.round(25 * Math.pow(1.5, save.speed - 1))),
};

// ---------------------------------------------------------------------------
// three.js
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x000000, 0);
$('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.01, 60);
const anchor = new THREE.Group();   // AR で空間に置かれる「荒地ジオラマ」
scene.add(anchor);

const hemi = new THREE.HemisphereLight(0xffffff, 0x886644, 1.2);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(2.5, 7, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.bias = -0.0006;
anchor.add(sun, sun.target);

// 本物の床に影を落とすための透明な床（影だけ描く）
const shadowCatcher = new THREE.Mesh(
  new THREE.PlaneGeometry(N * 3.5, N * 3.5).rotateX(-Math.PI / 2),
  new THREE.ShadowMaterial({ opacity: 0.32, depthWrite: false }),
);
shadowCatcher.position.y = -BASE_H + 0.002;
shadowCatcher.receiveShadow = true;
anchor.add(shadowCatcher);

// 視線（画面の真ん中が指している地面）
const gaze = { point: new THREE.Vector3(), valid: false, ob: null };
const gazeRing = new THREE.Mesh(
  new THREE.RingGeometry(0.22, 0.3, 28).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }),
);
gazeRing.renderOrder = 2;
gazeRing.visible = false;
anchor.add(gazeRing);
// 監督エリア（6DoF のとき、自分の足もとのまわり。近くのちびが張り切る）
const SUPERVISE_R = 0.9;   // m
const superRing = new THREE.Mesh(
  new THREE.RingGeometry(0.93, 1, 48).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.35, depthWrite: false }),
);
superRing.renderOrder = 2;
superRing.visible = false;
anchor.add(superRing);
const _foot = new THREE.Vector3();
let superHintShown = false;
const _gazePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _gazeRay = new THREE.Ray();
const _inv = new THREE.Matrix4();
const CENTER = new THREE.Vector2(0, 0);

// 集中攻撃マーカー
const marker = new THREE.Group();
{
  const mat = new THREE.MeshStandardMaterial({ color: 0xff5a7a, emissive: 0xff2a50, emissiveIntensity: 0.35, roughness: 0.4 });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 4), mat);
  cone.rotation.x = Math.PI;
  cone.position.y = 0.15;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff5a7a, transparent: true, opacity: 0.8, depthWrite: false }));
  ring.name = 'ring';
  const arrow = new THREE.Group(); arrow.name = 'arrow'; arrow.add(cone);
  marker.add(arrow, ring);
  marker.visible = false;
  anchor.add(marker);
}

const audio = new Sfx();
audio.setEnabled(save.sound);
audio.bgmOn = save.bgm;
const fx = new Fx(anchor);
const raycaster = new THREE.Raycaster();

// ---------------------------------------------------------------------------
// ゲーム状態
// ---------------------------------------------------------------------------
const game = {
  world: null, chibis: [], fx, audio, fieldRoot: anchor,
  focus: null, focusId: 0, fever: 0, feverGauge: 0, cleared: false, paused: false,
  get swingSpeed() { return 1 + 0.13 * (save.speed - 1); },
  get power() { return 1 + 0.55 * (save.power - 1); },

  chooseTarget(chibi) { return chooseTarget(chibi); },
  nearestPointOn(ob, pos) {
    let best = null, bd = 1e9;
    for (const c of ob.cells) {
      const p = this.world.cellCenter(c.i, c.j);
      const d = p.distanceToSquared(pos);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  },
  onHammerHit(chibi, ob, pos) { onHammerHit(chibi, ob, pos); },
};

let stream = null;          // getUserMedia
let photo = null;           // 撮影画像（canvas）
let grimy = null;           // 廃墟テクスチャ用に加工した写真
let analysis = null;
let layout = null;
let variant = 0;
let playMode = 'screen';
let stageStart = 0;
let destroyedCount = 0;
let xrOk = false;
const ar = new ARView({ renderer, camera, scene, anchor, dom: renderer.domElement, onTap: (x, y) => tapScreen(x, y) });

ARView.xrSupported().then((ok) => (xrOk = ok));

// 床トラッキングの状態に合わせて案内を出す
ar.onTrackState = (st) => {
  const ph = $('placeHint');
  if (!$('scrGame').classList.contains('show')) return;
  if (st === 'aim') {
    ph.innerHTML = '床やテーブルにカメラを向けて<br><b>タップで荒地を置こう</b>';
    ph.classList.remove('hidden', 'lost');
  } else if (st === 'aim-low') {
    toast('もう少し下（床）に向けてね', 1200);
  } else if (st === 'lost') {
    ph.innerHTML = '床の模様が見えないよ<br>ゆっくり床をうつしてね';
    ph.classList.remove('hidden');
    ph.classList.add('lost');
  } else {
    ph.classList.add('hidden');
  }
};
ar.onPlaced = (n) => {
  audio.pop();
  toast(n >= 12 ? 'ここを整地するよ！' : '模様が少ない床だと追いにくいよ', 1400);
  if (n >= 12) setTimeout(() => toast('近づくと ちびが張り切るよ！', 1800), 1800);
};

// ---------------------------------------------------------------------------
// 画面遷移
// ---------------------------------------------------------------------------
function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('show', s.id === id);
}
function overlay(id, on) { $(id).classList.toggle('show', on); }

let toastTimer = 0;
function toast(text, ms = 1400) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function setBackground(kind) {
  $('cam').classList.toggle('on', kind === 'video');
  $('photoBg').classList.toggle('on', kind === 'photo');
}

function bindTap(id, fn) {
  const el = $(id);
  el.addEventListener('click', (e) => { audio.unlock(); fn(e); });
  // WebXR 中、ボタンのタップが「床タップ」にならないように
  el.addEventListener('beforexrselect', (e) => e.preventDefault());
}

// --- タイトル ---
bindTap('btnStart', async () => {
  audio.click();
  await ARView.requestMotionPermission();
  await openCapture();
});

async function openCapture() {
  show('scrCapture');
  setBackground('none');
  $('btnShutter').disabled = true;
  if (!stream) {
    try {
      stream = await startCamera($('cam'));
    } catch (err) {
      console.warn('camera', err);
      stream = null;
    }
  }
  if (stream) {
    setBackground('video');
    $('cam').addEventListener('loadedmetadata', () => ar.updateFov($('cam')), { once: true });
    ar.updateFov($('cam'));
    $('btnShutter').disabled = false;
    $('capMsg').innerHTML = 'まわりを撮影してね！<br><span class="small">床や地面がうつるとGOOD</span>';
  } else {
    $('capMsg').innerHTML = 'カメラが使えないみたい…<br><span class="small">🖼️ 写真をえらぶ か 🎲 おまかせ で遊べるよ</span>';
  }
}

// --- 撮影 ---
bindTap('btnShutter', () => {
  const v = $('cam');
  if (!v.videoWidth) return;
  audio.shutter();
  $('flash').classList.remove('go'); void $('flash').offsetWidth; $('flash').classList.add('go');
  const c = grabFrame(v, 640, window.innerWidth / window.innerHeight);
  goAnalyze(c);
});
$('fileInput').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  try {
    const img = await loadImageFile(f);
    goAnalyze(grabFrame(img, 640));
  } catch (_) { toast('読みこめなかった…'); }
});
bindTap('btnSample', () => { audio.click(); goAnalyze(makeSamplePhoto()); });

// --- 解析 ---
function goAnalyze(c) {
  photo = c;
  grimy = null;
  variant = 0;
  show('scrAnalyze');
  const wrap = document.querySelector('.photo-wrap');
  wrap.classList.remove('done');
  $('reportBody').classList.add('hidden');
  $('analyzeMsg').classList.remove('hidden');
  $('mapPreview').classList.remove('on');
  const pv = $('photoPreview');
  pv.width = c.width; pv.height = c.height;
  pv.getContext('2d').drawImage(c, 0, 0);
  wrap.style.aspectRatio = `${c.width} / ${c.height}`;
  if (!stream) { $('photoBg').style.backgroundImage = `url(${c.toDataURL('image/jpeg', 0.8)})`; setBackground('photo'); }

  setTimeout(() => {
    analysis = analyzePhoto(c, N);
    layout = planLayout(analysis, save.level, variant);
    drawPlanPreview($('mapPreview'), analysis, layout);
    $('mapPreview').classList.add('on');
    wrap.classList.add('done');
    fillReport();
    audio.cheer();
  }, 1300);
}

function stars(v) { const n = Math.max(1, Math.min(5, Math.round(v * 5))); return '★'.repeat(n) + '☆'.repeat(5 - n); }

function landName(an) {
  const r = mulberry32(an.seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  let adj;
  if (an.green > 0.45) adj = pick(['草ぼうぼうの', 'ジャングルな', 'みどりの']);
  else if (an.skyLabel === '夕焼け') adj = pick(['夕焼けの', 'たそがれの']);
  else if (an.brightness < 0.3) adj = pick(['うす暗い', 'ひっそりした']);
  else if (an.edge > 0.6) adj = pick(['ガラガラの', 'ごちゃごちゃの', 'ボロボロの']);
  else if (an.brightness > 0.62) adj = pick(['まぶしい', 'カラッとした']);
  else adj = pick(['さびれた', 'ほこりっぽい', 'わすれられた']);
  const noun = an.ruin > 0.55 ? pick(['廃墟街', '廃工場', 'ゴーストタウン', '旧市街'])
    : an.green > 0.4 ? pick(['荒れ野', '草原あと', '廃農園'])
    : pick(['がれき谷', '空き地', 'さびれ村', '荒れ地']);
  return adj + noun;
}

function fillReport() {
  const an = analysis;
  $('analyzeMsg').classList.add('hidden');
  $('reportBody').classList.remove('hidden');
  $('landName').textContent = `「${landName(an)}」`;
  $('mRough').textContent = stars(an.edge);
  $('mWild').textContent = stars(an.green);
  $('mRuin').textContent = stars(layout.plan.filter((p) => p.type === 'ruin').length / 3 * 0.6 + an.ruin * 0.4);
  $('mSky').textContent = an.skyLabel;
  $('palette').innerHTML = an.palette.map((c) => `<i style="background:${rgbToCss(c)}"></i>`).join('');
  $('btnPlayXR').classList.toggle('hidden', !xrOk);
}

bindTap('btnRetake', () => { audio.click(); openCapture(); });
bindTap('btnPlay', () => { audio.click(); startStage('screen'); });
bindTap('btnPlayXR', () => { audio.click(); startStage('xr'); });

// ---------------------------------------------------------------------------
// ステージ
// ---------------------------------------------------------------------------
function clearStage() {
  for (const c of game.chibis) c.dispose();
  game.chibis = [];
  game.world?.dispose();
  game.world = null;
  fx.clear();
  setFocus(null);
}

function applyLighting(an) {
  const white = new THREE.Color(0xffffff);
  const sky = new THREE.Color().setRGB(...an.skyColor, THREE.SRGBColorSpace);
  const ground = new THREE.Color().setRGB(...an.groundColor, THREE.SRGBColorSpace);
  hemi.color.copy(white).lerp(sky, 0.35);
  hemi.groundColor.set(0x8a6a50).lerp(ground, 0.4);
  hemi.intensity = 1.0 + an.brightness * 0.5;
  const avg = new THREE.Color().setRGB(...an.avg, THREE.SRGBColorSpace);
  sun.color.set(an.warmth > 0.1 ? 0xffd9a8 : 0xffffff).lerp(avg, 0.15);
  sun.intensity = 1.4 + an.brightness * 0.8;
}

function startStage(mode) {
  clearStage();
  game.cleared = false;
  game.fever = 0;
  game.feverGauge = 0;
  game.paused = false;
  destroyedCount = 0;
  if (!grimy) grimy = makeGrimyPhoto(photo);
  layout = planLayout(analysis, save.level, variant);
  const world = new World(analysis, grimy, layout, save.level);
  anchor.add(world.group);
  game.world = world;
  applyLighting(analysis);
  for (let k = 0; k < save.crew; k++) spawnChibi(k, true);

  show('scrGame');
  overlay('scrMenu', false);
  overlay('scrClear', false);
  updateHud();
  $('hint').classList.remove('fade');
  setTimeout(() => $('hint').classList.add('fade'), 7000);
  stageStart = performance.now();
  audio.startBgm();

  playMode = mode;
  if (mode !== 'xr') enterScreenAR();
  else if (ar.mode !== 'xr') enterXR();   // XR セッション中ならそのまま続行

}

function enterScreenAR() {
  document.body.classList.remove('xr');
  $('placeHint').classList.add('hidden');
  // 床トラッキング中なら同じ場所のまま次のステージへ
  const keep = ar.mode === 'screen' && (ar.trackState === 'run' || ar.trackState === 'lost');
  if (!keep) ar.startScreen(stream ? $('cam') : null);
  ar.updateFov(stream ? $('cam') : null);
  if (stream) setBackground('video');
  else { $('photoBg').style.backgroundImage = `url(${photo.toDataURL('image/jpeg', 0.8)})`; setBackground('photo'); }
}

async function enterXR() {
  ar.stopTracking();
  // WebXR はカメラを自分で使うので getUserMedia は止める
  stopCamera(stream); stream = null;
  setBackground('none');
  document.body.classList.add('xr');
  $('placeHint').innerHTML = '床にマーカーが出たらタップして荒地を置いてね';
  $('placeHint').classList.remove('hidden', 'lost');
  try {
    await ar.startXR($('ui'), {
      onPlaced: () => {
        $('placeHint').classList.add('hidden'); audio.pop(); toast('ここを整地するよ！');
        setTimeout(() => toast('近づくと ちびが張り切るよ！', 1800), 1800);
      },
      onNeedPlace: () => $('placeHint').classList.remove('hidden'),
      onRay: (o, d) => { raycaster.set(o, d); handleRay(); },
      onEnd: async () => {
        document.body.classList.remove('xr');
        playMode = 'screen';
        try { stream = await startCamera($('cam')); } catch (_) { stream = null; }
        if ($('scrGame').classList.contains('show')) enterScreenAR();
      },
    });
  } catch (err) {
    console.warn('xr', err);
    toast('WebXR が使えなかったのでカメラARで遊ぶよ', 2200);
    playMode = 'screen';
    try { stream = await startCamera($('cam')); } catch (_) { stream = null; }
    enterScreenAR();
  }
}

function spawnChibi(k, initial) {
  const ch = new Chibi(game, k);
  const sp = layout.spawn[k % layout.spawn.length];
  const p = game.world.cellCenter(sp.i, sp.j);
  ch.root.position.set(p.x + (Math.random() - 0.5) * 0.5, 0, p.z + (Math.random() - 0.5) * 0.5);
  ch.root.rotation.y = ch.face = Math.random() * 6;
  ch.thinkCd = initial ? 0.6 + k * 0.15 : 0.2;
  if (!initial) { ch.jumpV = 3; fx.puff(ch.root.position, 5, 0.8, 0xffffff); }
  if (game.fever > 0) ch.setFever(true);
  anchor.add(ch.root);
  game.chibis.push(ch);
  return ch;
}

// ---------------------------------------------------------------------------
// AI: どれをこわしに行くか（盤面の BFS）
// ---------------------------------------------------------------------------
const DIR8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const DIR4 = DIR8.slice(0, 4);

function chooseTarget(chibi) {
  const w = game.world, n = w.N;
  if (!w || w.done) return null;
  const pos = chibi.root.position;
  let start = w.cellOf(pos.x, pos.z);
  if (!start || !w.isFree(start.i, start.j)) start = nearestFree(pos);
  if (!start) return null;

  const dist = new Int32Array(n * n).fill(-1), prev = new Int32Array(n * n).fill(-1);
  const q = [start.j * n + start.i];
  dist[q[0]] = 0;
  for (let h = 0; h < q.length; h++) {
    const id = q[h], i = id % n, j = (id / n) | 0;
    for (const [dx, dy] of DIR8) {
      const a = i + dx, b = j + dy;
      if (!w.isFree(a, b)) continue;
      if (dx && dy && (!w.isFree(i + dx, j) || !w.isFree(i, j + dy))) continue; // 角はすり抜けない
      const nid = b * n + a;
      if (dist[nid] >= 0) continue;
      dist[nid] = dist[id] + 1; prev[nid] = id; q.push(nid);
    }
  }

  // 同じ場所を狙っている仲間の数
  const slotUse = new Map();
  for (const o of game.chibis) if (o !== chibi && o.slotKey != null && o.target && !o.target.dead) slotUse.set(o.slotKey, (slotUse.get(o.slotKey) || 0) + 1);

  const focus = game.focus && !game.focus.dead ? game.focus : null;
  let focusReachable = false;
  if (focus) for (const c of focus.cells) for (const [dx, dy] of DIR4) { const a = c.i + dx, b = c.j + dy; if (w.isFree(a, b) && dist[b * n + a] >= 0) focusReachable = true; }

  let best = null;
  for (const ob of w.obstacles) {
    if (ob.dead) continue;
    for (const c of ob.cells) for (const [dx, dy] of DIR4) {
      const a = c.i + dx, b = c.j + dy;
      if (!w.isFree(a, b)) continue;
      const d = dist[b * n + a];
      if (d < 0) continue;
      const key = b * n + a + ':' + c.i + ',' + c.j;
      let score = d + (ob.attackers || 0) * 1.1 + (slotUse.get(key) || 0) * 2.5 + Math.random() * 0.6;
      if (ob === chibi.target) score -= 0.5;
      // スマホを向けている場所の近くを優先
      if (!focus && gaze.valid) score += ob.center.distanceTo(gaze.point) * 0.9;
      if (focus) {
        if (ob === focus) score -= 100;
        else if (!focusReachable) score += ob.center.distanceTo(focus.center) * 3 - 50;
      }
      if (!best || score < best.score) best = { score, ob, a, b, c, key };
    }
  }
  if (!best) return null;

  // 経路
  const path = [];
  for (let id = best.b * n + best.a; id >= 0 && id !== start.j * n + start.i; id = prev[id]) {
    path.unshift(w.cellCenter(id % n, (id / n) | 0));
  }
  if (path.length) path.pop(); // 最後のマスの中心には寄らず、直接立ち位置へ
  const tc = w.cellCenter(best.c.i, best.c.j);
  const dir = new THREE.Vector3(best.a - best.c.i, 0, best.b - best.c.j);
  const standDist = best.ob.type === 'ruin' ? 1.05 : 0.82;
  const lateral = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar((Math.random() - 0.5) * 0.4);
  const stand = tc.clone().addScaledVector(dir, standDist).add(lateral);
  chibi.slotKey = best.key;
  return { ob: best.ob, path, stand };
}

function nearestFree(pos) {
  const w = game.world;
  let best = null, bd = 1e9;
  for (let j = 0; j < w.N; j++) for (let i = 0; i < w.N; i++) {
    if (!w.isFree(i, j)) continue;
    const d = w.cellCenter(i, j).distanceToSquared(pos);
    if (d < bd) { bd = d; best = { i, j }; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// ハンマーが当たったとき
// ---------------------------------------------------------------------------
const WORDS = ['ドカッ', 'バキッ', 'ゴンッ', 'ポコッ', 'ガツン', 'ドン!'];
function onHammerHit(chibi, ob, pos) {
  if (!ob || ob.dead || game.cleared) return;
  const w = game.world;
  const fever = game.fever > 0;
  const power = game.power * (fever ? 2 : 1) * (chibi.boost > 0 ? 1.3 : 1);
  fx.burst(pos, ob.color, fever ? 10 : 6, 1, fever ? { rainbow: true } : {});
  fx.puff(pos, 2, 0.6);
  fx.ring(pos, 0.45, fever ? 0xffd23f : 0xffffff);
  audio.hit(ob.def.mat, ob.type === 'ruin');
  ar.shake(0.003);
  if (Math.random() < 0.12) fx.text(pos.clone().setY(0.7), WORDS[Math.floor(Math.random() * WORDS.length)], '#ffffff', 0.28, 1);
  if (!fever && game.feverGauge < FEVER_NEED) game.feverGauge++;

  const destroyed = w.hit(ob, power, pos, fx);
  if (destroyed) {
    destroyedCount++;
    const reward = Math.round(ob.def.coin * (1 + 0.25 * (save.level - 1)) * (fever ? 1.5 : 1));
    save.coins += reward;
    const big = ob.type === 'ruin';
    fx.burst(ob.center.clone().setY(0.2), ob.color, big ? 40 : 16, big ? 1.6 : 1.1, { size: big ? 0.09 : 0.06 });
    fx.puff(ob.center, big ? 12 : 6, big ? 2.2 : 1.1);
    fx.text(ob.center.clone().setY(big ? 1.4 : 0.8), `+${reward}`, '#ffd23f', big ? 0.5 : 0.36, 1.2);
    audio.smash();
    setTimeout(() => audio.coin(), 120);
    ar.shake(big ? 0.02 : 0.008);
    chibi.celebrate();
    if (w.flush) {
      // 本物の床がピカピカに
      for (const c of ob.cells) {
        const p = w.cellCenter(c.i, c.j);
        fx.burst(p.clone().setY(0.05), 0xfff6c8, 8, 0.45, { size: 0.03, grav: -1.5 });
        fx.ring(p, 0.7, 0xfff3b0);
      }
      if (Math.random() < 0.5) fx.text(ob.center.clone().setY(0.5), 'ピカッ', '#fff6c8', 0.26, 0.9);
    }
    if (game.focus === ob) setFocus(null);
    if (big) toast(`${ob.def.name}をこわした！`);
    persist();
    if (w.done) stageClear();
  }
  updateHud();
}

function setFocus(ob) {
  game.focus = ob;
  game.focusId++;
  marker.visible = !!ob;
  if (ob) marker.position.set(ob.center.x, 0, ob.center.z);
  if (ob) marker.getObjectByName('ring').scale.setScalar(ob.type === 'ruin' ? 2 : 1);
}

// ---------------------------------------------------------------------------
// タップ
// ---------------------------------------------------------------------------
function tapScreen(x, y) {
  if (!game.world || game.paused) return;
  const ndc = new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  handleRay();
}

function handleRay() {
  const w = game.world;
  if (!w || game.cleared) return;
  audio.unlock();
  // ちびをタップ → 応援
  const hits = raycaster.intersectObjects(game.chibis.map((c) => c.pick), false);
  if (hits.length) {
    const ch = hits[0].object.userData.chibi;
    if (ch.boost < 4) {
      ch.cheerUp();
      toast(`${ch.name}「がんばる！」`, 900);
    }
    return;
  }
  // 障害物 or 地面
  const h2 = raycaster.intersectObject(w.group, true);
  for (const h of h2) {
    let ob = h.object.userData.obstacle;
    if (!ob && h.object.userData.ground) {
      const p = anchor.worldToLocal(h.point.clone());
      const c = w.cellOf(p.x, p.z);
      ob = c && w.obstacleAt(c.i, c.j);
    }
    if (ob && !ob.dead) {
      setFocus(ob);
      audio.pop();
      fx.text(ob.center.clone().setY(ob.type === 'ruin' ? 1.5 : 0.9), 'ここ!', '#ff6b9a', 0.3, 0.6);
      return;
    }
    if (h.object.userData.ground) return;
  }
}

// ---------------------------------------------------------------------------
// HUD / アップグレード
// ---------------------------------------------------------------------------
function updateHud() {
  const w = game.world;
  const pct = w ? Math.floor(w.progress * 100) : 0;
  $('hudBar').style.width = pct + '%';
  $('hudPct').textContent = pct + '%';
  $('hudCoins').textContent = save.coins.toLocaleString();
  $('hudStage').textContent = 'Lv.' + save.level;
  const set = (key, lvText) => {
    const cost = COST[key]();
    const el = $('up' + key[0].toUpperCase() + key.slice(1));
    $('lv' + key[0].toUpperCase() + key.slice(1)).textContent = lvText;
    $('cost' + key[0].toUpperCase() + key.slice(1)).textContent = cost == null ? 'MAX' : `🪙${cost}`;
    el.classList.toggle('ng', cost != null && save.coins < cost);
    el.classList.toggle('max', cost == null);
  };
  set('crew', `${save.crew}にん`);
  set('power', `Lv.${save.power}`);
  set('speed', `Lv.${save.speed}`);
  const fb = $('btnFever');
  $('feverGauge').style.height = (game.fever > 0 ? 100 : (game.feverGauge / FEVER_NEED) * 100) + '%';
  fb.disabled = !(game.feverGauge >= FEVER_NEED && game.fever <= 0);
  fb.classList.toggle('on', game.fever > 0);
}

function buy(key) {
  const cost = COST[key]();
  if (cost == null) { toast('もう最大だよ！'); return; }
  if (save.coins < cost) { toast('コインが足りない…'); audio.click(); return; }
  save.coins -= cost;
  save[key]++;
  persist();
  audio.buy();
  if (key === 'crew' && game.world) {
    const ch = spawnChibi(save.crew - 1, false);
    toast(`${ch.name}がなかまになった！`);
  } else if (key === 'power') toast('ハンマーがパワーアップ！');
  else toast('スイングが速くなった！');
  for (const c of game.chibis) c.jumpV = c.jump === 0 ? 2 : c.jumpV;
  updateHud();
}
bindTap('upCrew', () => buy('crew'));
bindTap('upPower', () => buy('power'));
bindTap('upSpeed', () => buy('speed'));

bindTap('btnFever', () => {
  if (game.feverGauge < FEVER_NEED || game.fever > 0) return;
  game.fever = 9;
  game.feverGauge = 0;
  for (const c of game.chibis) { c.setFever(true); c.jumpV = 3; }
  audio.fanfare();
  toast('フィーバー！！', 1600);
  updateHud();
});

bindTap('btnRecenter', () => { audio.click(); ar.recenter(); });
function setDiag(on) {
  diagOn = on;
  $('diag').classList.toggle('hidden', !on);
  $('btnDiag').textContent = `🔧 AR診断表示: ${on ? 'ON' : 'OFF'}`;
  $('diagFov').value = ar.longFov.toFixed(1);
  $('diagFovVal').textContent = ar.longFov.toFixed(1) + '°';
}
bindTap('btnDiag', () => { audio.click(); setDiag(!diagOn); });
$('diagFov').addEventListener('input', (e) => {
  ar.setLongFov(parseFloat(e.target.value));
  $('diagFovVal').textContent = ar.longFov.toFixed(1) + '°';
});
bindTap('diagFovReset', () => {
  ar.setLongFov(ar.defaultFov);
  try { localStorage.removeItem('chibiHammers.cameraFov'); } catch (_) { /* なし */ }
  setDiag(true);
});
bindTap('btnSizeUp', () => ar.setFieldScale(ar.fieldScale * 1.2));
bindTap('btnSizeDown', () => ar.setFieldScale(ar.fieldScale / 1.2));

// --- メニュー ---
function soundLabels() {
  $('btnSound').textContent = `🔊 サウンド: ${save.sound ? 'ON' : 'OFF'}`;
  $('btnBgm').textContent = `🎵 BGM: ${save.bgm ? 'ON' : 'OFF'}`;
}
soundLabels();
bindTap('btnMenu', () => { audio.click(); game.paused = true; overlay('scrMenu', true); });
bindTap('btnResume', () => { audio.click(); game.paused = false; overlay('scrMenu', false); });
bindTap('btnSound', () => { save.sound = !save.sound; audio.setEnabled(save.sound); persist(); soundLabels(); audio.click(); });
bindTap('btnBgm', () => { save.bgm = !save.bgm; audio.setBgm(save.bgm); persist(); soundLabels(); audio.click(); });
bindTap('btnNewLand', () => { overlay('scrMenu', false); leaveToCapture(); });
bindTap('btnReset', () => {
  if (!confirm('セーブデータ（コイン・レベル・強化）を消しますか？')) return;
  save = { ...DEFAULTS };
  persist();
  audio.setEnabled(save.sound);
  soundLabels();
  updateHud();
  toast('リセットしたよ');
});

function leaveToCapture() {
  game.paused = false;
  ar.stopTracking();
  if (ar.mode === 'xr') ar.endXR();
  clearStage();
  openCapture();
}

// --- クリア ---
function stageClear() {
  game.cleared = true;
  setFocus(null);
  game.world.bloom();
  audio.fanfare();
  toast('整地かんりょう！', 2400);
  for (const c of game.chibis) c.celebrate();
  for (let k = 0; k < 6; k++) {
    setTimeout(() => {
      const p = new THREE.Vector3((Math.random() - 0.5) * N * 0.7, 0.4, (Math.random() - 0.5) * N * 0.7);
      fx.burst(p, 0xffffff, 26, 1.4, { rainbow: true, size: 0.07, grav: -6 });
      audio.pop();
    }, k * 260);
  }
  const sec = Math.round((performance.now() - stageStart) / 1000);
  const bonus = 30 + save.level * 15 + Math.max(0, 180 - sec);
  save.coins += bonus;
  save.cleared++;
  $('clearLand').textContent = `${$('landName').textContent} が きれいな土地になった！`;
  $('rTime').textContent = `${Math.floor(sec / 60)}分${String(sec % 60).padStart(2, '0')}秒`;
  $('rCount').textContent = `${destroyedCount}こ`;
  $('rBonus').textContent = `🪙${bonus}`;
  save.level++;
  persist();
  updateHud();
  setTimeout(() => overlay('scrClear', true), 3200);
}
bindTap('btnNextSame', () => {
  audio.click();
  variant++;
  overlay('scrClear', false);
  startStage(playMode);
});
bindTap('btnNextShot', () => { audio.click(); overlay('scrClear', false); leaveToCapture(); });

// 床に直接重ねるか（床を認識できるモード）、ジオラマで出すか
function syncFlush() {
  const w = game.world;
  if (!w || w.flush === ar.flush) return;
  w.setFlush(ar.flush);
  shadowCatcher.position.y = ar.flush ? 0.001 : -BASE_H + 0.002;
  ar.setFieldScale(ar.fieldScale);
}

// 自分（カメラ）の足もとの近くにいるちびは張り切る
function updateSupervise() {
  let n = 0;
  if (ar.is6dof) {
    const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
    _foot.setFromMatrixPosition(cam.matrixWorld);
    anchor.worldToLocal(_foot);
    _foot.y = 0;
    const r = SUPERVISE_R / anchor.scale.x;
    for (const c of game.chibis) {
      const on = c.root.position.distanceTo(_foot) < r;
      if (on && !c.supervised) fx.text(c.root.position.clone().setY(0.9), '!', '#ffd23f', 0.3, 1.2);
      c.supervised = on;
      if (on) n++;
    }
    const lim = game.world.N / 2 + r;
    superRing.visible = Math.abs(_foot.x) < lim && Math.abs(_foot.z) < lim;
    superRing.position.set(_foot.x, 0.02, _foot.z);
    superRing.scale.set(r, 1, r);
    if (n > 0 && !superHintShown) { superHintShown = true; toast('近くのちびが張り切ってる！', 1600); }
  } else {
    for (const c of game.chibis) c.supervised = false;
    superRing.visible = false;
  }
  const pill = $('superPill');
  pill.classList.toggle('hidden', n === 0);
  if (n > 0) pill.textContent = `📣 ${n}人 張り切り中`;
}

// 画面の真ん中の先にある地面の位置（盤面ローカル）
function updateGaze() {
  const w = game.world;
  gaze.valid = false;
  if (w && anchor.visible && !game.cleared) {
    const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
    raycaster.setFromCamera(CENTER, cam);
    _inv.copy(anchor.matrixWorld).invert();
    _gazeRay.copy(raycaster.ray).applyMatrix4(_inv);
    if (_gazeRay.intersectPlane(_gazePlane, gaze.point)) {
      const lim = w.N / 2 + 0.3;
      gaze.valid = Math.abs(gaze.point.x) < lim && Math.abs(gaze.point.z) < lim;
    }
  }
  gazeRing.visible = gaze.valid && !game.focus;
  if (gazeRing.visible) {
    gazeRing.position.set(gaze.point.x, 0.03, gaze.point.z);
    gazeRing.material.opacity = 0.4 + Math.sin(performance.now() / 180) * 0.15;
  }
}

// ---------------------------------------------------------------------------
// メインループ
// ---------------------------------------------------------------------------
function onResize() {
  if (renderer.xr.isPresenting) return;
  renderer.setSize(window.innerWidth, window.innerHeight);
  ar.updateFov(stream ? $('cam') : null);
}
window.addEventListener('resize', onResize);

const clock = new THREE.Clock();
let hudTimer = 0;
let lastShadowScale = -1;
renderer.setAnimationLoop((t, frame) => {
  const dt = Math.min(0.05, clock.getDelta());
  if (frame) ar.updateXR(frame);
  ar.update(dt);
  syncFlush();

  if (game.world && !game.paused && anchor.visible) {
    if (game.fever > 0) {
      game.fever -= dt;
      if (game.fever <= 0) { for (const c of game.chibis) c.setFever(false); updateHud(); }
    }
    for (const c of game.chibis) c.update(dt);
    game.world.update(dt);
    fx.update(dt);
    if (marker.visible) {
      const tt = performance.now() / 1000;
      marker.getObjectByName('arrow').position.y = (game.focus?.type === 'ruin' ? 1.7 : 0.95) + Math.sin(tt * 6) * 0.08;
      marker.getObjectByName('arrow').rotation.y = tt * 2;
      marker.getObjectByName('ring').material.opacity = 0.5 + Math.sin(tt * 8) * 0.3;
    }
    updateGaze();
    updateSupervise();
    hudTimer -= dt;
    if (hudTimer <= 0) { hudTimer = 0.5; if (game.fever > 0) updateHud(); }
  }

  watchPerf(t);
  // 床トラッキング中は、映像フレームが届いたタイミングで描く（ar.onFrameRender）
  if (!ar.frameSynced) renderFrame();
});

// 描画（影のカメラを盤面サイズに合わせてから）
function renderFrame() {
  const s = anchor.scale.x;
  if (s !== lastShadowScale) {
    lastShadowScale = s;
    const R = (N / 2 + 2.5) * s;
    const sc = sun.shadow.camera;
    sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R;
    sc.near = 0.01; sc.far = 20 * s;
    sc.updateProjectionMatrix();
    sun.shadow.normalBias = 0.02 * s;
  }
  renderer.render(scene, camera);
  perf.renders++;
}
ar.onFrameRender = renderFrame;

// ---------------------------------------------------------------------------
// 動作の重さを見て解像度を下げる ＋ AR 診断表示
// ---------------------------------------------------------------------------
const DPR_STEPS = [2, 1.6, 1.3, 1];
const perf = { last: 0, avg: 16, slowFor: 0, renders: 0, lastCount: 0, lastFrames: 0, lastT: 0, dprIdx: 0 };
perf.dprIdx = Math.max(0, DPR_STEPS.findIndex((d) => d <= Math.min(window.devicePixelRatio, 2)));
let diagOn = false;
function watchPerf(t) {
  const now = performance.now();
  if (perf.last) perf.avg += (Math.min(100, now - perf.last) - perf.avg) * 0.05;
  perf.last = now;
  // 重い状態（約 45fps 未満）が続いたら 1 段階ずつ解像度を下げる
  if (!renderer.xr.isPresenting && $('scrGame').classList.contains('show') && !game.paused) {
    perf.slowFor = perf.avg > 22 ? perf.slowFor + 1 : 0;
    if (perf.slowFor > 90 && perf.dprIdx < DPR_STEPS.length - 1) {
      perf.dprIdx++;
      perf.slowFor = 0;
      renderer.setPixelRatio(DPR_STEPS[perf.dprIdx]);
      renderer.setSize(window.innerWidth, window.innerHeight);
    }
  }
  if (diagOn && now - perf.lastT > 500) {
    const dtS = (now - perf.lastT) / 1000;
    const rf = (perf.renders - perf.lastCount) / dtS, vf = (ar.stats.frames - perf.lastFrames) / dtS;
    perf.lastCount = perf.renders; perf.lastFrames = ar.stats.frames; perf.lastT = now;
    const tr = ar.tracker;
    $('diagText').textContent =
      `描画 ${rf.toFixed(0)}fps / ループ ${(1000 / perf.avg).toFixed(0)}fps\n` +
      `追跡 ${vf.toFixed(0)}fps ${ar.stats.trackMs.toFixed(1)}ms\n` +
      `状態 ${ar.trackState}  点 ${tr ? tr.count : '-'} / 一致 ${tr ? tr.inliers : '-'}\n` +
      `解像度 x${DPR_STEPS[perf.dprIdx]}  画角 ${ar.longFov.toFixed(1)}°  映像 ${$('cam').videoWidth}x${$('cam').videoHeight}`;
  }
}

// デバッグ・テスト用（コンソールから触れるように）
window.__game = { game, save, ar, startStage: (m) => startStage(m), goAnalyze, makeSamplePhoto };
