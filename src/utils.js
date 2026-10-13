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

/** Origin project Supabase ini (dari VITE_SUPABASE_URL), atau null bila belum di-set. */
function storageOrigin() {
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base) return null;
  try {
    return new URL(base).origin;
  } catch {
    return null;
  }
}

/**
 * Terima URL gambar HANYA kalau protokolnya https dan host-nya persis sama
 * dengan project Supabase ini. Nilai dari database (avatar_url, photo_urls)
 * dianggap tidak tepercaya sampai lolos di sini. Mengembalikan '' bila tidak
 * valid, supaya pemanggil memperlakukannya sebagai "tidak ada gambar".
 */
export function safeStorageUrl(url) {
  if (typeof url !== 'string' || !url) return '';
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return '';
  }
  if (parsed.protocol !== 'https:') return '';
  const allowed = storageOrigin();
  if (!allowed || parsed.origin !== allowed) return '';
  return parsed.href;
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

/**
 * Sumber kebenaran tunggal untuk status campaign.
 *
 * PENTING: `acceptsDonation: false` untuk status apa pun yang tidak dikenal.
 * Default-nya tutup — kalau DB punya status baru yang belum dikenali frontend,
 * form donasi HARUS tersembunyi, bukan terbuka.
 */
export const CAMPAIGN_STATUSES = {
  active: {
    key: 'active',
    label: 'Aktif',
    badge: 'is-active',
    card: '',
    acceptsDonation: true,
  },
  closed: {
    key: 'closed',
    label: 'Ditutup',
    badge: 'is-closed',
    card: 'is-closed',
    acceptsDonation: false,
  },
  flagged: {
    key: 'flagged',
    label: '⚠ Dilaporkan — sedang ditinjau',
    badge: 'is-flagged',
    card: 'is-flagged',
    acceptsDonation: false,
  },
};

const UNKNOWN_STATUS = {
  key: 'unknown',
  label: 'Status tidak dikenal',
  badge: 'is-unknown',
  card: 'is-closed',
  acceptsDonation: false,
};

export function statusMeta(status) {
  return CAMPAIGN_STATUSES[status] ?? UNKNOWN_STATUS;
}

/** Pesan yang jujur & spesifik kenapa form donasi tidak ditampilkan. */
export function donationBlockedMessage(status) {
  const meta = statusMeta(status);
  if (meta.key === 'closed') return 'Campaign ini sudah ditutup untuk donasi baru.';
  if (meta.key === 'flagged') {
    return 'Campaign ini sedang ditinjau karena ada laporan. Donasi baru sedang ditahan, ' +
      'tapi riwayat donasi yang sudah tercatat tetap terlihat dan bisa diverifikasi.';
  }
  return 'Campaign ini sedang tidak menerima donasi baru.';
}

/** Persentase progress 0-100, aman terhadap target 0 / NaN. */
export function progressPercent(raised, target) {
  const t = Number(target);
  if (!Number.isFinite(t) || t <= 0) return 0;
  const pct = (Number(raised) / t) * 100;
  if (!Number.isFinite(pct) || pct < 0) return 0;
  return Math.min(100, pct);
}
