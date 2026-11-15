// キューブの論理モデル（3D の座標から 54 枚のステッカー配置を作る）
// 座標系: x = 右(R), y = 上(U), z = 前(F)。ステッカー番号は Kociemba 標準（URFDLB 各9枚）。

export const FACES = 'URFDLB';
export const FACE_NORMALS = {
  U: [0, 1, 0], R: [1, 0, 0], F: [0, 0, 1], D: [0, -1, 0], L: [-1, 0, 0], B: [0, 0, -1],
};

// 各面のステッカー（行 r, 列 c）→ キューブ位置 [x,y,z]
function faceletPos(face, r, c) {
  switch (face) {
    case 'U': return [c - 1, 1, r - 1];
    case 'R': return [1, 1 - r, 1 - c];
    case 'F': return [c - 1, 1 - r, 1];
    case 'D': return [c - 1, -1, 1 - r];
    case 'L': return [-1, 1 - r, c - 1];
    case 'B': return [1 - c, 1 - r, -1];
  }
}

// STICKERS[i] = { face, pos:[x,y,z], normal:[x,y,z] }
export const STICKERS = [];
for (const f of FACES) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
  STICKERS.push({ face: f, pos: faceletPos(f, r, c), normal: FACE_NORMALS[f] });
}
const keyOf = (p, n) => p.join(',') + '|' + n.join(',');
const INDEX = new Map(STICKERS.map((s, i) => [keyOf(s.pos, s.normal), i]));

// 軸まわりの 90° 回転（q = +1 で右手系の正方向 = 軸の先から見て反時計回り）
export function rotVec(v, axis, q) {
  const [x, y, z] = v;
  q = ((q % 4) + 4) % 4;
  let r = [x, y, z];
  for (let i = 0; i < q; i++) {
    const [a, b, c] = r;
    if (axis === 0) r = [a, -c, b];
    else if (axis === 1) r = [c, b, -a];
    else r = [-b, a, c];
  }
  return r;
}

// 手の定義: 軸, 層(配列), 1/4 回転の向き
const BASE = {
  U: { axis: 1, layers: [1], q: -1 },
  D: { axis: 1, layers: [-1], q: 1 },
  R: { axis: 0, layers: [1], q: -1 },
  L: { axis: 0, layers: [-1], q: 1 },
  F: { axis: 2, layers: [1], q: -1 },
  B: { axis: 2, layers: [-1], q: 1 },
  M: { axis: 0, layers: [0], q: 1 },
  E: { axis: 1, layers: [0], q: 1 },
  S: { axis: 2, layers: [0], q: -1 },
  x: { axis: 0, layers: [-1, 0, 1], q: -1 },
  y: { axis: 1, layers: [-1, 0, 1], q: -1 },
  z: { axis: 2, layers: [-1, 0, 1], q: -1 },
};

// "R2" → { axis, layers, q }  （q は -2..2 の 1/4 回転数）
export function parseMove(m) {
  const base = BASE[m[0]];
  if (!base) throw new Error('bad move ' + m);
  let n = 1;
  if (m.endsWith('2')) n = 2; else if (m.endsWith("'")) n = -1;
  return { name: m, axis: base.axis, layers: base.layers, q: base.q * n };
}

const PERM_CACHE = new Map();
// state[i] の色が、手を回したあと perm[i] 番に移る
function permOf(move) {
  if (PERM_CACHE.has(move)) return PERM_CACHE.get(move);
  const { axis, layers, q } = parseMove(move);
  const perm = new Array(54);
  STICKERS.forEach((s, i) => {
    if (layers.includes(s.pos[axis])) {
      perm[i] = INDEX.get(keyOf(rotVec(s.pos, axis, q), rotVec(s.normal, axis, q)));
    } else perm[i] = i;
  });
  PERM_CACHE.set(move, perm);
  return perm;
}

// state: 54 要素の配列（色番号 0..5 など）
export function applyMove(state, move) {
  const perm = permOf(move), out = new Array(54);
  for (let i = 0; i < 54; i++) out[perm[i]] = state[i];
  return out;
}
export function applyMoves(state, moves) {
  for (const m of moves) state = applyMove(state, m);
  return state;
}
export function solvedState() {
  const s = [];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 9; i++) s.push(f);
  return s;
}
export function isSolved(state) {
  for (let f = 0; f < 6; f++) for (let i = 0; i < 9; i++) if (state[f * 9 + i] !== state[f * 9]) return false;
  return true;
}
// 中心の色を基準に Kociemba 文字列にする（向きが変わっていても OK）
export function toFaceletString(state) {
  const map = {};
  for (let f = 0; f < 6; f++) map[state[f * 9 + 4]] = FACES[f];
  return state.map((c) => map[c] ?? '?').join('');
}
export function invertMove(m) {
  if (m.endsWith('2')) return m;
  if (m.endsWith("'")) return m[0];
  return m + "'";
}
export function invertMoves(ms) { return ms.slice().reverse().map(invertMove); }

// 打ち消しのないランダムな崩し手順
export function randomScramble(n = 22, rnd = Math.random) {
  const faces = 'URFDLB', suf = ['', '2', "'"], out = [];
  let last = -1, last2 = -1;
  while (out.length < n) {
    const f = Math.floor(rnd() * 6);
    if (f === last) continue;
    if (f % 3 === last % 3 && f % 3 === last2 % 3) continue; // U D U のような並び
    last2 = last; last = f;
    out.push(faces[f] + suf[Math.floor(rnd() * 3)]);
  }
  return out;
}
