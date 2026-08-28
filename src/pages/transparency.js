import { navigate } from '../router.js';
import { supabase } from '../supabaseClient.js';
import { disconnectWallet, explorerUrl } from '../wallet.js';
import { renderNav, bindLogout } from '../components/nav.js';
import { escapeHtml, shortAddress, formatDate, requireWallet } from '../utils.js';
import { mountAntigravity, skeletonStat, skeletonTable } from '../components/ui.js';
import { subscribeDonations, createDedupe } from '../realtime.js';

export async function renderTransparency(root) {
  const wallet = requireWallet();
  if (!wallet) return;

  root.innerHTML = `
    ${renderNav('transparency', wallet)}
    <section class="page">
      <h1>Buku Kas Transparan
        <span id="live-badge" class="live-badge" role="status">…</span>
      </h1>
      <p class="hint">
        Semua donasi di seluruh campaign, urut dari yang terbaru. Setiap baris
        dapat diverifikasi langsung di Solana Explorer — tidak ada yang bisa
        disembunyikan atau dimanipulasi diam-diam.
      </p>
      <div id="total-box" aria-busy="true">${skeletonStat()}</div>
      <div id="ledger-global" aria-busy="true">${skeletonTable(5, 5)}</div>
    </section>
  `;

  mountAntigravity(root);
  bindLogout(root, () => { disconnectWallet(); navigate('/login'); });

  const badge = root.querySelector('#live-badge');
  const ledgerEl = root.querySelector('#ledger-global');
  const totalEl = root.querySelector('#total-box');

  const { data: donations, error } = await supabase
    .from('donations')
    .select('*, campaigns(title)')
    .order('created_at', { ascending: false });

  ledgerEl.removeAttribute('aria-busy');
  totalEl.removeAttribute('aria-busy');

  if (error) {
    ledgerEl.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
    return;
  }

  // State jalani-live
  const seen = createDedupe(new Set((donations || []).map((d) => d.id)));
  let totalSol = (donations || []).reduce((s, d) => s + Number(d.amount_sol), 0);
  const campaignTitleCache = new Map();

  async function getCampaignTitle(id) {
    if (campaignTitleCache.has(id)) return campaignTitleCache.get(id);
    let title = '-';
    try {
      const { data } = await supabase.from('campaigns').select('title').eq('id', id).single();
      title = data?.title ?? '-';
    } catch {
      /* biarkan '-'; tidak memblokir feed */
    }
    campaignTitleCache.set(id, title);
    return title;
  }

  function renderInitial() {
    totalEl.innerHTML =
      `<strong>${totalSol.toFixed(4)} SOL</strong> telah didonasikan melalui ${(donations || []).length} transaksi`;

    if (!donations || !donations.length) {
      ledgerEl.innerHTML = `<p class="empty-state">Belum ada transaksi.</p>`;
      return;
    }
    ledgerEl.innerHTML = `
      <div class="table-panel">
        <table class="ledger-table" aria-label="Buku kas global semua donasi">
          <thead>
            <tr><th scope="col">Campaign</th><th scope="col">Donatur</th><th scope="col">Jumlah</th><th scope="col">Waktu</th><th scope="col">Bukti</th></tr>
          </thead>
          <tbody>
            ${donations.map(donationRow).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  renderInitial();

  function ensureTable() {
    let tbody = ledgerEl.querySelector('tbody');
    if (tbody) return tbody;
    // belum ada tabel (mis. berasal dari empty-state): buat struktur kosong
    ledgerEl.innerHTML = `
      <div class="table-panel">
        <table class="ledger-table" aria-label="Buku kas global semua donasi">
          <thead>
            <tr><th scope="col">Campaign</th><th scope="col">Donatur</th><th scope="col">Jumlah</th><th scope="col">Waktu</th><th scope="col">Bukti</th></tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    `;
    return ledgerEl.querySelector('tbody');
  }

  async function onDonation(rec) {
    if (!seen.isNew(rec)) return; // dedupe (race): jangan dobel
    totalSol += Number(rec.amount_sol || 0);
    totalEl.innerHTML =
      `<strong>${totalSol.toFixed(4)} SOL</strong> telah didonasikan melalui ${seen.known.size} transaksi`;

    const tbody = ensureTable();
    if (!tbody) return;
    const title = await getCampaignTitle(rec.campaign_id);

    const row = document.createElement('tr');
    row.innerHTML = donationRow({
      ...rec,
      campaigns: { title }, // dibiarkan mendukung baris global
    });
    row.classList.add('donation-flash');
    tbody.prepend(row);
    setTimeout(() => row.classList.remove('donation-flash'), 2000);
  }

  // Subscribe (global, tanpa filter campaign)
  subscribeDonations({
    onEvent: onDonation,
    onStatus: (status) => {
      const live = status === 'SUBSCRIBED';
      badge.className = `live-badge ${live ? 'is-live' : 'not-live'}`;
      badge.textContent = live ? '● Live' : '○ Terputus';
    },
    marker: ledgerEl,
  });
}

function donationRow(d) {
  return `
    <tr>
      <td data-label="Campaign">${escapeHtml(d.campaigns?.title ?? '-')}</td>
      <td data-label="Donatur"><span class="addr" title="${escapeHtml(d.donor_wallet)}" aria-label="${escapeHtml(d.donor_wallet)}">${shortAddress(d.donor_wallet)}</span></td>
      <td data-label="Jumlah">${Number(d.amount_sol).toFixed(4)} SOL</td>
      <td data-label="Waktu">${formatDate(d.created_at)}</td>
      <td data-label="Bukti"><a href="${explorerUrl(d.tx_signature)}" target="_blank" rel="noopener">Lihat</a></td>
    </tr>
  `;
}
