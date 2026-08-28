import { navigate } from '../router.js';
import { supabase, callEdgeFunction } from '../supabaseClient.js';
import { disconnectWallet, sendDonation, explorerUrl } from '../wallet.js';
import { renderNav, bindLogout } from '../components/nav.js';
import { escapeHtml, shortAddress, formatDate, requireWallet } from '../utils.js';
import { mountAntigravity, showToast, setBusy, skeletonTable } from '../components/ui.js';
import { subscribeDonations, createDedupe } from '../realtime.js';

export async function renderCampaignDetail(root, params) {
  const wallet = requireWallet();
  if (!wallet) return;

  const { data: campaign, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', params.id)
    .single();

  if (error || !campaign) {
    root.innerHTML = `
      ${renderNav('', wallet)}
      <section class="page"><p class="error">Campaign tidak ditemukan.</p></section>
    `;
    bindLogout(root, () => { disconnectWallet(); navigate('/login'); });
    return;
  }

  root.innerHTML = `
    ${renderNav('dashboard', wallet)}
    <section class="page">
      <a href="#/dashboard" class="back-link">&larr; Kembali</a>
      <h1>${escapeHtml(campaign.title)}</h1>
      <p class="muted">Dana masuk langsung ke: <code>${escapeHtml(campaign.campaign_wallet)}</code></p>
      <p>${escapeHtml(campaign.description)}</p>

      <div class="raised-summary" aria-live="polite">
        <span class="raised-label">Total Terkumpul</span>
        <div id="raised-amount" class="raised-amount">…</div>
        <div class="progress-bar"><div id="raised-fill" class="progress-fill" aria-hidden="true"></div></div>
        <div id="raised-label" class="progress-label"></div>
      </div>

      <div class="donate-box">
        <h2>Donasi Sekarang</h2>
        <form id="form-donate">
          <input type="number" name="amount" step="0.001" min="0.001" placeholder="Jumlah SOL, contoh 0.5" required />
          <button type="submit" class="btn-primary">Kirim Donasi</button>
        </form>
      </div>

      <div class="ledger">
        <h2>Riwayat Donasi (Transparan &amp; Terverifikasi On-chain)
          <span id="live-badge" class="live-badge" role="status">…</span>
        </h2>
        <div id="donation-list" aria-busy="true">${skeletonTable(4, 4)}</div>
      </div>
    </section>
  `;

  mountAntigravity(root);
  bindLogout(root, () => { disconnectWallet(); navigate('/login'); });

  const target = Number(campaign.target_amount);
  const list = root.querySelector('#donation-list');
  const badge = root.querySelector('#live-badge');

  // State jalani-live
  const seen = createDedupe(new Set());
  let raised = 0;
  let subscribed = false;

  function renderSummary() {
    const pct = Math.min(100, (raised / target) * 100).toFixed(0);
    const amountEl = root.querySelector('#raised-amount');
    const fillEl = root.querySelector('#raised-fill');
    const labelEl = root.querySelector('#raised-label');
    if (amountEl) amountEl.textContent = `${raised.toFixed(4)} / ${target} SOL`;
    if (labelEl) labelEl.textContent = `${pct}% dari target`;
    if (fillEl) {
      fillEl.dataset.width = `${pct}%`;
      requestAnimationFrame(() => { fillEl.style.width = `${pct}%`; });
    }
  }

  function ensureTable() {
    let tbody = list.querySelector('tbody');
    if (tbody) return tbody;
    const empty = list.querySelector('.empty-state');
    if (empty) {
      list.innerHTML = `
        <div class="table-panel">
          <table class="ledger-table" aria-label="Riwayat donasi campaign">
            <thead>
              <tr><th scope="col">Donatur</th><th scope="col">Jumlah</th><th scope="col">Waktu</th><th scope="col">Bukti Transaksi</th></tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      `;
    }
    return list.querySelector('tbody');
  }

  function prependRow(rec, flash = true) {
    const tbody = ensureTable();
    if (!tbody) return;
    const row = document.createElement('tr');
    row.innerHTML = donationRow(rec);
    if (flash) row.classList.add('donation-flash');
    tbody.prepend(row);
    if (flash) setTimeout(() => row.classList.remove('donation-flash'), 2000);
  }

  function onDonation(rec) {
    if (!seen.isNew(rec)) return; // dedupe (race): jangan dobel
    raised += Number(rec.amount_sol || 0);
    renderSummary();
    prependRow(rec, true);
  }

  async function loadDonations() {
    const { data: donations, error: fetchErr } = await supabase
      .from('donations')
      .select('*')
      .eq('campaign_id', campaign.id)
      .order('created_at', { ascending: false });

    list.removeAttribute('aria-busy');

    if (fetchErr) {
      list.innerHTML = `<p class="error">${escapeHtml(fetchErr.message)}</p>`;
      return;
    }

    // Seed dedupe + total dari data awal
    seen.known = new Set((donations || []).map((d) => d.id));
    raised = (donations || []).reduce((s, d) => s + Number(d.amount_sol), 0);
    renderSummary();

    if (!donations || !donations.length) {
      list.innerHTML = `<p class="empty-state">Belum ada donasi. Jadilah yang pertama berdonasi!</p>`;
    } else {
      list.innerHTML = `
        <div class="table-panel">
          <table class="ledger-table" aria-label="Riwayat donasi campaign">
            <thead>
              <tr><th scope="col">Donatur</th><th scope="col">Jumlah</th><th scope="col">Waktu</th><th scope="col">Bukti Transaksi</th></tr>
            </thead>
            <tbody>
              ${donations.map((d) => donationRow(d)).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    // Subscribe hanya sekali, setelah initial render + seed dedupe
    if (!subscribed) {
      subscribed = true;
      subscribeDonations({
        filter: `campaign_id=eq.${campaign.id}`,
        onEvent: onDonation,
        onStatus: (status) => {
          const live = status === 'SUBSCRIBED';
          badge.className = `live-badge ${live ? 'is-live' : 'not-live'}`;
          badge.textContent = live ? '● Live' : '○ Terputus';
        },
        marker: list,
      });
    }
  }

  root.querySelector('#form-donate').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const amount = Number(new FormData(e.target).get('amount'));

    if (!amount || isNaN(amount) || amount <= 0) {
      showToast('Jumlah donasi harus lebih dari 0.', 'error');
      return;
    }
    if (amount > 100000) {
      showToast('Jumlah donasi terlalu besar (maks 100.000 SOL).', 'error');
      return;
    }

    const confirmed = window.confirm(
      `Kirim ${amount} SOL ke campaign "${campaign.title}"?\n\nDompet penerima: ${shortAddress(campaign.campaign_wallet)}\n\nTransaksi ini tidak bisa dibatalkan.`
    );
    if (!confirmed) return;

    setBusy(btn, true, 'Menunggu persetujuan wallet...');
    try {
      const signature = await sendDonation(campaign.campaign_wallet, amount);
      setBusy(btn, true, 'Memverifikasi on-chain...');

      // Sepenuhnya diverifikasi di server: Edge Function memeriksa tx
      // signature ke jaringan Solana sebelum mencatat donasi, sehingga
      // baris donasi dijamin mencerminkan transaksi nyata.
      await callEdgeFunction('verify-donation', {
        campaign_id: campaign.id,
        donor_wallet: wallet,
        amount_sol: amount,
        tx_signature: signature,
      });

      showToast('Donasi terverifikasi dan berhasil dicatat! Terima kasih atas kontribusimu.', 'success');
      e.target.reset();
      // Refresh superset data (baris yang sama akan di-dedupe oleh `seen`).
      await loadDonations();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Donasi gagal atau dibatalkan (diragukan tidak tercatat).', 'error');
    } finally {
      setBusy(btn, false);
    }
  });

  await loadDonations();
}

function donationRow(d) {
  return `
    <tr>
      <td data-label="Donatur"><span class="addr" title="${escapeHtml(d.donor_wallet)}" aria-label="${escapeHtml(d.donor_wallet)}">${shortAddress(d.donor_wallet)}</span></td>
      <td data-label="Jumlah">${Number(d.amount_sol).toFixed(4)} SOL</td>
      <td data-label="Waktu">${formatDate(d.created_at)}</td>
      <td data-label="Bukti"><a href="${explorerUrl(d.tx_signature)}" target="_blank" rel="noopener">Lihat di Explorer</a></td>
    </tr>
  `;
}
