import { chromium } from 'playwright';

// REPRODUCE + GUARD: badge status di dalam sel kolom "Status" tabel panel admin.
//
// Jalankan (butuh dev server di http://localhost:5173):
//   node tests/e2e/repro-badge-layout.mjs
//
// SEBELUM perbaikan: laporan menunjukkan badge keluar dari sel
// (position:absolute menempel ke containing block ancestor: .table-panel di
// desktop, <tr> di mobile) dan skrip GAGAL.
// SESUDAH perbaikan: badge berada penuh di dalam bounding box sel Status,
// sel tidak berukuran nol, di desktop (1280) MAUPUN mobile (375, 320).
//
// Skrip juga memastikan TIDAK ADA regresi di dashboard (badge pojok kartu
// tetap position:absolute di dalam .card) dan melaporkan kondisi badge di
// halaman detail campaign (tidak diperbaiki di task ini).
const ADMIN_WALLET = '9qeZq8CrzirE56Au3QmHc5RUdBSGCZfmcoLtkdanGvGv';
const BASE = 'http://localhost:5173';

const FIXTURE = [
  {
    id: 'aaaaaaaa-0000-0000-0000-000000000002',
    title: 'bantu gw makan',
    creator_wallet: ADMIN_WALLET,
    status: 'flagged',
    flag_reason: 'Bukti penggunaan dana tidak kunjung diunggah oleh penggalang.',
    created_at: '2026-10-05T00:00:00.000Z',
  },
  {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    title: 'bantuan gempa ntt',
    creator_wallet: ADMIN_WALLET,
    status: 'active',
    flag_reason: null,
    created_at: '2026-10-02T00:00:00.000Z',
  },
  {
    id: 'aaaaaaaa-0000-0000-0000-000000000003',
    title: 'bantu gw makan (ditutup)',
    creator_wallet: ADMIN_WALLET,
    status: 'closed',
    flag_reason: null,
    created_at: '2026-10-01T00:00:00.000Z',
  },
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function newPage(width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.addInitScript(
    (wallet) => {
      const pubkey = { toString: () => wallet };
      window.solana = {
        isPhantom: true,
        publicKey: pubkey,
        async connect() { return { publicKey: pubkey }; },
        async signMessage() { return { signature: new Uint8Array(64).fill(7) }; },
        async disconnect() {},
      };
      try { localStorage.setItem('userWallet', wallet); } catch {}
    },
    ADMIN_WALLET
  );
  return page;
}

function routeJson(page, pattern, body) {
  return page.route(pattern, (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': BASE },
        body: JSON.stringify(body),
      });
    } else {
      route.continue();
    }
  });
}

// ---------- Panel admin: badge harus ADA DI DALAM sel Status ----------
async function openAdmin(width, height) {
  const page = await newPage(width, height);
  await routeJson(page, /rest\/v1\/campaigns\?.*select=.*flag_reason/, FIXTURE);
  await page.goto(`${BASE}/#/admin`);
  await page.waitForSelector('#admin-body table.ledger-table tr[data-campaign]', { timeout: 12000 });
  return page;
}

async function auditAdmin(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('#admin-body table.ledger-table tr[data-campaign]')];
    return rows.map((row) => {
      const cell = row.querySelector('td[data-label="Status"]');
      const badge = cell?.querySelector('.status-badge');
      if (!cell || !badge) return { title: 'NO BADGE', found: false };
      const cs = getComputedStyle(badge);
      const cellCs = getComputedStyle(cell);
      const cb = badge.offsetParent;
      const bBox = badge.getBoundingClientRect();
      const cBox = cell.getBoundingClientRect();
      return {
        title: row.querySelector('td[data-label="Judul"] a')?.textContent?.trim() ?? '',
        found: true,
        badge: { position: cs.position, display: cs.display, whiteSpace: cs.whiteSpace },
        cell: { display: cellCs.display, width: cellCs.width },
        offsetParent: cb ? cb.tagName : 'null',
        bBox: { x: +bBox.x.toFixed(1), y: +bBox.y.toFixed(1), w: +bBox.width.toFixed(1), h: +bBox.height.toFixed(1) },
        cBox: { x: +cBox.x.toFixed(1), y: +cBox.y.toFixed(1), w: +cBox.width.toFixed(1), h: +cBox.height.toFixed(1) },
        inside: bBox.left >= cBox.left - 0.5 && bBox.right <= cBox.right + 0.5 &&
                bBox.top >= cBox.top - 0.5 && bBox.bottom <= cBox.bottom + 0.5,
        cellNonZero: cBox.width > 0 && cBox.height > 0,
      };
    });
  });
}

