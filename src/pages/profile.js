import { navigate } from '../router.js';
import { supabase, callEdgeFunction } from '../supabaseClient.js';
import { disconnectWallet, explorerUrl, signTextMessage } from '../wallet.js';
import { renderNav, bindLogout } from '../components/nav.js';
import { escapeHtml, shortAddress, formatDate, requireWallet, statusMeta, progressPercent, safeStorageUrl } from '../utils.js';
import { mountAntigravity, showToast, setBusy, skeletonCards, skeletonTable, confirmDialog } from '../components/ui.js';
import { isAdminWallet } from '../adminAccess.js';

const PAGE_SIZE = 20;

// Berapa baris donasi yang sudah dirender. Dipakai sebagai offset pagination,
// BUKAN jumlah <tr> di DOM (skeleton loader ikut terhitung dan membuat off-by-one).
let loadedDonations = 0;

export async function renderProfile(root) {
  const wallet = requireWallet();
  if (!wallet) return;

  const { data: userRow } = await supabase
    .from('users')
    .select('display_name, bio, avatar_url')
    .eq('wallet_address', wallet)
    .maybeSingle();

  let profile = userRow || { display_name: '', bio: '', avatar_url: '' };
  const isAdmin = await isAdminWallet(wallet);

  root.innerHTML = `
    ${renderNav('profile', wallet, profile.avatar_url, isAdmin)}
    <section class="page">
      <div class="profile-header">
        <div class="avatar" id="profile-avatar" aria-hidden="true">
          <span id="avatar-fallback"></span>
        </div>
        <div class="profile-meta">
          <h1 id="profile-name"><span class="sk sk-title" style="width:160px"></span></h1>
          <p class="muted profile-wallet-row">
            <code id="profile-wallet" class="addr"><span class="sk sk-bar" style="width:220px"></span></code>
            <button id="btn-copy-wallet" class="btn-ghost" type="button" aria-label="Salin alamat wallet">Salin</button>
          </p>
        </div>
      </div>

      <div class="profile-stats" id="profile-stats">
        <div class="stat-box"><span class="stat-label">Total donasi</span><span class="stat-value is-loading" id="stat-donated">0</span></div>
        <div class="stat-box"><span class="stat-label">Campaign aktif</span><span class="stat-value is-loading" id="stat-campaigns">0</span></div>
        <div class="stat-box"><span class="stat-label">Total terkumpul</span><span class="stat-value is-loading" id="stat-raised">0</span></div>
      </div>

      <div class="tabs" role="tablist" aria-label="Profil">
        <button class="tab is-active" role="tab" aria-selected="true" data-tab="settings">Profil & Pengaturan</button>
        <button class="tab" role="tab" aria-selected="false" data-tab="campaigns">Campaign Saya</button>
        <button class="tab" role="tab" aria-selected="false" data-tab="donations">Riwayat Donasi</button>
      </div>

      <div class="tab-panels">
        <section id="tab-settings" class="tab-panel" role="tabpanel">
          <form id="form-profile" class="form-card">
            <label>Nama tampilan
              <input type="text" name="display_name" maxlength="80" />
            </label>
            <label>Bio
              <textarea name="bio" rows="4" maxlength="240"></textarea>
            </label>
            <label>
              <span class="muted">Foto profil</span>
              <div class="uploader">
                <input id="avatar-input" type="file" name="avatar" accept="image/*" />
                <label for="avatar-input" class="btn-primary" tabindex="0" role="button">Pilih foto</label>
                <img id="upload-preview" class="upload-preview" alt="" />
                <span id="upload-name" class="upload-name"></span>
              </div>
            </label>
            <button class="btn-primary" type="submit">Simpan</button>
          </form>
        </section>

        <section id="tab-campaigns" class="tab-panel" hidden>
          <div id="my-campaigns" class="grid" aria-busy="true">${skeletonCards(3)}</div>
        </section>

        <section id="tab-donations" class="tab-panel" hidden>
          <div id="my-donations" aria-busy="true">${skeletonTable(4, 4)}</div>
          <button id="btn-more" class="btn-primary" type="button" style="display:none; margin-top:12px;">Muat lebih banyak</button>
        </section>
      </div>
    </section>
  `;

  mountAntigravity(root);
  bindLogout(root, () => { disconnectWallet(); navigate('/login'); });

  const nameEl = root.querySelector('#profile-name');
  const walletEl = root.querySelector('#profile-wallet');
  const fallbackEl = root.querySelector('#avatar-fallback');
  const avatarEl = root.querySelector('#profile-avatar');
  const fileInput = root.querySelector('#avatar-input');
  const uploadPreview = root.querySelector('#upload-preview');
  const uploadName = root.querySelector('#upload-name');

  nameEl.textContent = profile.display_name?.trim() || shortAddress(wallet);
  walletEl.textContent = wallet;
  fallbackEl.textContent = (profile.display_name?.trim() || wallet).slice(0, 2).toUpperCase();

  const safeAvatarUrl = safeStorageUrl(profile.avatar_url);
  if (safeAvatarUrl) {
    avatarEl.style.backgroundImage = `url("${safeAvatarUrl}")`;
    avatarEl.style.backgroundSize = 'cover';
    avatarEl.style.backgroundPosition = 'center';
    fallbackEl.style.display = 'none';
  }

  root.querySelector('#form-profile').elements.display_name.value = profile.display_name || '';
  root.querySelector('#form-profile').elements.bio.value = profile.bio || '';

  await loadStats(wallet);

  bindTabs(root);
  await loadMyCampaigns(root, wallet);
  await loadMyDonations(root, wallet, false);

  // Tombol "Muat lebih banyak" — sebelumnya TIDAK PUNYA listener sama sekali
  // (elemennya ada di HTML tapi tidak pernah di-bind), jadi selalu mati.
  root.querySelector('#btn-more').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (btn.dataset.busy === '1') return;
    btn.dataset.busy = '1';
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = 'Memuat...';
    try {
      await loadMyDonations(root, wallet, true);
    } finally {
      delete btn.dataset.busy;
      btn.disabled = false;
      btn.textContent = label;
    }
  });

  root.querySelector('#btn-copy-wallet').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(wallet);
      showToast('Disalin!', 'success');
    } catch {
      showToast('Gagal menyalin alamat.', 'error');
    }
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      uploadPreview.style.display = 'none';
      uploadName.textContent = '';
      return;
    }
    uploadName.textContent = file.name;
    if (window.URL && URL.createObjectURL) {
      uploadPreview.src = URL.createObjectURL(file);
      uploadPreview.style.display = 'block';
    }
  });

  root.querySelector('#form-profile').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const fd = new FormData(e.target);
    const display_name = String(fd.get('display_name') || '').trim();
    // Bio dinormalisasi (trim + satu baris) SEBELUM ditandatangani. Server juga
    // melakukan trim; kalau hanya server yang menormalkan, tanda tangan dibuat
    // atas nilai yang berbeda dari yang dikirim dan selalu ditolak.
    const bio = String(fd.get('bio') || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240)
      .trim();
    const file = fd.get('avatar');

    if (display_name.length > 80) {
      showToast('Nama tampilan maksimal 80 karakter.', 'error');
      return;
    }

    setBusy(btn, true, 'Menyimpan...');
    try {
      let avatar_url = profile.avatar_url || null;
      if (file && file.size > 0) {
        if (!file.type.startsWith('image/')) throw new Error('File harus berupa gambar.');
        if (file.size > 2 * 1024 * 1024) throw new Error('Ukuran gambar maksimal 2MB.');
        const ext = (file.type.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
        const path = `avatars/${wallet}-${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage.from('avatars').upload(path, file, {
          upsert: true,
          contentType: file.type,
        });
        if (uploadErr) throw readableStorageError(uploadErr);
        const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
        avatar_url = pub.publicUrl;
      }

      // UPDATE users SENGAJA TIDAK lewat anon key: policy UPDATE publik sudah
      // dicabut (database/migrations/*_revoke_public_update_users.sql).
      // Kepemilikan wallet dibuktikan tanda tangan Ed25519 oleh Edge Function
      // update-profile. Karena itu response 200 dari server TIDAK cukup untuk
      //menganggap "berhasil" — kita baca ulang barisnya dan menolak sukses palsu.
      const { signature, message } = await signTextMessage(
        buildProfileMessage({ wallet, display_name, bio }),
      );

      setBusy(btn, true, 'Memverifikasi...');
      await callEdgeFunction('update-profile', {
        wallet_address: wallet,
        display_name,
        bio,
        avatar_url,
        signed_message: message,
        signature,
      });

      const { data: fresh, error: readErr } = await supabase
        .from('users')
        .select('display_name, bio, avatar_url')
        .eq('wallet_address', wallet)
        .maybeSingle();

      if (readErr) throw readErr;
      if (!fresh) {
        throw new Error(
          'Profil tidak tersimpan: baris wallet kamu tidak ditemukan di server. Coba logout lalu login ulang.'
        );
      }
      // Konfirmasi nyata: isi DB harus sama persis dengan yang dikirim.
      if ((fresh.display_name || '').trim() !== display_name || (fresh.bio || '') !== bio) {
        throw new Error(
          'Profil tidak tersimpan: server tidak mengembalikan data yang sama dengan yang dikirim. ' +
          'Periksa koneksi lalu coba lagi.'
        );
      }

      profile = fresh;
      nameEl.textContent = profile.display_name?.trim() || shortAddress(wallet);
      fallbackEl.textContent = (profile.display_name?.trim() || wallet).slice(0, 2).toUpperCase();
      const safeFreshAvatar = safeStorageUrl(profile.avatar_url);
      if (safeFreshAvatar) {
        avatarEl.style.backgroundImage = `url("${safeFreshAvatar}")`;
        avatarEl.style.backgroundSize = 'cover';
        avatarEl.style.backgroundPosition = 'center';
        fallbackEl.style.display = 'none';
      } else {
        avatarEl.style.backgroundImage = '';
        fallbackEl.style.display = '';
      }

      fileInput.value = '';
      uploadPreview.style.display = 'none';
      uploadName.textContent = '';

      showToast('Profil disimpan.', 'success');
    } catch (err) {
      showToast(readableStorageError(err).message, 'error');
    } finally {
      setBusy(btn, false);
    }
  });
}

/** Terjemahkan error Supabase Storage menjadi pesan yang jujur untuk user. */
function readableStorageError(err) {
  if (!err) return new Error('Gagal menyimpan.');
  const msg = err.message || String(err);
  if (/row-level security|42501/i.test(msg)) {
    return new Error(
      'Upload foto ditolak server karena kebijakan izin bucket belum diterapkan. ' +
      'Jalankan migration storage policy di database/migrations/, lalu coba lagi.'
    );
  }
  return new Error(msg);
}

async function loadStats(wallet) {
  const statDonated = document.getElementById('stat-donated');
  const statCampaigns = document.getElementById('stat-campaigns');
  const statRaised = document.getElementById('stat-raised');
  [statDonated, statCampaigns, statRaised].forEach((el) => el.classList.add('is-loading'));

  const [donRes, campRes] = await Promise.all([
    supabase.from('donations').select('amount_sol').eq('donor_wallet', wallet),
    supabase.from('campaigns').select('status, donations(amount_sol)').eq('creator_wallet', wallet),
  ]);

  // Dulu error kedua query ini diabaikan diam-diam sehingga statistik
  // menampilkan "0.000" palsu padahal server error. Sekarang jujur: "—".
  if (donRes.error) statDonated.textContent = '—';
  else {
    statDonated.textContent = (donRes.data || [])
      .reduce((s, d) => s + Number(d.amount_sol), 0).toFixed(3);
  }

  if (campRes.error) {
    statCampaigns.textContent = '—';
    statRaised.textContent = '—';
  } else {
    statCampaigns.textContent = (campRes.data || []).filter((c) => c.status === 'active').length;
    statRaised.textContent = (campRes.data || [])
      .reduce((s, c) => s + (c.donations || []).reduce((x, d) => x + Number(d.amount_sol), 0), 0)
      .toFixed(3);
  }

  const anyError = donRes.error || campRes.error;
  [statDonated, statCampaigns, statRaised].forEach((el) => {
    el.classList.remove('is-loading');
    el.classList.toggle('is-error', Boolean(anyError));
  });

  if (anyError) {
    showToast(`Gagal memuat sebagian statistik profil: ${anyError.message}`, 'error');
  }
}

async function loadMyCampaigns(root, wallet) {
  const container = root.querySelector('#my-campaigns');
  container.removeAttribute('aria-busy');

  const { data: campaigns, error } = await supabase
    .from('campaigns')
    .select('*, donations(amount_sol)')
    .eq('creator_wallet', wallet)
    .order('created_at', { ascending: false });

  if (error) {
    container.innerHTML = `<p class="error">Gagal memuat campaign: ${escapeHtml(error.message)}</p>`;
    return;
  }
  if (!campaigns || !campaigns.length) {
    container.innerHTML = `<p class="empty-state">Kamu belum membuat campaign apapun.</p>`;
    return;
  }

  // CATATAN STRUKTUR: kartu adalah <article>, bukan <a>. Versi sebelumnya memakai
  // <a class="card"> yang berisi <a class="btn-ghost"> — itu HTML tidak valid
  // (anchor di dalam anchor). Parser browser menutup anchor luar lebih dulu,
  // sehingga tombolnya jatuh keluar dari kartu: tidak ada handler yang terpasang
  // dan klik justru menavigasi ke halaman campaign. Tombol sekarang <button>
  // sungguhan, dan tautan ke halaman publik memakai <a> terpisah.
  container.innerHTML = campaigns.map((c) => {
    const raised = (c.donations || []).reduce((s, d) => s + Number(d.amount_sol), 0);
    const pct = progressPercent(raised, c.target_amount).toFixed(0);
    const meta = statusMeta(c.status);
    const isClosed = meta.key === 'closed';
    const isFlagged = meta.key === 'flagged';
    return `
      <article class="card ${meta.card}" data-id="${escapeHtml(c.id)}">
        <span class="status-badge ${meta.badge}">${escapeHtml(meta.label)}</span>
        <h2><a class="card-title-link" href="#/campaign/${escapeHtml(c.id)}">${escapeHtml(c.title)}</a></h2>
        <div class="progress-bar"><div class="progress-fill" data-width="${pct}%"></div></div>
        <p class="progress-label">${raised.toFixed(3)} / ${c.target_amount} SOL &middot; ${pct}%</p>
        ${isFlagged && c.flag_reason ? `<p class="flag-reason">Alasan laporan: ${escapeHtml(c.flag_reason)}</p>` : ''}
        <div class="card-actions">
          <a class="btn-ghost" href="#/campaign/${escapeHtml(c.id)}">Lihat halaman publik</a>
          ${
            isClosed || isFlagged
              ? ''
              : `<button type="button" class="btn-ghost" data-act="close" data-id="${escapeHtml(c.id)}">Tutup campaign</button>`
          }
        </div>
      </article>
    `;
  }).join('');

  requestAnimationFrame(() => {
    container.querySelectorAll('.progress-fill').forEach((fill) => {
      fill.style.width = fill.dataset.width;
    });
  });

  container.querySelectorAll('[data-act="close"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const card = btn.closest('.card');
      const title = card?.querySelector('.card-title-link')?.textContent?.trim() || 'campaign ini';

      const confirmed = await confirmDialog({
        title: 'Tutup campaign?',
        message:
          `"${title}" akan berhenti menerima donasi baru. Campaign tetap terlihat publik ` +
          'beserta seluruh riwayat donasinya — tidak bisa dihapus atau disembunyikan.',
        detail: 'Tindakan ini tidak bisa dibatalkan dari halaman ini.',
        confirmLabel: 'Ya, tutup campaign',
        cancelLabel: 'Batal',
        variant: 'danger',
        trigger: btn,
      });
      if (!confirmed) return;

      setBusy(btn, true, 'Menutup...');
      try {
        // Menutup campaign harus lewat Edge Function: RLS sengaja tidak
        // mengizinkan UPDATE campaigns dari anon key (kalau dibiarkan publik,
        // siapa pun bisa mengganti campaign_wallet milik orang lain).
        const { signature, message } = await signTextMessage(
          buildStatusMessage({ wallet, campaignId: id, status: 'closed' }),
        );
        await callEdgeFunction('set-campaign-status', {
          campaign_id: id,
          // Nama field WAJIB wallet_address, bukan creator_wallet: Edge Function
          // memakai field ini untuk mencocokkan signature dan menentukan
          // apakah pengirim adalah creator. Kirim yang salah = 400, dan user
          // melihat "wajib diisi" padahal semua data sebenarnya ada.
          wallet_address: wallet,
          new_status: 'closed',
          signed_message: message,
          signature,
        });
        showToast('Campaign ditutup. Riwayat donasinya tetap publik.', 'success');
        await loadMyCampaigns(root, wallet);
      } catch (err) {
        showToast(err.message || 'Gagal menutup campaign.', 'error');
        setBusy(btn, false);
      }
    });
  });
}

async function loadMyDonations(root, wallet, append) {
  const container = root.querySelector('#my-donations');
  const btnMore = root.querySelector('#btn-more');
  container.removeAttribute('aria-busy');

  const from = append ? loadedDonations : 0;
  const to = from + PAGE_SIZE - 1; // inklusif: tepat PAGE_SIZE baris (bukan +1)

  const { data: donations, error } = await supabase
    .from('donations')
    .select('*, campaigns(title, status)')
    .eq('donor_wallet', wallet)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    if (!append) {
      container.innerHTML = `<p class="error">Gagal memuat riwayat: ${escapeHtml(error.message)}</p>`;
    }
    btnMore.style.display = 'none';
    loadedDonations = 0;
    return;
  }

  const rows = donations || [];
  if (!rows.length) {
    if (!append) {
      container.innerHTML = `
        <div class="empty-state">Belum ada riwayat donasi, mulai jelajahi campaign di <a href="#/dashboard">Dashboard</a></div>
      `;
    }
    btnMore.style.display = 'none';
    loadedDonations = append ? loadedDonations : 0;
    return;
  }

  loadedDonations = from + rows.length;

  const html = rows.map((d) => `
    <tr>
      <td data-label="Campaign"><a href="#/campaign/${escapeHtml(d.campaign_id)}">${escapeHtml(d.campaigns?.title || '—')}</a></td>
      <td data-label="Jumlah">${Number(d.amount_sol).toFixed(4)} SOL</td>
      <td data-label="Waktu">${formatDate(d.created_at)}</td>
      <td data-label="Bukti"><a href="${escapeHtml(explorerUrl(d.tx_signature))}" target="_blank" rel="noopener noreferrer">Lihat di Explorer</a></td>
    </tr>
  `).join('');

  if (append) {
    // Append harus masuk ke <tbody> yang sudah ada. Kalau append ke #my-donations
    // (div pembungkus), <tr> baru menjadi anak div dan tidak pernah tampil/terhitung.
    const tbody = container.querySelector('tbody');
    if (!tbody) {
      btnMore.style.display = 'none';
      return;
    }
    const temp = document.createElement('tbody');
    temp.innerHTML = html;
    while (temp.firstChild) tbody.appendChild(temp.firstChild);
  } else {
    container.innerHTML = `
      <div class="table-panel">
        <table class="ledger-table" aria-label="Riwayat donasi saya">
          <thead>
            <tr><th scope="col">Campaign</th><th scope="col">Jumlah</th><th scope="col">Waktu</th><th scope="col">Bukti</th></tr>
          </thead>
          <tbody>${html}</tbody>
        </table>
      </div>
    `;
  }

  // Baris < PAGE_SIZE berarti sudah sampai halaman terakhir.
  btnMore.style.display = rows.length >= PAGE_SIZE ? '' : 'none';
}

function bindTabs(root) {
  const tabs = root.querySelectorAll('.tab');
  const panels = {
    settings: root.querySelector('#tab-settings'),
    campaigns: root.querySelector('#tab-campaigns'),
    donations: root.querySelector('#tab-donations'),
  };

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const key = tab.dataset.tab;
      tabs.forEach((t) => { t.classList.remove('is-active'); t.setAttribute('aria-selected', 'false'); });
      tab.classList.add('is-active');
      tab.setAttribute('aria-selected', 'true');
      Object.values(panels).forEach((p) => { if (p) p.hidden = true; });
      if (panels[key]) panels[key].hidden = false;
    });
  });
}

/**
 * Pesan yang ditandatangani untuk operasi server-side. Pola ini sengaja
 * memakai string yang dapat ditebak server (Wallet / Timestamp) supaya Edge
 * Function bisa mengurai dan memverifikasi tanda tangannya.
 */
function buildProfileMessage({ wallet, display_name, bio }) {
  return (
    'Verifikasi Profil — Platform Donasi Web3\n\n' +
    `Wallet: ${wallet}\n` +
    `Display Name: ${display_name}\n` +
    `Bio: ${bio}\n` +
    `Timestamp: ${new Date().toISOString()}`
  );
}

function buildStatusMessage({ wallet, campaignId, status, flagReason = '' }) {
  return (
    'Verifikasi Status Campaign — Platform Donasi Web3\n\n' +
    `Wallet: ${wallet}\n` +
    `Campaign: ${campaignId}\n` +
    `New Status: ${status}\n` +
    // Baris ini HARUS ikut ditandatangani: server mencocokkan flag_reason pada
    // pesan dengan yang di payload, supaya signature lama tidak bisa dipakai
    // ulang untuk alasan yang berbeda.
    `Flag Reason: ${flagReason}\n` +
    `Timestamp: ${new Date().toISOString()}`
  );
}
