import './style.css';
import './components/particles.css';
import { registerRoute, startRouter, navigate } from './router.js';
import { renderLogin } from './pages/login.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderCreateCampaign } from './pages/createCampaign.js';
import { renderCampaignDetail } from './pages/campaignDetail.js';
import { renderTransparency } from './pages/transparency.js';
import { getSavedWallet } from './wallet.js';

registerRoute('/login', renderLogin);
registerRoute('/dashboard', renderDashboard);
registerRoute('/create', renderCreateCampaign);
registerRoute('/campaign/:id', renderCampaignDetail);
registerRoute('/transparency', renderTransparency);

const root = document.getElementById('app');

if (!window.location.hash) {
  navigate(getSavedWallet() ? '/dashboard' : '/login');
}

startRouter(root);
