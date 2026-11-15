/*
 * ルービックキューブ ソルバー（コシエンバの2フェーズ法）
 *
 * 入力: 54文字のフェイスレット文字列（URFDLB の順、各面9枚、Kociemba 標準の並び）
 * 出力: 手順（例 "R U' F2 ..."）
 *
 * フェーズ1の長さを 0 から増やしながら全探索し、各フェーズ1解のあとに
 * フェーズ2の最短手順を IDA* で探す。フェーズ1の長さが最良解の長さに
 * 達するまで探し切れば、その解は「本当に最短」であることが保証される
 * （どの解も「最後の R/L/F/B の 1/4 回転」までをフェーズ1と見なせるため）。
 * 時間切れのときは、それまでに見つけた最短の解を返す。
 *
 * Web Worker としても、通常のスクリプト / Node からも使える。
 */
(function (root) {
  'use strict';

  // ---- キューブの基本定義 -------------------------------------------------
  // 角: URF UFL ULB UBR DFR DLF DBL DRB / 辺: UR UF UL UB DR DF DL DB FR FL BL BR
  const CORNER_FACELET = [
    [8, 9, 20], [6, 18, 38], [0, 36, 47], [2, 45, 11],
    [29, 26, 15], [27, 44, 24], [33, 53, 42], [35, 17, 51],
  ];
  const EDGE_FACELET = [
    [5, 10], [7, 19], [3, 37], [1, 46], [32, 16], [28, 25],
    [30, 43], [34, 52], [23, 12], [21, 41], [50, 39], [48, 14],
  ];
  const FACES = 'URFDLB';
  const CORNER_COLOR = [
    [0, 1, 2], [0, 2, 4], [0, 4, 5], [0, 5, 1],
    [3, 2, 1], [3, 4, 2], [3, 5, 4], [3, 1, 5],
  ];
  const EDGE_COLOR = [
    [0, 1], [0, 2], [0, 4], [0, 5], [3, 1], [3, 2],
    [3, 4], [3, 5], [2, 1], [2, 4], [5, 4], [5, 1],
  ];

  // 6つの基本回転（U R F D L B）の cubie 表現
  const BASIC = [
    { cp: [3, 0, 1, 2, 4, 5, 6, 7], co: [0, 0, 0, 0, 0, 0, 0, 0], ep: [3, 0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11], eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { cp: [4, 1, 2, 0, 7, 5, 6, 3], co: [2, 0, 0, 1, 1, 0, 0, 2], ep: [8, 1, 2, 3, 11, 5, 6, 7, 4, 9, 10, 0], eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { cp: [1, 5, 2, 3, 0, 4, 6, 7], co: [1, 2, 0, 0, 2, 1, 0, 0], ep: [0, 9, 2, 3, 4, 8, 6, 7, 1, 5, 10, 11], eo: [0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0] },
    { cp: [0, 1, 2, 3, 5, 6, 7, 4], co: [0, 0, 0, 0, 0, 0, 0, 0], ep: [0, 1, 2, 3, 5, 6, 7, 4, 8, 9, 10, 11], eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { cp: [0, 2, 6, 3, 4, 1, 5, 7], co: [0, 1, 2, 0, 0, 2, 1, 0], ep: [0, 1, 10, 3, 4, 5, 9, 7, 8, 2, 6, 11], eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { cp: [0, 1, 3, 7, 4, 5, 2, 6], co: [0, 0, 1, 2, 0, 0, 2, 1], ep: [0, 1, 2, 11, 4, 5, 6, 10, 8, 9, 3, 7], eo: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1] },
  ];

  function solvedCubie() {
    return { cp: [0, 1, 2, 3, 4, 5, 6, 7], co: [0, 0, 0, 0, 0, 0, 0, 0], ep: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
  }
  function mul(a, b) {
    const r = solvedCubie();
    for (let i = 0; i < 8; i++) { r.cp[i] = a.cp[b.cp[i]]; r.co[i] = (a.co[b.cp[i]] + b.co[i]) % 3; }
    for (let i = 0; i < 12; i++) { r.ep[i] = a.ep[b.ep[i]]; r.eo[i] = (a.eo[b.ep[i]] + b.eo[i]) % 2; }
    return r;
  }
  // 18手: 0..17 = U U2 U' R R2 R' F F2 F' D D2 D' L L2 L' B B2 B'
  const MOVES = [];
  for (let f = 0; f < 6; f++) {
    let c = BASIC[f];
    for (let k = 0; k < 3; k++) { MOVES.push(c); c = mul(c, BASIC[f]); }
  }
  const MOVE_NAMES = [];
  for (let f = 0; f < 6; f++) for (const s of ['', '2', "'"]) MOVE_NAMES.push(FACES[f] + s);

  // ---- 座標 ---------------------------------------------------------------
  const C = [];
  for (let n = 0; n < 13; n++) { C[n] = []; for (let k = 0; k < 13; k++) C[n][k] = k > n ? 0 : (k === 0 || k === n ? 1 : C[n - 1][k - 1] + C[n - 1][k]); }
  const cnk = (n, k) => (n < 0 || k < 0 || k > n ? 0 : C[n][k]);

  function getTwist(c) { let t = 0; for (let i = 0; i < 7; i++) t = t * 3 + c.co[i]; return t; }
  function setTwist(c, t) { let s = 0; for (let i = 6; i >= 0; i--) { c.co[i] = t % 3; s += c.co[i]; t = Math.floor(t / 3); } c.co[7] = (3 - s % 3) % 3; }
  function getFlip(c) { let t = 0; for (let i = 0; i < 11; i++) t = t * 2 + c.eo[i]; return t; }
  function setFlip(c, t) { let s = 0; for (let i = 10; i >= 0; i--) { c.eo[i] = t & 1; s += c.eo[i]; t >>= 1; } c.eo[11] = s % 2; }
  function getSlice(c) { let a = 0, x = 0; for (let j = 11; j >= 0; j--) if (c.ep[j] >= 8) { a += cnk(11 - j, x + 1); x++; } return a; }
  function setSlice(c, idx) {
    const slice = [8, 9, 10, 11], other = [0, 1, 2, 3, 4, 5, 6, 7];
    for (let i = 0; i < 12; i++) c.ep[i] = -1;
    let x = 4;
    for (let j = 0; j < 12; j++) if (x > 0 && idx - cnk(11 - j, x) >= 0) { c.ep[j] = slice[4 - x]; idx -= cnk(11 - j, x); x--; }
    let y = 0; for (let j = 0; j < 12; j++) if (c.ep[j] === -1) c.ep[j] = other[y++];
  }
  // 順列の番号付け（レーマー符号）
  function permRank(arr, n) {
    let r = 0;
    for (let i = 0; i < n; i++) { let s = 0; for (let j = i + 1; j < n; j++) if (arr[j] < arr[i]) s++; r = r * (n - i) + s; }
    return r;
  }
  function permUnrank(r, n, base) {
    const code = new Array(n);
    for (let i = n - 1; i >= 0; i--) { code[i] = r % (n - i); r = Math.floor(r / (n - i)); }
    const pool = []; for (let i = 0; i < n; i++) pool.push(i);
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = pool.splice(code[i], 1)[0] + base;
    return out;
  }
  const getCP = (c) => permRank(c.cp, 8);
  const setCP = (c, r) => { c.cp = permUnrank(r, 8, 0); };
  const getEP8 = (c) => permRank(c.ep, 8);
  const setEP8 = (c, r) => { const p = permUnrank(r, 8, 0); for (let i = 0; i < 8; i++) c.ep[i] = p[i]; };
  const getSP = (c) => permRank(c.ep.slice(8).map((v) => v - 8), 4);
  const setSP = (c, r) => { const p = permUnrank(r, 4, 8); for (let i = 0; i < 4; i++) c.ep[8 + i] = p[i]; };

  // 手を座標に作用させる（座標だけを持つ cubie に掛ける）
  function applyMoveCorners(c, m) {
    const M = MOVES[m], cp = [], co = [];
    for (let i = 0; i < 8; i++) { cp[i] = c.cp[M.cp[i]]; co[i] = (c.co[M.cp[i]] + M.co[i]) % 3; }
    c.cp = cp; c.co = co;
  }
  function applyMoveEdges(c, m) {
    const M = MOVES[m], ep = [], eo = [];
    for (let i = 0; i < 12; i++) { ep[i] = c.ep[M.ep[i]]; eo[i] = (c.eo[M.ep[i]] + M.eo[i]) % 2; }
    c.ep = ep; c.eo = eo;
  }

  const N_TWIST = 2187, N_FLIP = 2048, N_SLICE = 495, N_PERM8 = 40320, N_SP = 24;
  const PHASE2_MOVES = [0, 1, 2, 9, 10, 11, 4, 13, 7, 16]; // U U2 U' D D2 D' R2 L2 F2 B2
  let T = null;

  function buildTables() {
    if (T) return T;
    const twistMove = new Uint16Array(N_TWIST * 18);
    const flipMove = new Uint16Array(N_FLIP * 18);
    const sliceMove = new Uint16Array(N_SLICE * 18);
    const cpMove = new Uint16Array(N_PERM8 * 18);
    const ep8Move = new Uint16Array(N_PERM8 * 18);
    const spMove = new Uint8Array(N_SP * 18);
    const c = solvedCubie();
    for (let i = 0; i < N_TWIST; i++) for (let m = 0; m < 18; m++) { setTwist(c, i); c.cp = [0, 1, 2, 3, 4, 5, 6, 7]; applyMoveCorners(c, m); twistMove[i * 18 + m] = getTwist(c); }
    for (let i = 0; i < N_FLIP; i++) for (let m = 0; m < 18; m++) { setFlip(c, i); c.ep = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]; applyMoveEdges(c, m); flipMove[i * 18 + m] = getFlip(c); }
    for (let i = 0; i < N_SLICE; i++) for (let m = 0; m < 18; m++) { setSlice(c, i); applyMoveEdges(c, m); sliceMove[i * 18 + m] = getSlice(c); }
    for (let i = 0; i < N_PERM8; i++) for (let m = 0; m < 18; m++) { setCP(c, i); applyMoveCorners(c, m); cpMove[i * 18 + m] = getCP(c); }
    c.ep = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    for (let i = 0; i < N_PERM8; i++) for (const m of PHASE2_MOVES) { setEP8(c, i); applyMoveEdges(c, m); ep8Move[i * 18 + m] = getEP8(c); }
    c.ep = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    for (let i = 0; i < N_SP; i++) for (const m of PHASE2_MOVES) { setSP(c, i); applyMoveEdges(c, m); spMove[i * 18 + m] = getSP(c); }

    function bfs(n1, n2, mv1, mv2, moves) {
      const size = n1 * n2, table = new Int8Array(size).fill(-1);
      table[0] = 0; let done = 1, depth = 0;
      while (done < size) {
        for (let i = 0; i < size; i++) {
          if (table[i] !== depth) continue;
          const a = Math.floor(i / n2), b = i % n2;
          for (const m of moves) {
            const j = mv1[a * 18 + m] * n2 + mv2[b * 18 + m];
            if (table[j] === -1) { table[j] = depth + 1; done++; }
          }
        }
        depth++;
      }
      return table;
    }
    const ALL = []; for (let m = 0; m < 18; m++) ALL.push(m);
    T = {
      twistMove, flipMove, sliceMove, cpMove, ep8Move, spMove,
      pTwistSlice: bfs(N_TWIST, N_SLICE, twistMove, sliceMove, ALL),
      pFlipSlice: bfs(N_FLIP, N_SLICE, flipMove, sliceMove, ALL),
      pCpSp: bfs(N_PERM8, N_SP, cpMove, spMove, PHASE2_MOVES),
      pEpSp: bfs(N_PERM8, N_SP, ep8Move, spMove, PHASE2_MOVES),
    };
    return T;
  }

  // ---- フェイスレット → cubie ----------------------------------------------
  function faceletToCubie(str) {
    if (typeof str !== 'string' || str.length !== 54) return { error: '54枚の色がそろっていません' };
    const f = [];
    for (let i = 0; i < 54; i++) { const k = FACES.indexOf(str[i]); if (k < 0) return { error: '不明な色があります' }; f.push(k); }
    const cnt = [0, 0, 0, 0, 0, 0]; f.forEach((k) => cnt[k]++);
    if (cnt.some((n) => n !== 9)) return { error: 'どの色もちょうど9枚ずつ必要です' };
    for (let i = 0; i < 6; i++) if (f[i * 9 + 4] !== i) return { error: '中心の色が重複しています' };
    const c = solvedCubie();
    const usedC = new Array(8).fill(false), usedE = new Array(12).fill(false);
    for (let i = 0; i < 8; i++) {
      let ori = 0;
      for (ori = 0; ori < 3; ori++) if (f[CORNER_FACELET[i][ori]] === 0 || f[CORNER_FACELET[i][ori]] === 3) break;
      if (ori === 3) return { error: 'ありえない角のパーツがあります' };
      const c1 = f[CORNER_FACELET[i][(ori + 1) % 3]], c2 = f[CORNER_FACELET[i][(ori + 2) % 3]];
      let found = -1;
      for (let j = 0; j < 8; j++) if (c1 === CORNER_COLOR[j][1] && c2 === CORNER_COLOR[j][2] && f[CORNER_FACELET[i][ori]] === CORNER_COLOR[j][0]) found = j;
      if (found < 0) return { error: 'ありえない角のパーツがあります（色の組み合わせを確認してください）' };
      if (usedC[found]) return { error: '同じ角のパーツが2つあります' };
      usedC[found] = true; c.cp[i] = found; c.co[i] = ori % 3;
    }
    for (let i = 0; i < 12; i++) {
      let found = -1;
      for (let j = 0; j < 12; j++) {
        if (f[EDGE_FACELET[i][0]] === EDGE_COLOR[j][0] && f[EDGE_FACELET[i][1]] === EDGE_COLOR[j][1]) { found = j; c.eo[i] = 0; }
        else if (f[EDGE_FACELET[i][0]] === EDGE_COLOR[j][1] && f[EDGE_FACELET[i][1]] === EDGE_COLOR[j][0]) { found = j; c.eo[i] = 1; }
      }
      if (found < 0) return { error: 'ありえない辺のパーツがあります（色の組み合わせを確認してください）' };
      if (usedE[found]) return { error: '同じ辺のパーツが2つあります' };
      usedE[found] = true; c.ep[i] = found;
    }
    if (c.co.reduce((a, b) => a + b, 0) % 3 !== 0) return { error: '角が1つねじれています（分解して組み直さないと揃いません）' };
    if (c.eo.reduce((a, b) => a + b, 0) % 2 !== 0) return { error: '辺が1つ反転しています（分解して組み直さないと揃いません）' };
    const parity = (p) => { let s = 0; for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) if (p[j] < p[i]) s++; return s % 2; };
    if (parity(c.cp) !== parity(c.ep)) return { error: '2つのパーツが入れ替わっています（分解して組み直さないと揃いません）' };
    return { cubie: c };
  }

  // ---- 探索 -----------------------------------------------------------------
  function solve(facelets, opts) {
    opts = opts || {};
    const timeLimit = opts.timeLimit != null ? opts.timeLimit : 6000;
    const onProgress = opts.onProgress || null;
    const r = faceletToCubie(facelets);
    if (r.error) return { error: r.error };
    const cube = r.cubie;
    const t = buildTables();
    const start = Date.now();
    const twist0 = getTwist(cube), flip0 = getFlip(cube), slice0 = getSlice(cube);

    let best = null, bestLen = 99, timedOut = false, nodes = 0;
    const path1 = new Int8Array(32), path2 = new Int8Array(32);
    const tw = new Int32Array(32), fl = new Int32Array(32), sl = new Int32Array(32);
    const cpA = new Int32Array(32), epA = new Int32Array(32), spA = new Int32Array(32);

    const face = (m) => (m / 3) | 0;
    // 同じ面の連続と、向かい合う面の順序の重複を除く（U→D はOK、D→U は禁止など）
    const allowed = (prev, m) => {
      if (prev < 0) return true;
      const a = face(prev), b = face(m);
      return a !== b && !(a === b + 3);
    };

    function phase2(d1, maxDepth) {
      // フェーズ1の手順を適用してフェーズ2の座標を得る
      const c = { cp: cube.cp.slice(), co: cube.co.slice(), ep: cube.ep.slice(), eo: cube.eo.slice() };
      for (let i = 0; i < d1; i++) { applyMoveCorners(c, path1[i]); applyMoveEdges(c, path1[i]); }
      cpA[0] = getCP(c); epA[0] = getEP8(c); spA[0] = getSP(c);
      const h0 = Math.max(t.pCpSp[cpA[0] * 24 + spA[0]], t.pEpSp[epA[0] * 24 + spA[0]]);
      if (h0 > maxDepth) return -1;
      const last = d1 > 0 ? path1[d1 - 1] : -1;
      for (let depth = h0; depth <= maxDepth; depth++) {
        if (search2(0, depth, last)) return depth;
      }
      return -1;
    }
    function search2(n, depth, prev) {
      const cp = cpA[n], ep = epA[n], sp = spA[n];
      if (n === depth) return cp === 0 && ep === 0 && sp === 0;
      for (let k = 0; k < 10; k++) {
        const m = PHASE2_MOVES[k];
        if (!allowed(prev, m)) continue;
        const ncp = t.cpMove[cp * 18 + m], nep = t.ep8Move[ep * 18 + m], nsp = t.spMove[sp * 18 + m];
        const h = Math.max(t.pCpSp[ncp * 24 + nsp], t.pEpSp[nep * 24 + nsp]);
        if (h > depth - n - 1) continue;
        cpA[n + 1] = ncp; epA[n + 1] = nep; spA[n + 1] = nsp; path2[n] = m;
        if (search2(n + 1, depth, m)) return true;
      }
      return false;
    }
    function search1(n, d1) {
      if ((++nodes & 1023) === 0 && Date.now() - start > timeLimit && best) { timedOut = true; return; }
      if (timedOut) return;
      if (n === d1) {
        if (tw[n] !== 0 || fl[n] !== 0 || sl[n] !== 0) return;
        // フェーズ1の最後の手は R/L/F/B の 1/4 回転でなければならない（重複を避ける）
        if (n > 0) { const m = path1[n - 1], f = face(m); if (f === 0 || f === 3 || m % 3 === 1) return; }
        const limit = Math.min(bestLen - 1 - d1, 18);
        if (limit < 0) return;
        const d2 = phase2(d1, limit);
        if (d2 >= 0) {
          const moves = [];
          for (let i = 0; i < d1; i++) moves.push(path1[i]);
          for (let i = 0; i < d2; i++) moves.push(path2[i]);
          best = moves; bestLen = moves.length;
          if (onProgress) onProgress({ moves: moves.map((m) => MOVE_NAMES[m]), length: bestLen, elapsed: Date.now() - start });
        }
        return;
      }
      const prev = n > 0 ? path1[n - 1] : -1;
      for (let m = 0; m < 18; m++) {
        if (!allowed(prev, m)) continue;
        const a = t.twistMove[tw[n] * 18 + m], b = t.flipMove[fl[n] * 18 + m], s = t.sliceMove[sl[n] * 18 + m];
        const h = Math.max(t.pTwistSlice[a * 495 + s], t.pFlipSlice[b * 495 + s]);
        if (h > d1 - n - 1) continue;
        tw[n + 1] = a; fl[n + 1] = b; sl[n + 1] = s; path1[n] = m;
        search1(n + 1, d1);
        if (timedOut) return;
      }
    }

    tw[0] = twist0; fl[0] = flip0; sl[0] = slice0;
    let d1 = 0;
    for (; d1 < bestLen && d1 <= 20; d1++) {
      search1(0, d1);
      if (timedOut) break;
    }
    const moves = best ? best.map((m) => MOVE_NAMES[m]) : [];
    return { moves, length: moves.length, optimal: !timedOut, elapsed: Date.now() - start };
  }

  const api = { solve, faceletToCubie, buildTables, MOVE_NAMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CubeSolver = api;

  // Web Worker として動いているとき
  if (typeof WorkerGlobalScope !== 'undefined' && root instanceof WorkerGlobalScope) {
    root.onmessage = (e) => {
      const { id, type, facelets, timeLimit } = e.data;
      if (type === 'init') { const s = Date.now(); buildTables(); root.postMessage({ id, type: 'ready', ms: Date.now() - s }); return; }
      if (type === 'solve') {
        const res = solve(facelets, { timeLimit, onProgress: (p) => root.postMessage({ id, type: 'progress', ...p }) });
        root.postMessage({ id, type: 'done', ...res });
      }
    };
  }
})(typeof self !== 'undefined' ? self : globalThis);
