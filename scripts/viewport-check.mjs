#!/usr/bin/env node
/**
 * Unit 16, proxy two (D65, as amended by D66): no page scrolls sideways on a
 * supported desktop. A board that scrolls horizontally at a size we claim to
 * support is the one visual failure that is objectively a bug rather than a
 * taste. v1 is desktop only (D66), so the viewports are 1280x800 — the
 * smallest desktop we support — and 1920x1080. Narrower widths are not
 * checked on purpose.
 *
 * NOT part of `npm test` (D65): it needs a running server with art and a real
 * browser. It drives a headless Chrome over the DevTools protocol using
 * Node's built-in WebSocket — no dependency enters package.json — and saves a
 * screenshot of every page at every viewport, so the next visual change has a
 * "before" to compare against. Every page is also re-checked with its
 * JavaScript disabled, since the pages must work without the enhancement script.
 *
 * Usage:
 *   node scripts/viewport-check.mjs <baseUrl> <joinToken> <gameId> [outDir]
 *   e.g. node scripts/viewport-check.mjs http://localhost:8099 94cc… 66ce… docs/visual-pass/2026-09-30
 *
 * Exit code 1 if any page overflows, naming the widest offending elements.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
];

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const [base, joinToken, gameId, outDir] = process.argv.slice(2);
if (!base || !joinToken || !gameId) {
  console.error('usage: node scripts/viewport-check.mjs <baseUrl> <joinToken> <gameId> [outDir]');
  process.exit(2);
}
if (!existsSync(CHROME)) {
  console.error(`viewport-check: Chrome not found at ${CHROME} (set CHROME=/path/to/chrome)`);
  process.exit(2);
}

const PAGES = [
  { name: 'inbox', path: '/' },
  { name: 'board', path: `/games/${gameId}` },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Launch headless Chrome on a throwaway profile and return its DevTools port. */
async function launch() {
  const profile = mkdtempSync(join(tmpdir(), 'oath-viewport-'));
  const proc = spawn(
    CHROME,
    ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', 'about:blank'],
    { stdio: 'ignore' },
  );
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  if (!existsSync(portFile)) throw new Error('Chrome did not start (no DevToolsActivePort)');
  const port = readFileSync(portFile, 'utf8').split('\n')[0].trim();
  return { proc, profile, port };
}

/** A minimal CDP client over one page target. */
async function connect(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const pending = new Map();
  const waiters = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method) {
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].method === msg.method) waiters.splice(i, 1)[0].res(msg.params);
      }
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const n = ++id;
      pending.set(n, { res, rej });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const once = (method) => new Promise((res) => waiters.push({ method, res }));
  return { send, once, close: () => ws.close() };
}

async function navigate(cdp, url) {
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url });
  await loaded;
  // Card faces are loading="lazy", and a headless page never scrolls, so
  // below-the-fold images would never load — leaving them height-less and
  // the layout (and the screenshot) incomplete. Force every image in, and
  // wait until all of them have decoded, before measuring anything.
  await cdp.send('Runtime.evaluate', {
    awaitPromise: true,
    expression: `(async () => {
      const imgs = [...document.images];
      for (const i of imgs) i.loading = 'eager';
      await Promise.all(imgs.map((i) => (i.complete && i.naturalWidth ? null : i.decode().catch(() => null))));
      return imgs.filter((i) => !i.naturalWidth).map((i) => i.getAttribute('src'));
    })()`,
  });
  await sleep(250);
}

/** In-page: does the document scroll sideways, and if so, who is responsible? */
const MEASURE = `(() => {
  const d = document.documentElement;
  const cw = d.clientWidth;
  const offenders = [...document.querySelectorAll('body *')]
    .map((e) => ({ e, r: e.getBoundingClientRect() }))
    .filter(({ r }) => r.right > cw + 1 && r.width > 0)
    .sort((a, b) => b.r.right - a.r.right)
    .slice(0, 5)
    .map(({ e, r }) => e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/).join('.') : '') + ' → right ' + Math.round(r.right) + 'px');
  return { scrollWidth: d.scrollWidth, clientWidth: cw, offenders };
})()`;

const { proc, profile, port } = await launch();
let failures = 0;
try {
  const cdp = await connect(port);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  // Sign in the way a player does: the join link sets the session cookie.
  await navigate(cdp, `${base}/join/${joinToken}`);

  if (outDir) mkdirSync(outDir, { recursive: true });
  // Each page twice: as served, and with the page's own JavaScript disabled —
  // the checklist's "it works with the enhancement script deleted". The pages
  // are server-rendered (D57); the one script only adds hover-to-enlarge, so
  // the no-JS pass must lay out identically. (DevTools' own Runtime.evaluate
  // still runs with page scripts off, which is what the measuring uses.)
  for (const vp of VIEWPORTS) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...vp, deviceScaleFactor: 1, mobile: false });
    for (const noJs of [false, true]) {
      await cdp.send('Emulation.setScriptExecutionDisabled', { value: noJs });
      for (const pg of PAGES) {
        await navigate(cdp, base + pg.path);
        const { result } = await cdp.send('Runtime.evaluate', { expression: MEASURE, returnByValue: true });
        const m = result.value;
        // The page must still be the page: the board without JS still has its map.
        const { result: shape } = await cdp.send('Runtime.evaluate', {
          expression: pg.name === 'board' ? "!!document.querySelector('.board-map .bsite')" : "!!document.querySelector('main h1')",
          returnByValue: true,
        });
        const ok = m.scrollWidth <= m.clientWidth && shape.value === true;
        if (!ok) failures++;
        const label = `${pg.name}${noJs ? ' (no JS)' : ''}`.padEnd(14);
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} ${vp.width}x${vp.height}  scrollWidth ${m.scrollWidth} / clientWidth ${m.clientWidth}${shape.value ? '' : '  — page content missing'}`);
        if (m.scrollWidth > m.clientWidth) for (const o of m.offenders) console.log(`        ${o}`);

        if (outDir && !noJs) {
          // JPEG, not PNG: a full-page board is ~5 MB as PNG, too heavy to keep in git.
          const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 80, captureBeyondViewport: true });
          writeFileSync(join(outDir, `${pg.name}-${vp.width}x${vp.height}.jpg`), Buffer.from(shot.data, 'base64'));
        }
      }
    }
  }
  cdp.close();
} finally {
  proc.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} page/viewport combination(s) scroll sideways.` : '\nNo page scrolls sideways at a supported desktop size.');
process.exit(failures ? 1 : 0);
