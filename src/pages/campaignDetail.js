import { navigate } from '../router.js';
import { supabase, callEdgeFunction } from '../supabaseClient.js';
import { disconnectWallet, sendDonation, explorerUrl, signTextMessage } from '../wallet.js';
import { renderNav, bindLogout } from '../components/nav.js';
import { escapeHtml, shortAddress, formatDate, requireWallet, statusMeta, donationBlockedMessage, progressPercent, safeStorageUrl } from '../utils.js';
import { mountAntigravity, showToast, setBusy, skeletonTable } from '../components/ui.js';
import { subscribeDonations, createDedupe } from '../realtime.js';
import { isAdminWallet } from '../adminAccess.js';

export async function renderCampaignDetail(root, params) {
  const wallet = requireWallet();
  if (!wallet) return;

  // Lithium sekali di awal: dipakai untuk link Moderasi di navbar, termasuk
  // pada cabang "campaign tidak ditemukan" di bawah.
  const isAdmin = await isAdminWallet(wallet);

  const { data: campaign, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', params.id)
    .single();

  if (error || !campaign) {
    const notFound = !error; // .single() mengembalikan error PGRST116 saat tidak ada
    root.innerHTML = `
      ${renderNav('dashboard', wallet, null, isAdmin)}
      <section class="page">
        <a href="#/dashboard" class="back-link">&larr; Kembali</a>
        ${
          notFound
            ? '<p class="empty-state">Campaign tidak ditemukan.</p>'
            : `<p class="error">Gagal memuat campaign: ${escapeHtml(
                error?.message || 'terjadi kesalahan'
              )}</p>`
        }
      </section>
    `;
    bindLogout(root, () => { disconnectWallet(); navigate('/login'); });
    return;
  }

  root.innerHTML = `
    ${renderNav('dashboard', wallet, null, isAdmin)}
    <section class="page">
      <a href="#/dashboard" class="back-link">&larr; Kembali</a>
      <h1>${escapeHtml(campaign.title)}</h1>
      <p class="muted">Dana masuk langsung ke: <code>${escapeHtml(campaign.campaign_wallet)}</code></p>
      <p>${escapeHtml(campaign.description)}</p>

      ${photoGalleryHtml(campaign)}

      ${locationHtml(campaign)}

      <div class="raised-summary" aria-live="polite">
        <span class="raised-label">Total Terkumpul</span>
        <div id="raised-amount" class="raised-amount">…</div>
        <div class="progress-bar"><div id="raised-fill" class="progress-fill" aria-hidden="true"></div></div>
        <div id="raised-label" class="progress-label"></div>
      </div>

      <div class="donate-box" id="donate-box">
        <h2>Donasi Sekarang</h2>
        <form id="form-donate">
          <input type="number" name="amount" step="0.001" min="0.001" placeholder="Jumlah SOL, contoh 0.5" required />
          <button type="submit" class="btn-primary">Kirim Donasi</button>
        </form>
        <p id="donate-closed" class="empty-state" style="display:none">Campaign ini sudah ditutup untuk donasi baru.</p>
      </div>

      <div class="ledger">
        <h2>Riwayat Donasi (Transparan &amp; Terverifikasi On-chain)
          <span id="live-badge" class="live-badge" role="status">…</span>
        </h2>
        <div id="donation-list" aria-busy="true">${skeletonTable(4, 4)}</div>
      </div>

      <div class="report-box">
        <h2>Laporkan Campaign Ini</h2>
        <p class="muted">
          Melihat campaign yang menipu atau melanggar aturan? Laporkan agar moderator
          meninjaunya. Satu wallet hanya bisa membuat satu laporan per campaign.
        </p>
        <button type="button" id="btn-report" class="btn-ghost">Laporkan Campaign</button>
        <p id="report-note" class="muted" role="status"></p>
      </div>
    </section>
  `;

  mountAntigravity(root);
  bindLogout(root, () => { disconnectWallet(); navigate('/login'); });

  const photos = (Array.isArray(campaign.photo_urls) ? campaign.photo_urls : [])
    .map(safeStorageUrl)
    .filter(Boolean);
  const gallery = root.querySelector('.photo-gallery');
  if (gallery && photos.length) {
    gallery.addEventListener('click', (e) => {
      const item = e.target.closest('.photo-item');
      if (!item) return;
      openLightbox(gallery, photos, Number(item.dataset.idx));
    });
  }

  const target = Number(campaign.target_amount);
  const list = root.querySelector('#donation-list');
  const badge = root.querySelector('#live-badge');
  const meta = statusMeta(campaign.status);

  // Satu sumber kebenaran untuk "boleh berdonasi?". Status 'closed' maupun
  // 'flagged' (dan status apa pun yang tidak dikenal) menyembunyikan form,
  // sementara riwayat lama tetap terlihat — prinsip transparansi tidak berubah.
  if (!meta.acceptsDonation) {
    const donateForm = root.querySelector('#form-donate');
    const donateClosed = root.querySelector('#donate-closed');
    if (donateForm) donateForm.remove();
    if (donateClosed) {
      donateClosed.textContent = donationBlockedMessage(campaign.status);
      donateClosed.style.display = '';
      donateClosed.setAttribute('role', 'status');
    }
    // Badge status juga di halaman detail, konsisten dengan dashboard. Banner
    // di bawahnya menjelaskan penyebabnya; badge menjawab "statusnya apa?"
    // tanpa harus menggulir.
    {
      const chip = document.createElement('span');
      chip.className = `status-badge ${meta.badge}`;
      chip.textContent = meta.label;
      root.querySelector('h1')?.after(chip);
    }
    if (meta.key === 'flagged') {
      const warn = document.createElement('div');
      warn.className = 'flag-banner';
      warn.setAttribute('role', 'status');
      warn.innerHTML =
        '<strong>⚠ Campaign ini sedang ditinjau.</strong>' +
        (campaign.flag_reason
          ? `<span class="flag-reason">Alasan laporan: ${escapeHtml(campaign.flag_reason)}</span>`
          : '');
      root.querySelector('h1')?.after(warn);
    }
  }

  // State jalani-live
  const seen = createDedupe(new Set());
  let raised = 0;
  let subscribed = false;

  function renderSummary() {
    const pct = progressPercent(raised, target).toFixed(0);
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

  if (meta.acceptsDonation) {
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
        showToast(readableDonationError(err), 'error');
      } finally {
        setBusy(btn, false);
      }
    });
  } else {
    // Form sengaja dihapus: tidak ada jalur yang bisa mengirim donasi ke
    // campaign yang tidak menerima donasi.
    const box = root.querySelector('#donate-box');
    if (box) box.classList.add('is-blocked');
  }

  bindReportButton(root, campaign, wallet);
  await loadDonations();
}

