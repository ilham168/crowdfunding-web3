import { chromium } from 'playwright';

const ADMIN_WALLET = '9qeZq8CrzirE56Au3QmHc5RUdBSGCZfmcoLtkdanGvGv';
const BASE = 'http://localhost:5173';

// BUG 2 fixture: campaign dengan ketiga status SUPARTA ada dalam satu query.
const FIXTURE = [
  {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    title: 'Campaign AKTIF — buka donasi',
    creator_wallet: ADMIN_WALLET,
    status: 'active',
    flag_reason: null,
    created_at: '2026-10-01T00:00:00.000Z',
  },
  {
    id: 'aaaaaaaa-0000-0000-0000-000000000002',
    title: 'Campaign DITINJAU (flagged)',
    creator_wallet: ADMIN_WALLET,
    status: 'flagged',
    flag_reason: 'Bukti penggunaan dana tidak kunjung diunggah oleh penggalang.',
    created_at: '2026-10-02T00:00:00.000Z',
  },
  {
    id: 'aaaaaaaa-0000-0000-0000-000000000003',
    title: 'Campaign DITUTUP oleh creator',
    creator_wallet: ADMIN_WALLET,
    status: 'closed',
    flag_reason: null,
    created_at: '2026-10-03T00:00:00.000Z',
  },
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();

// Suntikkan data uji: hanya mencegat query REST campaigns (bukan edge function).
await page.route(/rest\/v1\/campaigns\?.*select=.*flag_reason/, (route) => {
  const req = route.request();
  if (req.method() === 'GET') {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': 'http://localhost:5173' },
      body: JSON.stringify(FIXTURE),
    });
  } else {
    route.continue();
  }
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

await page.goto(`${BASE}/#/admin`);
await page.waitForSelector('#admin-body .table-panel', { timeout: 12000 });

const snapshot = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#admin-body table.ledger-table tr[data-campaign]')];
  return rows.map((row) => {
    const title = row.querySelector('td[data-label="Judul"] a')?.textContent?.trim() ?? '';
    const badge = row.querySelector('.status-badge');
    const badgeText = badge?.textContent?.trim() ?? '';
    const badgeClass = badge?.className ?? '';
    const extra = row.querySelector('.flag-reason')?.textContent?.trim() ?? '';
    const actions = [...row.querySelectorAll('button[data-action]')].map(
      (b) => `${b.dataset.action}="${b.textContent.trim()}"`
    );
    return { title, badgeText, badgeClass, extra, actions };
  });
});

await page.screenshot({ path: '/tmp/repro-bug2-mixed.png', fullPage: true });

console.log('=== BARIS YANG DI-RENDER (satu tabel tanpa pemisahan status) ===');
console.log(JSON.stringify(snapshot, null, 2));
console.log('=== BUG 2 CHECKLIST (expected vs actual) ===');
const actualActive = snapshot.find((r) => r.title.includes('AKTIF'));
const actualFlagged = snapshot.find((r) => r.title.includes('DITINJAU'));
const actualClosed = snapshot.find((r) => r.title.includes('DITUTUP'));
console.log(`active  -> actions: ${JSON.stringify(actualActive?.actions ?? [])} | disukai spec: ["Tandai Ditinjau"]`);
console.log(`flagged -> actions: ${JSON.stringify(actualFlagged?.actions ?? [])} | disukai spec: ["Aktifkan lagi","Tutup"]`);
console.log(`closed  -> actions: ${JSON.stringify(actualClosed?.actions ?? [])} | disukai spec: [] (hanya badge "Ditutup")`);

const okActive = (actualActive?.actions ?? []).length === 1 && actualActive.actions[0].startsWith('flagged');
const okFlagged = (actualFlagged?.actions?.length ?? 0) === 2 &&
  actualFlagged.actions[0].startsWith('active') && actualFlagged.actions[1].startsWith('closed');
const okClosed = (actualClosed?.actions ?? []).length === 0;
console.log(`RESULT: active=${okActive} flagged=${okFlagged} closed=${okClosed} -> ${okActive && okFlagged && okClosed ? 'BUG 2 TERFIX' : 'MASIH RUSAK'}`);

// --- Tab/filter: hitung, aria-selected, dan klik filter per status. ---
const tabInfo = await page.evaluate(() => {
  const tabs = [...document.querySelectorAll('#campaigns-section button[data-filter]')];
  return tabs.map((t) => ({
    filter: t.dataset.filter,
    text: t.textContent.trim(),
    selected: t.getAttribute('aria-selected'),
    activeClass: t.classList.contains('is-active'),
  }));
});
console.log('\n=== TAB/FILTER (Semua/Aktif/Ditinjau/Ditutup + hitungan) ===');
console.log(JSON.stringify(tabInfo, null, 2));
const allCountsOk = tabInfo.some((t) => t.filter === 'all' && t.text.includes('(3)') && t.selected === 'true' && t.activeClass) &&
  tabInfo.some((t) => t.filter === 'active' && t.text.includes('(1)') && t.selected === 'false') &&
  tabInfo.some((t) => t.filter === 'flagged' && t.text.includes('(1)') && t.selected === 'false') &&
  tabInfo.some((t) => t.filter === 'closed' && t.text.includes('(1)') && t.selected === 'false');
console.log(`RESULT: tabs/counts/aria-selected=${allCountsOk ? 'OK' : 'GAGAL'}`);

async function clickFilter(filter) {
  await page.click(`#campaigns-section button[data-filter="${filter}"]`);
  await page.waitForTimeout(150);
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('#campaigns-section table.ledger-table tr[data-campaign]')];
    return rows.map((r) => r.querySelector('td[data-label="Judul"] a')?.textContent?.trim() ?? '');
  });
}
const onlyFlagged = await clickFilter('flagged');
const onlyClosed = await clickFilter('closed');
const allAgain = await clickFilter('all');
console.log('\n=== KLIK FILTER (hanya baris dengan status itu harus tampil) ===');
console.log(`flagged -> ${JSON.stringify(onlyFlagged)} | diharapkan: hanya "Campaign DITINJAU (flagged)"`);
console.log(`closed  -> ${JSON.stringify(onlyClosed)} | diharapkan: hanya "Campaign DITUTUP oleh creator"`);
console.log(`all     -> ${JSON.stringify(allAgain)} | diharapkan: 3 baris`);
const filterOk = onlyFlagged.length === 1 && onlyFlagged[0].includes('DITINJAU') &&
  onlyClosed.length === 1 && onlyClosed[0].includes('DITUTUP') && allAgain.length === 3;
console.log(`RESULT: filter=${filterOk ? 'OK' : 'GAGAL'}`);

console.log(`\nKELUARAN AKHIR: ${okActive && okFlagged && okClosed && allCountsOk && filterOk ? 'PASS (BUG 2 + tab terverifikasi)' : 'FAIL'}`);
await browser.close();