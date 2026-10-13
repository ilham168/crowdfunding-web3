import { escapeHtml, shortAddress, safeStorageUrl } from '../utils.js';

export function renderNav(active, wallet, avatarUrl, isAdmin = false) {
  const short = wallet ? shortAddress(wallet) : '';
  const link = (path, label, key) =>
    `<a href="#${path}" class="${active === key ? 'active' : ''}">${label}</a>`;

  // Sumber avatar_url adalah baris DB; jangan pernah render sebagai gambar
  // kalau bukan https dari Supabase Storage project ini (lihat safeStorageUrl).
  const safeAvatar = safeStorageUrl(avatarUrl);
  const avatarHtml = safeAvatar
    ? `<img src="${escapeHtml(safeAvatar)}" alt="" />`
    : short.slice(0, 2).toUpperCase();

  return `
    <nav class="topnav" role="navigation" aria-label="Navigasi utama">
      <div class="brand">Donasi<span>Web3</span></div>
      <div class="nav-links">
        ${link('/dashboard', 'Campaign', 'dashboard')}
        ${link('/transparency', 'Transparansi', 'transparency')}
        ${
          // Link admin hanya dirender kalau status moderator sudah diketahui.
          // Menyembunyikan link BUKAN proteksi (route tetap bisa diketik) —
          // ini cuma supaya moderator tidak mencari-cari menu yang tidak ada.
          isAdmin ? link('/admin', 'Moderasi', 'admin') : ''
        }
      </div>
      <div class="nav-wallet">
        <a class="nav-avatar-link wallet-chip" href="#/profile" title="${escapeHtml(wallet ?? '')}" aria-label="Buka profil">
          <span class="wallet-avatar" aria-hidden="true">${avatarHtml}</span>
          ${short}
        </a>
        <button id="btn-logout" class="btn-ghost" type="button">Keluar</button>
      </div>
    </nav>
  `;
}

export function bindLogout(root, onLogout) {
  root.querySelector('#btn-logout')?.addEventListener('click', onLogout);
}
