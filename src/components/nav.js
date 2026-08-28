import { escapeHtml, shortAddress } from '../utils.js';

export function renderNav(active, wallet) {
  const short = wallet ? shortAddress(wallet) : '';
  const link = (path, label, key) =>
    `<a href="#${path}" class="${active === key ? 'active' : ''}">${label}</a>`;

  return `
    <nav class="topnav" role="navigation" aria-label="Navigasi utama">
      <div class="brand">Donasi<span>Web3</span></div>
      <div class="nav-links">
        ${link('/dashboard', 'Campaign', 'dashboard')}
        ${link('/transparency', 'Transparansi', 'transparency')}
      </div>
      <div class="nav-wallet">
        <span class="wallet-chip" title="${escapeHtml(wallet ?? '')}" aria-label="${escapeHtml(wallet ?? '')}">${short}</span>
        <button id="btn-logout" class="btn-ghost" type="button">Keluar</button>
      </div>
    </nav>
  `;
}

export function bindLogout(root, onLogout) {
  root.querySelector('#btn-logout')?.addEventListener('click', onLogout);
}
