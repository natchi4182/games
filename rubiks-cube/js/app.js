import { CubeView, STD_COLORS } from './render.js';
import { FaceCapture, classify, hex } from './capture.js';
import { applyMove, applyMoves, solvedState, isSolved, toFaceletString, invertMove, randomScramble, FACES } from './cube.js';

const $ = (s) => document.querySelector(s);
const view = new CubeView($('#stage'));

// ---- ソルバー（Web Worker） ----
class SolverClient {
  constructor() { this.seq = 0; this.pending = new Map(); this.busy = false; this.onReady = null; this._spawn(); }
  _spawn() {
    this.ready = false;
    this.w = new Worker('js/solver.js');
    this.w.onmessage = (e) => {
      const d = e.data, p = this.pending.get(d.id);
      if (d.type === 'ready') { this.ready = true; this.onReady?.(d.ms); return; }
      if (!p) return;
      if (d.type === 'progress') p.onProgress?.(d);
      if (d.type === 'done') { this.pending.delete(d.id); this.busy = false; p.resolve(d); }
    };
    this.w.postMessage({ type: 'init', id: 0 });
  }
  cancel() {
    if (!this.busy) return;
    this.w.terminate();
    for (const p of this.pending.values()) p.resolve({ cancelled: true });
    this.pending.clear(); this.busy = false; this._spawn();
  }
  solve(facelets, timeLimit, onProgress) {
    this.cancel();
    const id = ++this.seq; this.busy = true;
    return new Promise((resolve) => {
      this.pending.set(id, { resolve, onProgress });
      this.w.postMessage({ type: 'solve', id, facelets, timeLimit });
    });
  }
}
const solver = new SolverClient();
solver.onReady = () => { $('#solverStatus').textContent = '解答エンジン 準備OK'; };

