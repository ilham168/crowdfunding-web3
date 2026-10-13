import { navigate } from '../router.js';
import { supabase } from '../supabaseClient.js';
import { disconnectWallet } from '../wallet.js';
import { renderNav, bindLogout } from '../components/nav.js';
import { escapeHtml, requireWallet, statusMeta, progressPercent, safeStorageUrl } from '../utils.js';
import { mountAntigravity, skeletonCards } from '../components/ui.js';
import { isAdminWallet } from '../adminAccess.js';

export async function renderDashboard(root) {
  const wallet = requireWallet();
  if (!wallet) return;

  const { data: me, error: meErr } = await supabase
    .from('users')
    .select('avatar_url')
    .eq('wallet_address', wallet)
    .maybeSingle();

  // Link Moderasi hanya muncul untuk wallet yang memang moderator. Kegagalan
  // cek tidak bolehynyembunyikan halaman: renderNav menerima undefined → link
  // tidak dirender, halaman tetap normal.
  const isAdmin = await isAdminWallet(wallet);

  root.innerHTML = `
    ${renderNav('dashboard', wallet, me?.avatar_url, isAdmin)}
    <section class="page">
      <div class="page-header">
        <div>
          <h1>Semua Campaign</h1>
          <p class="muted">Campaign aktif, ditutup, dan yang sedang ditinjau — semuanya tetap publik.</p>
        </div>
        <a href="#/create" class="btn-primary">+ Buat Campaign</a>
      </div>
      ${meErr ? '<p class="inline-warning">Avatar tidak bisa dimuat; sisanya tetap berfungsi.</p>' : ''}
      <div id="campaign-grid" class="grid" aria-busy="true">${skeletonCards(3)}</div>
    </section>
  `;

  mountAntigravity(root);
  bindLogout(root, () => {
    disconnectWallet();
    navigate('/login');
  });

  const { data: campaigns, error } = await supabase
    .from('campaigns')
    .select('*, donations(amount_sol)')
    .order('created_at', { ascending: false });

  const grid = root.querySelector('#campaign-grid');
  grid.removeAttribute('aria-busy');

  if (error) {
    grid.innerHTML = `<p class="error">Gagal memuat data: ${escapeHtml(error.message)}</p>`;
    return;
  }
  if (!campaigns || !campaigns.length) {
    grid.innerHTML = `<p class="empty-state">Belum ada campaign. Jadilah yang pertama membuatnya!</p>`;
    return;
  }

  grid.innerHTML = campaigns.map(cardHtml).join('');

  // Thumbnail yang gagal dimuat dihapus lewat delegasi (bukan atribut inline
  // onerror) supaya markup tetap bersih dan kompatibel dengan CSP.
  grid.addEventListener(
    'error',
    (e) => {
      const img = e.target;
      if (img instanceof HTMLImageElement && img.classList.contains('card-thumb')) {
        img.remove();
      }
    },
    true,
  );

  // Pindahkan thumbnail ke belakang badge absolut supaya badge selalu di atas.
  requestAnimationFrame(() => {
    grid.querySelectorAll('.progress-fill').forEach((fill) => {
      fill.style.width = fill.dataset.width;
    });
  });
}

function cardHtml(c) {
  const raised = (c.donations || []).reduce((sum, d) => sum + Number(d.amount_sol), 0);
  const pct = progressPercent(raised, c.target_amount).toFixed(0);
  const meta = statusMeta(c.status);
  // Foto pertama (kalau ada) jadi thumbnail. .card-thumb sudah ada di CSS
  // tapi belum pernah dipakai — foto campaign tidak pernah tampil di grid.
  const thumb = Array.isArray(c.photo_urls)
    ? c.photo_urls.map(safeStorageUrl).find(Boolean)
    : null;
  return `
    <a class="card ${meta.card}" href="#/campaign/${escapeHtml(c.id)}">
      ${
        thumb
          ? `<img class="card-thumb" src="${escapeHtml(thumb)}" alt="" loading="lazy" />`
          : ''
      }
      <span class="status-badge ${meta.badge}">${escapeHtml(meta.label)}</span>
      <h2>${escapeHtml(c.title)}</h2>
      <p class="card-desc">${escapeHtml(c.description).slice(0, 110)}${c.description.length > 110 ? '…' : ''}</p>
      <div class="progress-bar"><div class="progress-fill" data-width="${pct}%"></div></div>
      <p class="progress-label">${raised.toFixed(3)} / ${c.target_amount} SOL &middot; ${pct}%</p>
    </a>
  `;
}
