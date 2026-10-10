// Logic tests for the wallpaper engine (browser mode and Wallpaper Engine mode).
// Serves the repository on :8765 and loads each test page in a headless Chrome
// with virtual time, then reads the results the page writes into #out.
//   node dev/plexus-wallpaper/run.mjs
// Set CHROME to the browser binary when it is not the default Windows Chrome.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 8765;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1');

function run(page, budget) {
  return new Promise((resolve) => {
    const chrome = spawn(CHROME, [
      '--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run',
      '--autoplay-policy=no-user-gesture-required',
      `--user-data-dir=${path.join(os.tmpdir(), 'plexus-we-test-' + Date.now())}`,
      '--window-size=1280,720', `--virtual-time-budget=${budget}`, '--dump-dom',
      `http://127.0.0.1:${PORT}/dev/plexus-wallpaper/${page}`
    ]);
    let dom = '';
    chrome.stdout.on('data', (d) => { dom += d; });
    chrome.on('exit', () => {
      const m = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/);
      resolve(m ? m[1].replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&amp;/g, '&') : 'no output');
    });
  });
}

let failed = 0;
// Virtual time only advances when the page is idle: SwiftShader rendering makes
// each page take a few real minutes
const PAGES = [
  ['browser', 'tests.html', 60000],
  ['Wallpaper Engine (?we=1)', 'tests.html?we=1', 60000]
];
for (const [name, page, budget] of PAGES) {
  const out = await run(page, budget);
  const lines = out.split('\n');
  const pass = lines.filter((l) => l.startsWith('PASS')).length;
  const fail = lines.filter((l) => /^(FAIL|EXCEPTION)/.test(l));
  const done = lines.includes('DONE');
  failed += fail.length + (done ? 0 : 1);
  console.log(`${name}: ${pass} PASS / ${fail.length} FAIL${done ? '' : ' (did not finish)'}`);
  fail.forEach((l) => console.log('  ' + l));
  lines.filter((l) => l.startsWith('ERROS') || l.startsWith('INFO')).forEach((l) => console.log('  ' + l));
}
server.close();
process.exit(failed ? 1 : 0);