// ---- 共通 ----
const store = {
  get(k, d) { try { const v = localStorage.getItem('cube3d.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('cube3d.' + k, JSON.stringify(v)); } catch { /* 保存できなくても遊べる */ } },
};
let toastTimer = 0;
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
const FACE_JA = { U: '上', D: '下', R: '右', L: '左', F: '前', B: '後ろ', M: '真ん中（縦・左と同じ向き）', E: '真ん中（横・下と同じ向き）', S: '真ん中（前後・前と同じ向き）' };
function describeMove(m) {
  const dir = m.endsWith('2') ? '180°回す' : m.endsWith("'") ? '反時計回りに 90°' : '時計回りに 90°';
  const f = m[0];
  return `${FACE_JA[f]}${'UDRLFB'.includes(f) ? 'の面' : ''}を ${dir}`;
}
const fmtTime = (ms) => { const s = ms / 1000; return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; };

let current = 'scrTitle';
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('show', s.id === id));
  current = id;
  const stageVisible = ['scrTitle', 'scrPlay', 'scrSolve'].includes(id);
  $('#stage').style.visibility = stageVisible ? 'visible' : 'hidden';
  view.autoSpin = id === 'scrTitle';
  view.enabled = id === 'scrPlay';
  $('#hintBox').hidden = true;
  // 解答画面から戻ったときはタイマーを再開
  if (id === 'scrPlay' && play.t0 && !play.done && !play.running && play.history.length) {
    play.t0 = performance.now() - (play.pausedAt || 0); play.running = true; timerLoop();
  }
  requestAnimationFrame(layoutStage);
}
// UI の上下の帯に重ならないよう、3D の描画範囲を合わせる
function layoutStage() {
  const scr = document.getElementById(current);
  const top = scr.querySelector('.top-panel, .title-top'), bot = scr.querySelector('.bottom-panel');
  const t = top ? top.getBoundingClientRect().bottom : 0;
  const b = bot ? window.innerHeight - bot.getBoundingClientRect().top : 0;
  const st = $('#stage').style;
  st.top = t + 'px'; st.bottom = b + 'px';
  view.resize();
}
window.addEventListener('resize', () => requestAnimationFrame(layoutStage));

// ---- タイトル ----
function goTitle() {
  solver.cancel(); stopPlayLoop(); $('#clear').hidden = true; cap.stop();
  view.setPalette(STD_COLORS);
  view.setState(applyMoves(solvedState(), randomScramble(20)));
  show('scrTitle');
}

// ---- チャレンジ ----
const LEVELS = [
  { id: 'easy', name: 'かんたん', moves: 3, note: '3手で崩します。まずは慣れよう' },
  { id: 'normal', name: 'ふつう', moves: 6, note: '6手で崩します' },
  { id: 'hard', name: 'むずかしい', moves: 10, note: '10手で崩します' },
  { id: 'real', name: '本気', moves: 25, note: '完全にバラバラ。上級者向け' },
];
function goLevel() {
  const list = $('#levelList'); list.innerHTML = '';
  for (const lv of LEVELS) {
    const rec = store.get('best.' + lv.id, null);
    const b = document.createElement('button'); b.className = 'level';
    b.innerHTML = `<span><b>${lv.name}</b><small>${lv.note}</small></span><span class="rec">${rec ? `ベスト<b>${fmtTime(rec.time)}</b>${rec.moves}手` : 'まだ記録なし'}</span>`;
    b.onclick = () => startChallenge(lv);
    list.appendChild(b);
  }
  show('scrLevel');
}

const play = { kind: 'challenge', level: null, start: null, palette: STD_COLORS, history: [], t0: 0, elapsed: 0, running: false, done: false, token: 0 };
let timerRaf = 0;
function stopPlayLoop() { play.running = false; cancelAnimationFrame(timerRaf); play.token++; }
function timerLoop() {
  if (!play.running) return;
  $('#timer').textContent = fmtTime(performance.now() - play.t0);
  timerRaf = requestAnimationFrame(timerLoop);
}
function resetPlayStats() {
  stopPlayLoop(); play.history = []; play.t0 = 0; play.done = false;
  $('#timer').textContent = '0:00.0'; $('#moveCount').textContent = '0';
}
async function startChallenge(lv) {
  play.kind = 'challenge'; play.level = lv; play.palette = STD_COLORS;
  $('#playLabel').textContent = lv.name; $('#btnRestart').textContent = '🎲 別の問題';
  view.setPalette(STD_COLORS); view.setState(solvedState()); view.resetView();
  resetPlayStats(); $('#clear').hidden = true;
  show('scrPlay');
  view.enabled = false;
  const token = play.token;
  const scr = randomScramble(lv.moves);
  await new Promise((r) => setTimeout(r, 350));
  for (const m of scr) { if (token !== play.token) return; await view.play(m, lv.moves > 10 ? 70 : 160); }
  if (token !== play.token) return;
  play.start = view.state.slice();
  view.enabled = current === 'scrPlay';
  toast('スタート！ 面をなぞって回そう');
}
function startPhotoPlay(state, palette) {
  play.kind = 'photo'; play.level = null; play.palette = palette; play.start = state.slice();
  $('#playLabel').textContent = '取り込み'; $('#btnRestart').textContent = '↻ 最初から';
  view.setPalette(palette); view.setState(state); view.resetView();
  resetPlayStats(); show('scrPlay');
  if (isSolved(state)) toast('もうそろっています。崩して遊んでもOK');
}
function onUserMove(m) {
  if (current !== 'scrPlay' || play.done) return;
  play.history.push(m);
  if (!play.running) { play.running = true; play.t0 = performance.now(); timerLoop(); }
  $('#moveCount').textContent = play.history.length;
  $('#hintBox').hidden = true;
  if (isSolved(view.state)) finish();
}
view.onMove = onUserMove;

function finish() {
  play.done = true; play.running = false; cancelAnimationFrame(timerRaf);
  const time = performance.now() - play.t0, moves = play.history.length;
  $('#timer').textContent = fmtTime(time);
  $('#clearInfo').textContent = `タイム ${fmtTime(time)} ／ ${moves} 手`;
  let best = '';
  if (play.kind === 'challenge') {
    const key = 'best.' + play.level.id, rec = store.get(key, null);
    if (!rec || time < rec.time) { store.set(key, { time, moves }); best = rec ? '🏆 ベスト更新！' : '🏆 はじめての記録！'; }
    else best = `ベスト ${fmtTime(rec.time)}（${rec.moves}手）`;
  }
  $('#clearBest').textContent = best;
  setTimeout(() => { $('#clear').hidden = false; confetti(); }, 350);
}
function confetti() {
  const box = $('#confetti'); box.innerHTML = '';
  for (let i = 0; i < 70; i++) {
    const p = document.createElement('i');
    p.style.left = Math.random() * 100 + '%';
    p.style.background = STD_COLORS[i % 6];
    p.style.animationDuration = 1.6 + Math.random() * 1.8 + 's';
    p.style.animationDelay = Math.random() * 0.6 + 's';
    box.appendChild(p);
  }
}
async function hint() {
  if (play.done || !view.idle) return;
  if (isSolved(view.state)) { toast('もうそろっています'); return; }
  const box = $('#hintBox'); box.hidden = false; box.innerHTML = '考え中…';
  const state = view.state.slice();
  const res = await solver.solve(toFaceletString(state), 900);
  if (res.cancelled || current !== 'scrPlay' || !res.moves) return;
  if (res.error) { box.textContent = res.error; return; }
  const m = res.moves[0];
  box.innerHTML = `次の一手 <b>${m}</b>${describeMove(m)}<br><small class="muted">あと ${res.length} 手${res.optimal ? '（最短）' : ''}でそろいます</small>`;
}
async function undo() {
  if (play.done || !view.idle || !play.history.length) return;
  const m = play.history.pop();
  $('#moveCount').textContent = play.history.length;
  view.enabled = false;
  await view.play(invertMove(m), 150);
  view.enabled = current === 'scrPlay';
}
function restart() {
  if (play.kind === 'challenge') { startChallenge(play.level); return; }
  view.setState(play.start); resetPlayStats();
}

// キーボード（PC）: U R F D L B M E S x y z、Shift で逆回転
window.addEventListener('keydown', (e) => {
  if (current !== 'scrPlay' || !view.enabled || play.done || e.metaKey || e.ctrlKey) return;
  const k = e.key;
  if (/^[urfdlbmes]$/i.test(k)) {
    const m = k.toUpperCase() + (e.shiftKey ? "'" : '');
    view.play(m, 160).then((ok) => ok && onUserMove(m));
  } else if (/^[xyz]$/i.test(k)) {
    const m = k.toLowerCase() + (e.shiftKey ? "'" : '');
    view.play(m, 200);
  } else if (k === 'Backspace') undo();
});

// ---- 撮影 ----
const ORDER = [2, 1, 5, 4, 0, 3]; // 前 右 後 左 上 下 の順に撮る（番号は URFDLB）
const GUIDES = [
  '好きな面を正面に向けて撮影。<br>この面が<b>前</b>、いま上にある面が<b>上</b>になります',
  '上の面はそのまま、キューブを<b>左へ90°</b>回して<br><b>右</b>の面を正面に',
  'もう一度<b>左へ90°</b>回して<br><b>後ろ</b>の面を正面に',
  'もう一度<b>左へ90°</b>回して<br><b>左</b>の面を正面に',
  '左へ90°回して最初の向きに戻し、<br><b>上</b>の面を手前に倒して正面に',
  '最初の向きに戻し、手前の面を上へ起こして<br><b>下</b>の面を正面に',
];
const FACE_LABEL = { U: '上', R: '右', F: '前', D: '下', L: '左', B: '後' };
const capGrid = $('#capGrid');
for (let i = 0; i < 9; i++) capGrid.appendChild(document.createElement('i'));
const capture = new FaceCapture($('#capCanvas'), (s) => {
  if (!s) return;
  capGrid.querySelectorAll('i').forEach((el, i) => el.style.setProperty('--c', hex(s[i])));
});
const cap = { faces: new Array(6).fill(null), step: 0, stop() { capture.stop(); } };

function buildNet(el, cls) {
  el.innerHTML = '';
  for (const f of FACES) {
    const face = document.createElement('div'); face.className = 'face'; face.dataset.f = f; face.dataset.label = FACE_LABEL[f];
    for (let i = 0; i < 9; i++) { const b = document.createElement(cls === 'mini' ? 'i' : 'button'); b.className = 'st'; b.dataset.i = FACES.indexOf(f) * 9 + i; face.appendChild(b); }
    el.appendChild(face);
  }
}
buildNet($('#capNet'), 'mini');
function renderCapNet() {
  $('#capNet').querySelectorAll('.face').forEach((face, fi) => {
    face.classList.toggle('now', ORDER[cap.step] === fi);
    face.querySelectorAll('.st').forEach((el, i) => { const c = cap.faces[fi]; el.style.background = c ? hex(c[i]) : ''; el.classList.toggle('empty', !c); });
  });
  $('#capStep').textContent = `${Math.min(6, cap.step + 1)}/6`;
  $('#capGuide').innerHTML = GUIDES[Math.min(5, cap.step)];
}
async function startCamera() {
  const msg = $('#capMsg'); msg.hidden = true;
  try { await capture.startCamera(); $('#capZoomRow').hidden = true; }
  catch (err) {
    msg.hidden = false;
    msg.innerHTML = `カメラを使えませんでした。<br>「写真を選ぶ」で撮った写真を読み込むか、<br>「色を塗って入力」を使ってください。<br><small class="muted">${(err && err.name) || ''}</small>`;
  }
}
function goCapture() {
  solver.cancel(); stopPlayLoop();
  cap.faces = new Array(6).fill(null); cap.step = 0;
  renderCapNet(); show('scrCapture'); startCamera();
}
function capShot() {
  if (cap.step >= 6) return;
  if (capture.mode === 'none') { toast('カメラか写真を用意してね'); return; }
  const s = capture.sample(); if (!s) return;
  cap.faces[ORDER[cap.step]] = s; cap.step++;
  const vp = $('.viewport'); vp.animate([{ filter: 'brightness(2)' }, { filter: 'none' }], { duration: 250 });
  if (cap.step >= 6) {
    capture.stop();
    const { state, palette } = classify(cap.faces);
    openEditor(state, palette, 'capture');
    return;
  }
  renderCapNet();
}
function capBack() { if (cap.step > 0) { cap.step--; cap.faces[ORDER[cap.step]] = null; renderCapNet(); } }
$('#capFile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try { await capture.loadFile(f); $('#capMsg').hidden = true; $('#capZoomRow').hidden = false; $('#capZoom').value = 1; toast('枠にキューブの面が合うよう、ドラッグと拡大で調整してね'); }
  catch (err) { toast(err.message); }
});
$('#capZoom').addEventListener('input', (e) => capture.setZoom(+e.target.value));