// ---------- Dashboard: badge pojok kartu TIDAK boleh berubah ----------
async function openDashboard(width) {
  const page = await newPage(width, 900);
  await routeJson(
    page,
    /rest\/v1\/campaigns\?.*donations/,
    FIXTURE.map((c) => ({ ...c, description: 'Deskripsi uji untuk kartu.', target_amount: 10, donations: [{ amount_sol: 1 }] }))
  );
  await page.goto(`${BASE}/#/dashboard`);
  await page.waitForSelector('#campaign-grid .card .status-badge', { timeout: 12000 });
  return page;
}

async function auditDashboard(page) {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll('#campaign-grid .card')];
    return cards.map((card) => {
      const badge = card.querySelector('.status-badge');
      const cs = getComputedStyle(badge);
      const cb = badge.offsetParent;
      const bBox = badge.getBoundingClientRect();
      const cBox = card.getBoundingClientRect();
      return {
        position: cs.position,
        offsetParent: cb ? `${cb.tagName}.${cb.className}` : 'null',
        nearTopRight: bBox.right <= cBox.right + 1 && bBox.top >= cBox.top - 1 && bBox.top <= cBox.top + 30,
        insideCard: bBox.left >= cBox.left - 1 && bBox.right <= cBox.right + 1 &&
                    bBox.top >= cBox.top - 1 && bBox.bottom <= cBox.bottom + 1,
      };
    });
  });
}

// ---------- Detail campaign: laporkan kondisi (tidak diperbaiki) ----------
async function openDetail(width) {
  const page = await newPage(width, 900);
  const flagged = { ...FIXTURE[0], description: 'Deskripsi uji.', target_amount: 10, campaign_wallet: ADMIN_WALLET, photo_urls: null };
  await routeJson(page, /rest\/v1\/campaigns\?.*id=eq\./, flagged);
  await routeJson(page, /rest\/v1\/donations\?/, []);
  await page.goto(`${BASE}/#/campaign/${flagged.id}`);
  await page.waitForSelector('.page h1', { timeout: 12000 });
  await page.waitForTimeout(600);
  return page;
}

async function auditDetail(page) {
  return page.evaluate(() => {
    const badge = document.querySelector('.page .status-badge');
    if (!badge) return { present: false };
    const cs = getComputedStyle(badge);
    const cb = badge.offsetParent;
    const bBox = badge.getBoundingClientRect();
    const page_ = document.querySelector('.page').getBoundingClientRect();
    return {
      present: true,
      position: cs.position,
      offsetParent: cb ? `${cb.tagName}.${cb.className}` : 'null',
      insidePage: bBox.left >= page_.left - 1 && bBox.right <= page_.right + 1 &&
                  bBox.top >= page_.top - 1 && bBox.bottom <= page_.bottom + 1,
    };
  });
}

let failures = 0;

// === GUARD: panel admin desktop + mobile ===
for (const vp of [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 375, height: 800 },
  { name: 'mobile-xs', width: 320, height: 700 },
]) {
  const page = await openAdmin(vp.width, vp.height);
  const data = await auditAdmin(page);
  await page.screenshot({ path: `/tmp/badge-admin-${vp.name}.png`, fullPage: true });
  console.log(`\n===== ADMIN ${vp.name} (${vp.width}px) =====`);
  for (const r of data) {
    console.log(`"${r.title}" offsetParent=${r.offsetParent} badge=${JSON.stringify(r.badge)} cell=${JSON.stringify(r.cell)} inside=${r.inside} cellNonZero=${r.cellNonZero}`);
    if (!r.found || !r.inside || !r.cellNonZero) failures++;
  }
  await page.close();
}

// === NO-REGRESSION: dashboard (badge pojok kartu) ===
for (const w of [1280, 375, 320]) {
  const page = await openDashboard(w);
  const data = await auditDashboard(page);
  await page.screenshot({ path: `/tmp/badge-dashboard-${w}.png`, fullPage: true });
  console.log(`\n===== DASHBOARD ${w}px =====`);
  for (const r of data) {
    console.log(`position=${r.position} offsetParent=${r.offsetParent} nearTopRight=${r.nearTopRight} insideCard=${r.insideCard}`);
    if (r.position !== 'absolute' || !r.nearTopRight || !r.insideCard) failures++;
  }
  await page.close();
}

// === REPORT-ONLY: detail campaign ===
console.log('\n===== DETAIL CAMPAIGN (laporan saja, tidak diperbaiki) =====');
for (const w of [1280, 375]) {
  const page = await openDetail(w);
  const r = await auditDetail(page);
  await page.screenshot({ path: `/tmp/badge-detail-${w}.png`, fullPage: true });
  console.log(`${w}px: ${JSON.stringify(r)}`);
  await page.close();
}

console.log('\n==============================');
console.log(failures
  ? `GAGAL: ${failures} pemeriksaan tidak lolos.`
  : `PASS: badge admin di dalam sel (desktop+mobile+320) & dashboard tidak berubah.`);
await browser.close();
process.exit(failures ? 1 : 0);