/**
 * Tombol laporan campaign.
 *
 * Alur ini sengaja memakai Edge Function `report-campaign` (bukan insert
 * langsung dari browser) karena INSERT ke `campaign_reports` harus tetap
 * ficaram di server: RLS tidak bisa membuktikan wallet pengirim hanya dari
 * anon key, jadi INSERT langsung selalu bisa dipalsukan.
 *
 * Prinsip "jangan pernah diam": kalau endpoint/tabelnya belum ada, ERRORS
 * yang jujur ditampilkan ke user, bukan toast sukses palsu.
 */
/**
 * Pesan laporan yang ditandatangani. WAJIB identik dengan yang di-parse server
 * (label per baris, alasan tanpa newline) karena server mencocokkan isi pesan
 * dengan payload sebelum memverifikasi signature.
 */
function buildReportMessage({ wallet, campaignId, reason }) {
  return (
    'Laporkan Campaign — Platform Donasi Web3\n\n' +
    `Wallet: ${wallet}\n` +
    `Campaign: ${campaignId}\n` +
    `Reason: ${reason}\n` +
    `Timestamp: ${new Date().toISOString()}`
  );
}

function bindReportButton(root, campaign, wallet) {
  const btn = root.querySelector('#btn-report');
  const note = root.querySelector('#report-note');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const reason = window.prompt(
      'Alasan laporan (10–500 karakter). Contoh: "Dana dipakai untuk hal yang tidak menjelaskan campaign."',
      ''
    );
    if (reason === null) return; // dibatalkan user
    const trimmed = reason.trim();
    if (trimmed.length < 10 || trimmed.length > 500) {
      showToast('Alasan laporan harus antara 10 dan 500 karakter.', 'error');
      return;
    }

    setBusy(btn, true, 'Mengirim...');
    if (note) note.textContent = '';
    try {
      // Signature wajib supaya `reporter_wallet` bukan sekadar klaim: tanpa ini
      // siapa pun bisa mengirim laporan atas nama wallet orang lain.
      const { message, signature } = await signTextMessage(
        buildReportMessage({ wallet, campaignId: campaign.id, reason: trimmed }),
      );
      await callEdgeFunction('report-campaign', {
        campaign_id: campaign.id,
        reporter_wallet: wallet,
        reason: trimmed,
        signed_message: message,
        signature,
      });
      // setBusy(btn, false) di blok catch akan MENGAKTIFKAN lagi tombol yang
      // sengaja kita nonaktifkan, jadi penandaan "sudah dilaporkan" harus
      // dilakukan setelah finally — bukan sesudahnya.
      btn.disabled = true;
      btn.textContent = 'Sudah Dilaporkan';
      if (note) note.textContent = 'Terima kasih. Moderator akan meninjau campaign ini.';
      showToast('Laporan terkirim ke moderator.', 'success');
    } catch (err) {
      console.error('[report-campaign]', err);
      if (note) note.textContent = readableReportError(err);
      showToast(readableReportError(err), 'error');
      setBusy(btn, false);
    }
  });
}

