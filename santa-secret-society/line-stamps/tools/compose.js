const { chromium } = require('playwright');
const fs = require('fs');
const B = '/tmp/claude-0/-home-user/df0b834d-5ef0-52cb-85b6-57a2955a03aa/scratchpad/';
const FONT = B + 'fonts/node_modules/@fontsource/dela-gothic-one/files/dela-gothic-one-japanese-400-normal.woff2';
const SANTA = { fill: '#e8102e', fill2: '#ff5a5a', in: '#fff', out: '#4a0010' };
const KUROU = { fill: '#7b2cff', fill2: '#c070ff', in: '#fff', out: '#16062c' };
const DEER = { fill: '#9a4e1c', fill2: '#e0802a', in: '#fff', out: '#2a1204' };
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
      if (o.zzz) { g.save(); g.font = '34px Dela'; g.textAlign = 'center'; g.lineJoin = 'round'; [['Z', 70, 150, 34], ['z', 40, 185, 26], ['z', 18, 212, 20]].forEach(([s, x, y, z]) => { g.font = `${z}px Dela`; g.lineWidth = z * .35; g.strokeStyle = '#fff'; g.strokeText(s, x, y); g.fillStyle = '#4a6aff'; g.fillText(s, x, y); }); g.restore(); }
    }
    return c.toDataURL('image/png');
  }, [id, text, C, o, Wd, Ht, mode]);
  const save = (name, url) => fs.writeFileSync(B + 'out/' + name, Buffer.from(url.split(',')[1], 'base64'));
  let n = 1;
  for (const [id, text, C, o] of L) save(String(n++).padStart(2, '0') + '.png', await draw(id, text, C, o, 370, 320));
  save('main.png', await draw('03_kakatte', '', SANTA, {}, 240, 240, 'main'));
  save('tab.png', await draw('06_merikuri', '', SANTA, {}, 96, 74, 'tab'));
  await b.close(); console.log('ok');
})();
