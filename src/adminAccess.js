// =========================================================
// src/adminAccess.js
//
// Satu-satunya tempat di frontend yang bertanya "apakah wallet ini moderator?".
//
// Kenapa file terpisah: tiga halaman (nav, panel admin, router) butuh jawaban
// yang sama, dan mengulangi request check-admin di tiap tempat berarti
// environment yang berbeda bisa menghasilkan tampilan yang berbeda.
//
// PENTING: hasil ini hanya untuk tampilan. Otorisasi nyata ada di server
// (set-campaign-status memakai service role untuk mengecek ulang whitelist),
// sehingga status yang disimpan di browser tidak dianggap sebagai keamanan.
// =========================================================

import { callEdgeFunction } from './supabaseClient.js';

// Hasil dicek sekali per sesi (per wallet), lalu di-cache sampai tab ini
// reload atau `clearAdminCache()` dipanggil (saat logout). Spec admin:
// cache selama sesi supaya check-admin tidak dipanggil di setiap render.
// Ini murni kemudahan UI; server tetap memverifikasi ulang di setiap operasi.
const cache = new Map();

/**
 * @returns {Promise<boolean>} true hanya kalau server menyatakan wallet ini
 * moderator. Kegagalan jaringan TIDAK dianggap sebagai "admin", dan juga
 * tidak dianggap error fatal: pemanggil hanya perlu menyembunyikan link.
 */
export async function isAdminWallet(wallet) {
  if (!wallet) return false;

  if (cache.has(wallet)) return cache.get(wallet);

  let value = false;
  try {
    const data = await callEdgeFunction('check-admin', { wallet_address: wallet });
    value = Boolean(data?.is_admin);
  } catch (err) {
    console.warn('[check-admin] gagal, perlakukan sebagai bukan moderator:', err?.message);
    value = false;
  }

  cache.set(wallet, value);
  return value;
}

export function clearAdminCache() {
  cache.clear();
}