function readableReportError(err) {
  const msg = err?.message || 'Laporan gagal terkirim.';
  if (/does not exist|schema cache|42P01|PGRST205/i.test(msg)) {
    return (
      'Fitur laporan belum aktif di server (tabel campaign_reports belum ada). ' +
      'Jalankan migration di database/migrations/ lalu muat ulang halaman ini.'
    );
  }
  if (/duplicate|unique|already/i.test(msg)) {
    return 'Kamu sudah pernah melaporkan campaign ini. Terima kasih.';
  }
  if (/23503|foreign key/i.test(msg)) {
    return 'Campaign ini tidak ada, jadi laporan tidak bisa dikirim.';
  }
  return msg;
}

function readableDonationError(err) {
  const msg = err?.message || 'Donasi gagal atau dibatalkan (diragukan tidak tercatat).';
  if (/ERR_NAME_NOT_RESOLVED|Failed to fetch|fetch failed|NetworkError/i.test(msg)) {
    return (
      'Tidak bisa menghubungi server setelah transaksi dikirim. Dana SUDAH berpindah di jaringan — ' +
      'jangan kirim ulang. Buka halaman ini beberapa saat lagi; jika barismu belum muncul, ' +
      'hubungi/admin moderator agar transaksi bisa dicatat manual dari signature-nya.'
    );
  }
  if (/User rejected|rejected the request|cancell?ed|denied/i.test(msg)) {
    return 'Permintaan ditolak di wallet. Donasi tidak terkirim.';
  }
  return msg;
}

function donationRow(d) {
  return `
    <tr>
      <td data-label="Donatur"><span class="addr" title="${escapeHtml(d.donor_wallet)}" aria-label="${escapeHtml(d.donor_wallet)}">${shortAddress(d.donor_wallet)}</span></td>
      <td data-label="Jumlah">${Number(d.amount_sol).toFixed(4)} SOL</td>
      <td data-label="Waktu">${formatDate(d.created_at)}</td>
      <td data-label="Bukti"><a href="${explorerUrl(d.tx_signature)}" target="_blank" rel="noopener noreferrer">Lihat di Explorer</a></td>
    </tr>
  `;
}

// Galeri foto dokumentasi — hanya dirender bila ada minimal 1 foto.
function photoGalleryHtml(c) {
  const photos = (Array.isArray(c.photo_urls) ? c.photo_urls : []).map(safeStorageUrl).filter(Boolean);
  if (!photos.length) return '';
  return `
    <div class="photo-gallery" aria-label="Galeri foto dokumentasi">
      ${photos.map((u, i) => `
        <button type="button" class="photo-item" data-idx="${i}" aria-label="Perbesar foto ${i + 1}">
          <img src="${escapeHtml(u)}" alt="Foto dokumentasi ${i + 1} dari ${photos.length}" loading="lazy" />
        </button>
      `).join('')}
    </div>
  `;
}

// Blok lokasi — hanya dirender bila koordinat ada.
function locationHtml(c) {
  const lat = Number(c.location_lat);
  const lng = Number(c.location_lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
  const label = c.location_label ? `<p class="location-label">${escapeHtml(c.location_label)}</p>` : '';
  const bbox = `${lng - 0.005},${lat - 0.002},${lng + 0.005},${lat + 0.002}`;
  const osmSrc =
    `https://www.openstreetmap.org/export/embed.html?` +
    `bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
  const gmaps = `https://www.google.com/maps?q=${lat},${lng}`;
  return `
    <div class="location-block">
      <h2>Lokasi</h2>
      ${label}
      <iframe class="location-iframe" title="Peta lokasi campaign di OpenStreetMap" src="${osmSrc}" loading="lazy"></iframe>
      <a class="btn-ghost" href="${gmaps}" target="_blank" rel="noopener noreferrer">Buka di Google Maps</a>
    </div>
  `;
}

// Lightbox galeri sederhana (vanilla, tanpa library).
function openLightbox(container, photos, startIdx) {
  if (!photos.length) return;
  const overlay = document.createElement('div');
  overlay.className = 'lightbox';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Galeri foto campaign');
  let idx = startIdx;

  const render = () => {
    overlay.innerHTML = `
      <button type="button" class="lightbox-close" aria-label="Tutup">×</button>
      <img class="lightbox-img" src="${escapeHtml(photos[idx])}" alt="Foto dokumentasi ${idx + 1} dari ${photos.length}" />
      <div class="lightbox-nav">
        ${photos.length > 1 ? `
          <button type="button" class="lightbox-prev" aria-label="Sebelumnya">‹</button>
          <span class="lightbox-count">${idx + 1} / ${photos.length}</span>
          <button type="button" class="lightbox-next" aria-label="Berikutnya">›</button>
        ` : ''}
      </div>
    `;
  };
  render();

  document.body.appendChild(overlay);

  const close = () => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') { idx = (idx - 1 + photos.length) % photos.length; render(); }
    if (e.key === 'ArrowRight') { idx = (idx + 1) % photos.length; render(); }
  };
  overlay.addEventListener('click', (e) => {
    if (e.target.closest('.lightbox-close')) return close();
    if (e.target.closest('.lightbox-prev')) { idx = (idx - 1 + photos.length) % photos.length; render(); return; }
    if (e.target.closest('.lightbox-next')) { idx = (idx + 1) % photos.length; render(); return; }
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);
}