// ---- 色の確認・修正 ----
const edit = { state: null, palette: STD_COLORS, origin: 'capture', sel: 0, ok: false };
buildNet($('#editNet'), 'full');
$('#editNet').addEventListener('click', (e) => {
  const b = e.target.closest('.st'); if (!b) return;
  const i = +b.dataset.i; if (i % 9 === 4) return;
  edit.state[i] = edit.state[i] === edit.sel && edit.origin === 'paint' ? -1 : edit.sel;
  renderEditor();
});
function openEditor(state, palette, origin) {
  edit.state = state.slice(); edit.palette = palette.slice(); edit.origin = origin; edit.sel = 0;
  show('scrEdit'); renderEditor();
}
function goPaint() {
  solver.cancel(); cap.stop();
  const s = new Array(54).fill(-1); for (let f = 0; f < 6; f++) s[f * 9 + 4] = f;
  openEditor(s, STD_COLORS, 'paint');
  toast('色を選んで、手元のキューブと同じようにマスを塗ってね');
}
function renderEditor() {
  const counts = [0, 0, 0, 0, 0, 0]; let empty = 0;
  edit.state.forEach((c) => { if (c >= 0) counts[c]++; else empty++; });
  $('#editNet').querySelectorAll('.st').forEach((el) => {
    const i = +el.dataset.i, c = edit.state[i];
    el.style.background = c >= 0 ? edit.palette[c] : '';
    el.classList.toggle('empty', c < 0); el.classList.toggle('center', i % 9 === 4);
  });
  const pal = $('#palette'); pal.innerHTML = '';
  edit.palette.forEach((col, k) => {
    const b = document.createElement('button'); b.style.background = col; b.textContent = `${counts[k]}/9`;
    b.className = (k === edit.sel ? 'sel ' : '') + (counts[k] > 9 ? 'bad' : '');
    b.setAttribute('aria-label', `${FACE_LABEL[FACES[k]]}の中心の色`);
    b.onclick = () => { edit.sel = k; renderEditor(); };
    pal.appendChild(b);
  });
  const st = $('#editStatus');
  let msg = '', ok = false;
  if (empty) msg = `あと ${empty} マス塗ってね`;
  else if (counts.some((n) => n !== 9)) msg = 'どの色もちょうど 9 枚ずつになるように直してね';
  else {
    const r = window.CubeSolver.faceletToCubie(toFaceletString(edit.state));
    if (r.error) msg = r.error + '。色の読み取り違いがないか確認してね';
    else { msg = 'OK！ そろえられる配置です'; ok = true; }
  }
  st.textContent = msg; st.className = 'status ' + (ok ? 'ok' : empty ? '' : 'ng');
  edit.ok = ok;
  $('#btnEditPlay').disabled = !ok; $('#btnEditSolve').disabled = !ok;
}

