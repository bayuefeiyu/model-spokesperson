import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(process.argv[2], { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await mkdir('evidence/private', { recursive: true });
  await page.screenshot({ path: 'evidence/private/browser-smoke.png', fullPage: true });
  await writeFile('evidence/private/browser-text.txt', await page.locator('body').innerText());
  console.log(JSON.stringify({ errors, text: (await page.locator('body').innerText()).slice(0, 10000) }, null, 2));
} finally { await browser.close(); }
