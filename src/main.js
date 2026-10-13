import './style.css';
import './components/particles.css';
import { registerRoute, startRouter, navigate } from './router.js';
import { renderLogin } from './pages/login.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderCreateCampaign } from './pages/createCampaign.js';
import { renderCampaignDetail } from './pages/campaignDetail.js';
import { renderTransparency } from './pages/transparency.js';
import { renderProfile } from './pages/profile.js';
import { renderAdmin } from './pages/admin.js';
import { getSavedWallet } from './wallet.js';
import { mountDevnetBanner } from './components/devnetBanner.js';

// Banner devnet selalu tampil (login maupun setelah login).
mountDevnetBanner();

registerRoute('/login', renderLogin);
registerRoute('/dashboard', renderDashboard);
registerRoute('/create', renderCreateCampaign);
registerRoute('/campaign/:id', renderCampaignDetail);
registerRoute('/transparency', renderTransparency);
registerRoute('/profile', renderProfile);
// Rute admin tetap publik di sisi router (hash bisa diketik siapa saja) —
// otorisasi nyata dilakukan di dalam renderAdmin lewat check-admin.
registerRoute('/admin', renderAdmin);

const root = document.getElementById('app');

if (!window.location.hash) {
  navigate(getSavedWallet() ? '/dashboard' : '/login');
}

startRouter(root);