// ---- 最短解答 ----
const SPEEDS = [{ label: '×0.5', ms: 800 }, { label: '×1', ms: 420 }, { label: '×2', ms: 200 }];
const sol = { start: null, palette: STD_COLORS, moves: [], idx: 0, playing: false, searching: false, locked: false, optimal: false, from: 'title', speed: 1, token: 0 };
function enterSolve(state, palette, from) {
  sol.start = state.slice(); sol.palette = palette; sol.moves = []; sol.idx = 0; sol.playing = false;
  sol.locked = false; sol.optimal = false; sol.from = from; sol.token++;
  view.setPalette(palette); view.setState(state); view.resetView();
  show('scrSolve');
  renderSolve();
  const st = $('#solveStatus');
  if (isSolved(state)) { st.textContent = 'もうそろっています'; sol.searching = false; renderSolve(); return; }
  const fs = toFaceletString(state), chk = window.CubeSolver.faceletToCubie(fs);
  if (chk.error) { st.textContent = chk.error; st.className = 'status ng'; return; }
  sol.searching = true; renderSolve();
  const token = sol.token, t0 = performance.now();
  const wait = () => { if (token === sol.token && sol.searching && !sol.moves.length) { st.innerHTML = solver.ready ? '計算中…' : '解答エンジンを準備中…'; setTimeout(wait, 300); } };
  wait();
  solver.solve(fs, 10000, (p) => {
    if (token !== sol.token || sol.locked) return;
    sol.moves = p.moves; renderSolve();
  }).then((res) => {
    if (token !== sol.token || res.cancelled) return;
    sol.searching = false;
    if (res.error) { st.textContent = res.error; return; }
    if (!sol.locked) { sol.moves = res.moves; sol.optimal = res.optimal; }
    sol.elapsed = performance.now() - t0;
    renderSolve();
  });
}
function renderSolve() {
  const st = $('#solveStatus'), n = sol.moves.length;
  if (n) {
    st.className = 'status';
    if (sol.searching) st.innerHTML = `<b>${n} 手</b>の手順を発見。もっと短い手順を探し中…<span class="badge wait">探索中</span>`;
    else if (sol.optimal) st.innerHTML = `<b>${n} 手</b>でそろいます<span class="badge">最短確定</span>`;
    else if (sol.locked && sol.stoppedEarly) st.innerHTML = `<b>${n} 手</b>でそろいます<span class="badge wait">探索を途中で止めました</span>`;
    else st.innerHTML = `<b>${n} 手</b>でそろいます<span class="badge wait">時間内で見つけた最短</span>`;
  }
  const list = $('#moveList'); list.innerHTML = '';
  sol.moves.forEach((m, i) => {
    const b = document.createElement('button'); b.textContent = m;
    b.className = i < sol.idx ? 'done' : i === sol.idx ? 'cur' : '';
    b.onclick = () => jumpTo(i);
    list.appendChild(b);
  });
  const cur = list.querySelector('.cur'); if (cur) cur.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  const now = $('#moveNow');
  if (!n) now.innerHTML = '';
  else if (sol.idx >= n) now.innerHTML = '<b>完成！</b>そろいました 🎉';
  else now.innerHTML = `<b>${sol.moves[sol.idx]}</b>${sol.idx + 1} 手目：${describeMove(sol.moves[sol.idx])}`;
  $('#btnSolPlay').textContent = sol.playing ? '⏸' : '▶';
  $('#btnSpeed').textContent = SPEEDS[sol.speed].label;
}
// 再生などの操作を始めたら、その時点の手順で固定する
function lock() {
  if (sol.locked || !sol.moves.length) return !!sol.moves.length;
  sol.locked = true;
  if (sol.searching) { solver.cancel(); sol.searching = false; sol.stoppedEarly = true; } else sol.stoppedEarly = false;
  return true;
}
async function solStep() {
  if (sol.idx >= sol.moves.length) return false;
  const ok = await view.play(sol.moves[sol.idx], SPEEDS[sol.speed].ms);
  if (!ok) return false;
  sol.idx++; renderSolve(); return true;
}
async function solPlay() {
  if (sol.playing) { sol.playing = false; renderSolve(); return; }
  if (!lock()) return;
  if (sol.idx >= sol.moves.length) jumpTo(0);
  sol.playing = true; renderSolve();
  const token = sol.token;
  while (sol.playing && token === sol.token && sol.idx < sol.moves.length) { if (!(await solStep())) break; }
  if (token === sol.token) { sol.playing = false; renderSolve(); }
}
async function solNext() { if (!lock() || !view.idle || sol.playing) return; await solStep(); }
async function solPrev() {
  if (!lock() || !view.idle || sol.playing || sol.idx === 0) return;
  const ok = await view.play(invertMove(sol.moves[sol.idx - 1]), SPEEDS[sol.speed].ms);
  if (ok) { sol.idx--; renderSolve(); }
}
function jumpTo(i) {
  if (!lock()) return;
  sol.playing = false;
  view.setState(applyMoves(sol.start, sol.moves.slice(0, i)));
  sol.idx = i; renderSolve();
}
function leaveSolve() {
  solver.cancel(); sol.token++; sol.playing = false;
  if (sol.from === 'play') { view.setPalette(play.palette); view.setState(sol.start); show('scrPlay'); }
  else if (sol.from === 'edit') { show('scrEdit'); renderEditor(); }
  else goTitle();
}
function solNew() { enterSolve(applyMoves(solvedState(), randomScramble(25)), STD_COLORS, sol.from === 'play' ? 'title' : sol.from === 'edit' ? 'title' : sol.from); }

