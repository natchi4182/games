const { chromium } = require('playwright');
const fs = require('fs');
const NM = '/tmp/claude-0/-home-user/df0b834d-5ef0-52cb-85b6-57a2955a03aa/scratchpad/t3/node_modules/three/';
const SPECS = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 900, height: 900 } });
  await ctx.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', r => { const path = new URL(r.request().url()).pathname.replace('/npm/three@0.160.0/', ''); r.fulfill({ path: NM + path, contentType: 'application/javascript' }); });
  await ctx.route('http://g.test/**', r => { const f = '/home/user/games/santa-secret-society' + new URL(r.request().url()).pathname; r.fulfill({ path: f, contentType: f.endsWith('.glb') ? 'model/gltf-binary' : f.endsWith('.json') ? 'application/json' : 'text/html' }); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://g.test/fight3d.html?studio');
  await p.waitForFunction(() => window.__studio && window.__studio.ready, null, { timeout: 120000 });
  for (const sp of SPECS) {
    const url = await p.evaluate(s => window.__studio.snap(s), sp);
    fs.writeFileSync(`st/${sp.id}.png`, Buffer.from(url.split(',')[1], 'base64'));
  }
  console.log('done', SPECS.length, errs);
  await b.close();
})();
