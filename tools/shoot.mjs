// Снимает контрольные скриншоты сцены в headless-Chromium (Playwright).
//   node tools/shoot.mjs [url] [outDir] [имя=query ...]
// Браузер: CHROMIUM_PATH, иначе @sparticuz/chromium (если установлен), иначе штатный браузер Playwright.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:8080/';
const out = process.argv[3] || 'shots';
const extra = process.argv.slice(4);
const shots = extra.length ? extra.map((s) => { const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)]; }) : [
  ['01_side', 'view=side'], ['02_top', 'view=top'], ['03_front', 'view=front'], ['04_turret34', 'view=turret'],
];
let executablePath = process.env.CHROMIUM_PATH, args = [];
if (!executablePath) {
  try { const sp = (await import('@sparticuz/chromium')).default; executablePath = await sp.executablePath(); args = sp.args; } catch { /* штатный браузер playwright */ }
}
args = [...args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ executablePath, args, headless: true });
const page = await browser.newPage({ viewport: { width: +(process.env.W || 1600), height: +(process.env.H || 900) }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 400)); });
let failed = null;
page.on('pageerror', (e) => { failed = e.message.split('\n').slice(0, 6).join('\n'); console.log('[pageerror]', failed); });
fs.mkdirSync(out, { recursive: true });
for (const [name, q] of shots) {
  const t = Date.now();
  await page.goto(`${url}?ui=0&still=1&ss=${process.env.SS || 2}&${q}`);
  for (let i = 0; i < 1800 && !failed; i++) { if (await page.evaluate('window.__ready === true')) break; await page.waitForTimeout(100); }
  if (failed) { await browser.close(); process.exit(1); }
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 180000 });
  console.log(name, Date.now() - t, 'ms', 'frame', Math.round(await page.evaluate('window.__frameMs')), 'ms');
}
await browser.close();
