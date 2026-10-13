import { chromium } from 'playwright';

const ADMIN_WALLET = '9qeZq8CrzirE56Au3QmHc5RUdBSGCZfmcoLtkdanGvGv';
const BASE = 'http://localhost:5173';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();

const network = [];
const consoleErrors = [];
page.on('request', (r) => {
  if (r.url().includes('/functions/v1/')) network.push(`REQ  ${r.method()} ${r.url()}`);
});
page.on('response', (r) => {
  if (r.url().includes('/functions/v1/')) {
    network.push(`RESP ${r.status()} ${r.url()} ACAO=${r.headers()['access-control-allow-origin'] ?? '-'}`);
  }
});
page.on('requestfailed', (r) => {
  if (r.url().includes('/functions/v1/')) {
    network.push(`FAIL ${r.url()} -> ${r.failure()?.errorText ?? ''}`);
  }
});
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});

await page.addInitScript(
  (wallet) => {
    const pubkey = { toString: () => wallet };
    window.solana = {
      isPhantom: true,
      publicKey: pubkey,
      async connect() { return { publicKey: pubkey }; },
      async signMessage(_msg, _enc) { return { signature: new Uint8Array(64).fill(7) }; },
      async disconnect() {},
    };
    try { localStorage.setItem('userWallet', wallet); } catch {}
  },
  ADMIN_WALLET
);

await page.goto(`${BASE}/#/create`);
await page.waitForSelector('#form-create');
await page.fill('input[name="title"]', 'Repro Bug 1 CORS');
await page.fill('textarea[name="description"]', 'Deskripsi repro bug satu untuk bukti CORS failed to fetch.');
await page.fill('input[name="target_amount"]', '1');
await page.screenshot({ path: '/tmp/repro-bug1-filled.png', fullPage: true });
await page.click('#form-create button[type="submit"]');

await page.waitForSelector('.toast', { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(800);

const toasts = await page.evaluate(() =>
  [...document.querySelectorAll('.toast')].map((t) => t.textContent)
);
await page.screenshot({ path: '/tmp/repro-bug1-result.png', fullPage: true });

console.log('=== NETWORK (edge functions) ===');
console.log(network.join('\n'));
console.log('=== CONSOLE ERRORS ===');
console.log(consoleErrors.join('\n') || '(none)');
console.log('=== TOASTS ===');
console.log(toasts.join('\n') || '(none)');

await browser.close();