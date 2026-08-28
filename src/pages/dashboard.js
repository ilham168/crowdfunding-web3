import { navigate } from '../router.js';
import { supabase } from '../supabaseClient.js';
import { disconnectWallet } from '../wallet.js';
import { renderNav, bindLogout } from '../components/nav.js';
import { escapeHtml, requireWallet } from '../utils.js';
import { mountAntigravity, skeletonCards } from '../components/ui.js';

export async function renderDashboard(root) {
  const wallet = requireWallet();
  if (!wallet) return;

  root.innerHTML = `
    ${renderNav('dashboard', wallet)}
    <section class="page">
      <div class="page-header">
        <h1>Campaign Aktif</h1>
        <a href="#/create" class="btn-primary">+ Buat Campaign</a>
      </div>
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
  if (!campaigns.length) {
    grid.innerHTML = `<p class="empty-state">Belum ada campaign. Jadilah yang pertama membuatnya!</p>`;
    return;
  }

  grid.innerHTML = campaigns.map(cardHtml).join('');

  requestAnimationFrame(() => {
    grid.querySelectorAll('.progress-fill').forEach((fill) => {
      fill.style.width = fill.dataset.width;
    });
  });
}

function cardHtml(c) {
  const raised = (c.donations || []).reduce((sum, d) => sum + Number(d.amount_sol), 0);
  const pct = Math.min(100, (raised / Number(c.target_amount)) * 100).toFixed(0);
  return `
    <a class="card" href="#/campaign/${c.id}">
      <h2>${escapeHtml(c.title)}</h2>
      <p class="card-desc">${escapeHtml(c.description).slice(0, 110)}${c.description.length > 110 ? '…' : ''}</p>
      <div class="progress-bar"><div class="progress-fill" data-width="${pct}%"></div></div>
      <p class="progress-label">${raised.toFixed(3)} / ${c.target_amount} SOL &middot; ${pct}%</p>
    </a>
  `;
}