// ---- ボタン ----
const actions = {
  goTitle, goLevel, goCapture, goPaint,
  goSolver: () => enterSolve(applyMoves(solvedState(), randomScramble(25)), STD_COLORS, 'title'),
  leavePlay: () => { stopPlayLoop(); solver.cancel(); play.kind === 'challenge' ? goLevel() : (show('scrEdit'), renderEditor()); },
  resetView: () => view.resetView(),
  undo, hint, restart,
  showSolution: () => { if (!view.idle) return; play.pausedAt = play.t0 ? performance.now() - play.t0 : 0; play.running = false; cancelAnimationFrame(timerRaf); enterSolve(view.state, play.palette, 'play'); },
  again: () => { $('#clear').hidden = true; restart(); },
  capShot, capBack, capCamera: startCamera,
  editBack: () => { edit.origin === 'capture' ? goCapture() : goTitle(); },
  editClear: () => { const s = new Array(54).fill(-1); for (let f = 0; f < 6; f++) s[f * 9 + 4] = f; edit.state = s; edit.origin = 'paint'; renderEditor(); },
  editPlay: () => { if (edit.ok) startPhotoPlay(edit.state, edit.palette); },
  editSolve: () => { if (edit.ok) enterSolve(edit.state, edit.palette, 'edit'); },
  leaveSolve, solPlay, solNext, solPrev, solNew,
  solFirst: () => jumpTo(0),
  solSpeed: () => { sol.speed = (sol.speed + 1) % SPEEDS.length; renderSolve(); },
};
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-action]'); if (!b) return;
  const fn = actions[b.dataset.action]; if (fn) fn();
});

goTitle();
