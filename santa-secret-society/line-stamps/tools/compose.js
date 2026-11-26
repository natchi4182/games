const { chromium } = require('playwright');
const fs = require('fs');
const B = '/tmp/claude-0/-home-user/df0b834d-5ef0-52cb-85b6-57a2955a03aa/scratchpad/';
const FONT = B + 'fonts/node_modules/@fontsource/dela-gothic-one/files/dela-gothic-one-japanese-400-normal.woff2';
const SANTA = { fill: '#e8102e', fill2: '#ff5a5a', in: '#fff', out: '#4a0010' };
const KUROU = { fill: '#7b2cff', fill2: '#c070ff', in: '#fff', out: '#16062c' };
const DEER = { fill: '#9a4e1c', fill2: '#e0802a', in: '#fff', out: '#2a1204' };
const XMAS = { fill: '#178a3a', fill2: '#5ad86a', in: '#fff', out: '#063014' };
const GOLD = { fill: '#e8a800', fill2: '#ffe066', in: '#fff', out: '#4a2a00' };
const L = [
  ['01_ok', 'OK！', GOLD, { pos: 'top', rot: -6 }],
  ['02_makasero', '任せろ！', SANTA, { pos: 'top', rot: -5, cx: .65 }],
  ['03_kakatte', 'かかってこい！', SANTA, { pos: 'top', size: 46, rot: -3 }],
  ['04_chiin', 'ちーん…', SANTA, { pos: 'top', rot: 0, ch: .55 }],
  ['05_yatta', 'やったー！', SANTA, { pos: 'top', rot: -6 }],
  ['06_merikuri', 'メリクリ！', SANTA, { pos: 'top', rot: -6, cx: .42 }],
  ['07_roger', 'ラジャー！', SANTA, { pos: 'top', rot: -5 }],
  ['08_arigato', 'ありがとう！', SANTA, { pos: 'top', size: 50, rot: -4 }],
  ['09_yurusan', 'ゆるさん！！', KUROU, { pos: 'top', size: 54, rot: -6 }],
  ['10_miteru', '…見てるぞ', KUROU, { pos: 'top', rot: 0 }],
  ['11_fuhaha', 'フハハハ！', KUROU, { pos: 'top', rot: -6 }],
  ['12_gunu', 'ぐぬぬ…', KUROU, { pos: 'top', rot: 3 }],
  ['13_yarareta', 'やられた…', KUROU, { pos: 'top', rot: 4 }],
  ['14_sugu', 'すぐ行く！', DEER, { pos: 'top', rot: -6 }],
  ['15_hirameita', 'ひらめいた！', DEER, { pos: 'top', size: 50, rot: -4 }],
  ['16_oyasumi', 'おやすみ〜', DEER, { pos: 'top', rot: 0, zzz: true }],
  ['17_hohoho', 'ホーホーホー！', SANTA, { rot: -5, snow: true }],
  ['18_present', 'プレゼントだよ！', SANTA, { rot: -4, size: 46, star: true }],
  ['19_iiko', 'いい子にしてた？', SANTA, { rot: -3, size: 46 }],
  ['20_merry', 'メリークリスマス！', XMAS, { rot: -4, size: 42, snow: true, star: true }],
  ['21_kuribocchi', 'クリぼっち…', KUROU, { rot: 3, snow: true }],
  ['22_kureteyaru', 'くれてやる！', KUROU, { rot: -5 }],
  ['23_haitatsu', '配達中！', DEER, { rot: -6, star: true }],
  ['24_jingle', 'ジングルベル♪', DEER, { rot: -4, size: 50, notes: true }],
];
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.route('http://c.test/**', r => { const u = new URL(r.request().url()).pathname; if (u === '/font.woff2') return r.fulfill({ path: FONT, contentType: 'font/woff2' }); if (u.startsWith('/st/')) return r.fulfill({ path: B + u.slice(1), contentType: 'image/png' }); r.fulfill({ body: '<html><body></body></html>', contentType: 'text/html' }); });
  await p.goto('http://c.test/');
  await p.evaluate(async () => { const f = new FontFace('Dela', 'url(/font.woff2)'); await f.load(); document.fonts.add(f); });
  const draw = async (id, text, C, o, Wd, Ht, mode) => p.evaluate(async ([id, text, C, o, Wd, Ht, mode]) => {
    const img = new Image(); img.src = '/st/' + id + '.png'; await img.decode();
    // 余白を除いた範囲
    const t = document.createElement('canvas'); t.width = img.width; t.height = img.height; const tg = t.getContext('2d'); tg.drawImage(img, 0, 0);
    const id0 = tg.getImageData(0, 0, t.width, t.height), d = id0.data; let x0 = t.width, y0 = t.height, x1 = 0, y1 = 0;
    // かすかな光のにじみは切り捨てる（四角い縁が出ないように）
    for (let i = 3; i < d.length; i += 4) d[i] = Math.max(0, Math.min(255, (d[i] - 36) * 255 / 219)); tg.putImageData(id0, 0, 0);
    for (let y = 0; y < t.height; y++) for (let x = 0; x < t.width; x++) if (d[(y * t.width + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const c = document.createElement('canvas'); c.width = Wd; c.height = Ht; const g = c.getContext('2d');
    const M = mode === 'tab' ? 2 : mode === 'main' ? 8 : 10, top = text ? (o.ch ? Ht * .34 : Ht * .2) : 0;
    let bw = x1 - x0, bh = y1 - y0, sx = x0, sy = y0;
    if (mode === 'tab') { bh = Math.min(bh, bw * .9); }
    const sc = Math.min((Wd - M * 2) / bw, (Ht - M * 2 - top) / bh, mode ? 99 : 1.6);
    const dw = bw * sc, dh = bh * sc, dx = (Wd - dw) * (o.cx ?? .5), dy = Ht - M - dh;
    g.drawImage(t, sx, sy, bw, bh, Math.max(M, Math.min(Wd - M - dw, dx)), mode === 'tab' ? (Ht - dh) / 2 : dy, dw, dh);
    if (text) {
      let size = o.size || 60; g.font = `${size}px Dela`; while (g.measureText(text).width > Wd - M * 2 - 24) { size -= 2; g.font = `${size}px Dela`; }
      g.save(); g.translate(Wd / 2, M + size * .62 + 4); g.rotate((o.rot || 0) * Math.PI / 180);
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      g.lineWidth = size * .42; g.strokeStyle = C.out; g.strokeText(text, 0, 0);
      g.lineWidth = size * .26; g.strokeStyle = C.in; g.strokeText(text, 0, 0);
      const gr = g.createLinearGradient(0, -size / 2, 0, size / 2); gr.addColorStop(0, C.fill2); gr.addColorStop(.55, C.fill); gr.addColorStop(1, C.fill);
      g.fillStyle = gr; g.fillText(text, 0, 0); g.restore();
      const occ = g.getImageData(0, 0, Wd, Ht).data, free = (x, y, r) => { for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) { const X = Math.round(x + dx), Y = Math.round(y + dy); if (X < 0 || Y < 0 || X >= Wd || Y >= Ht || occ[(Y * Wd + X) * 4 + 3] > 10) return false; } return true; };
      const deco = (n, fn) => { let sd = n * 7 + Wd + text.length * 13; const R = () => (sd = (sd * 9301 + 49297) % 233280) / 233280; let k = 0, tries = 0; while (k < n && tries++ < n * 20) { if (fn(R(), R(), R()) !== false) k++; } };
      if (o.snow) deco(14, (a, b, c3) => { const x = M + a * (Wd - M * 2), y = Ht * .3 + b * (Ht * .65 - M), r = 3 + c3 * 5; if (!free(x, y, r + 6)) return false; g.save(); g.translate(x, y); g.strokeStyle = '#8ab8ff'; g.lineWidth = 5; g.lineCap = 'round';
        for (let k = 0; k < 3; k++) { g.rotate(Math.PI / 3); g.beginPath(); g.moveTo(-r, 0); g.lineTo(r, 0); g.stroke(); } g.strokeStyle = '#fff'; g.lineWidth = 2.4; for (let k = 0; k < 3; k++) { g.rotate(Math.PI / 3); g.beginPath(); g.moveTo(-r, 0); g.lineTo(r, 0); g.stroke(); } g.restore(); });
      if (o.star) deco(6, (a, b, c3) => { const x = M + 8 + a * (Wd - M * 2 - 16), y = Ht * .32 + b * Ht * .55, r = 7 + c3 * 8; if (!free(x, y, r + 4)) return false; g.save(); g.translate(x, y); g.beginPath(); for (let k = 0; k < 8; k++) { const rr = k % 2 ? r * .3 : r; g.lineTo(Math.cos(k * Math.PI / 4) * rr, Math.sin(k * Math.PI / 4) * rr); } g.closePath();
        g.lineWidth = 4; g.strokeStyle = '#fff'; g.stroke(); g.fillStyle = '#ffc820'; g.fill(); g.restore(); });
      if (o.notes) [['♪', 40, 150, 40], ['♫', 320, 170, 44], ['♪', 300, 250, 32]].forEach(([s, x, y, z]) => { g.font = `${z}px Dela`; g.textAlign = 'center'; g.lineJoin = 'round'; g.lineWidth = z * .3; g.strokeStyle = '#fff'; g.strokeText(s, x, y); g.fillStyle = '#e8a800'; g.fillText(s, x, y); });
      if (o.zzz) { g.save(); g.font = '34px Dela'; g.textAlign = 'center'; g.lineJoin = 'round'; [['Z', 70, 150, 34], ['z', 40, 185, 26], ['z', 18, 212, 20]].forEach(([s, x, y, z]) => { g.font = `${z}px Dela`; g.lineWidth = z * .35; g.strokeStyle = '#fff'; g.strokeText(s, x, y); g.fillStyle = '#4a6aff'; g.fillText(s, x, y); }); g.restore(); }
    }
    return c.toDataURL('image/png');
  }, [id, text, C, o, Wd, Ht, mode]);
  const save = (name, url) => fs.writeFileSync(B + 'out/' + name, Buffer.from(url.split(',')[1], 'base64'));
  let n = 1;
  for (const [id, text, C, o] of L) save(String(n++).padStart(2, '0') + '.png', await draw(id, text, C, o, 370, 320));
  save('main.png', await draw('20_merry', '', SANTA, {}, 240, 240, 'main'));
  save('tab.png', await draw('06_merikuri', '', SANTA, {}, 96, 74, 'tab'));
  await b.close(); console.log('ok');
})();
