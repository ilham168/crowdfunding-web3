import { getSavedWallet } from './wallet.js';
import { navigate } from './router.js';

export function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    ["'"]: '&#39;',
  }[m]));
}

export function shortAddress(addr = '') {
  return addr.length > 10 ? `${addr.slice(0, 4)}...${addr.slice(-4)}` : addr;
}

export function formatDate(iso) {
  return new Date(iso).toLocaleString('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function requireWallet() {
  const wallet = getSavedWallet();
  if (!wallet) {
    navigate('/login');
    return null;
  }
  return wallet;
}
