// =========================================================
// Supabase Edge Function: update-profile
//
// Menyimpan perubahan profil pengguna TANPA membuka UPDATE publik pada tabel
// `users`.
//
// Mengapa tidak boleh RLS biasa:
//   RLS tidak bisa membuktikan "siapa yang sedang.request" — semua request
//   dari browser datang dengan anon key yang sama. Policy
//   `auth.uid() = wallet_address` SELALU false untuk klien tanpa sesi JWT,
//   sedangkan policy `USING (true)` berarti siapa pun bisa menulis baris
//   wallet mana pun. Keduanya tidak benar-benar membuktikan kepemilikan.
//
// Solusi: klien menandatangani isi profil yang akan dikirim. Fungsi ini
// memverifikasi signature Ed25519 terhadap wallet_address tersebut. Kalau
// tandatangan cocok, wallet itu pasti pemilik profilnya sendiri.
//
// Effect policy yang dibutuhkan: SELECT tetap publik (supaya profil & avatar
// campaign bisa dibaca semua orang) — hanya INSERT/UPDATE yang lewat fungsi ini.
//
// Deploy:
//   supabase functions deploy update-profile --no-verify-jwt
// =========================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import { ed25519 } from 'npm:@noble/curves@1/ed25519.js';
import { handlePreflight, json } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

// Origin project ini; avatar_url hanya boleh menunjuk Storage project ini.
const SUPABASE_ORIGIN = (() => {
  try {
    return SUPABASE_URL ? new URL(SUPABASE_URL).origin : null;
  } catch {
    return null;
  }
})();

const MAX_MESSAGE_AGE_MS = 5 * 60 * 1000;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58ToBytes(input: string): Uint8Array {
  let num = 0n;
  for (const ch of input) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Alamat wallet bukan base58 yang valid.');
    num = num * 58n + BigInt(idx);
  }
  const bytes: number[] = [];
  while (num > 0n) {
    bytes.unshift(Number(num & 0xffn));
    num >>= 8n;
  }
  for (const ch of input) {
    if (ch === '1') bytes.unshift(0);
    else break;
  }
  return new Uint8Array(bytes);
}

/**
 * Baca baris "Field: value" dari pesan bertanda tangan. Pola ini sama dengan
 * create-campaign supaya klien hanya butuh satu helper penanda tangan.
 */
function field(message: string, label: string): string | null {
  const re = new RegExp(`^${label}: (.*)$`, 'm');
  const m = message.match(re);
  return m ? m[1].trim() : null;
}

/** Pastikan pesan ditandatangani baru (anti-replay). */
function assertFresh(message: string): void {
  const ts = field(message, 'Timestamp');
  if (!ts) throw new Error('Pesan tidak memiliki Timestamp.');
  const when = Date.parse(ts);
  if (Number.isNaN(when)) throw new Error('Timestamp tidak valid.');
  if (Math.abs(Date.now() - when) > MAX_MESSAGE_AGE_MS) {
    throw new Error('Pesan sudah kedaluwarsa. Muat ulang halaman lalu coba lagi.');
  }
}

/**
 * Buktikan wallet menandatangani isi profil yang DIKIRIM, bukan isi lain.
 * Tanpa perbandingan nilai, penyerang bisa menandatangani pesan lama lalu
 * mengirim bio berbeda.
 */
function assertMatchesPayload(message: string, p: ProfilePayload): void {
  const checks: [string, string][] = [
    ['Wallet', p.wallet_address],
    ['Display Name', p.display_name],
    ['Bio', p.bio],
  ];
  for (const [label, expected] of checks) {
    const actual = field(message, label);
    if (actual !== expected) {
      throw new Error(`Isi "${label}" tidak cocok dengan pesan yang ditandatangani.`);
    }
  }
}

// Public key Solana = base58; signature dari Phantom = base64 (lihat
// bufferToBase64() di src/wallet.js dan create-campaign).
function base64ToBytes(input: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input) || input.length % 4 !== 0) {
    throw new Error('Signature bukan base64 yang valid.');
  }
  let raw: string;
  try {
    raw = atob(input);
  } catch {
    throw new Error('Signature bukan base64 yang valid.');
  }
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function verifySignature(wallet: string, message: string, signature: string): void {
  if (!BASE58_RE.test(wallet)) throw new Error('Format wallet_address tidak valid.');
  const pk = base58ToBytes(wallet);
  const sig = base64ToBytes(signature);
  if (pk.length !== 32 || sig.length !== 64) throw new Error('Panjang kunci/signature tidak valid.');
  if (!ed25519.verify(sig, new TextEncoder().encode(message), pk)) {
    throw new Error('Signature tidak valid untuk wallet ini.');
  }
}

interface ProfilePayload {
  wallet_address: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  signed_message: string;
  signature: string;
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return handlePreflight(origin);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);

  try {
    const p = (await req.json()) as ProfilePayload;

    if (!p.wallet_address || !p.signature || !p.signed_message) {
      return json({ error: 'wallet_address, signed_message, dan signature wajib diisi.' }, 400, origin);
    }
    const display_name = (p.display_name ?? '').trim();
    // Bio dinormalisasi persis seperti profile.js (whitespace diratakan + trim)
    // SEBELUM signature dicocokkan. Kalau normalisasi hanya di satu sisi,
    // tanda tangan atas "halo\n\ndunia" akan selalu ditolak.
    const bio = (p.bio ?? '').replace(/\s+/g, ' ').trim();

    // Validasi di server WAJIB ada: kolom CHECK di database bukan satu-satunya
    // defense — since Edge Function memakai service role yang melewati RLS.
    if (display_name.length > 80) return json({ error: 'Nama tampilan maksimal 80 karakter.' }, 400, origin);
    if (bio.length > 240) return json({ error: 'Bio maksimal 240 karakter.' }, 400, origin);
    // avatar_url TIDAK ikut ditandatangani, jadi validasi server adalah satu-satunya
    // pengaman: batasi ke https + host Storage project ini (mencegah gambar dari
    // host pihak ketiga menempel di profil).
    let avatar_url: string | null = null;
    if (p.avatar_url !== null && p.avatar_url !== undefined && p.avatar_url !== '') {
      if (typeof p.avatar_url !== 'string') {
        return json({ error: 'avatar_url tidak valid.' }, 400, origin);
      }
      if (p.avatar_url.length > 300) {
        return json({ error: 'avatar_url terlalu panjang.' }, 400, origin);
      }
      if (!SUPABASE_ORIGIN) {
        return json({ error: 'Konfigurasi server tidak lengkap.' }, 500, origin);
      }
      let u: URL;
      try {
        u = new URL(p.avatar_url);
      } catch {
        return json({ error: 'avatar_url harus berupa URL yang valid.' }, 400, origin);
      }
      if (u.protocol !== 'https:' || u.origin !== SUPABASE_ORIGIN) {
        return json(
          { error: 'avatar_url harus URL https dari Supabase Storage project ini.' },
          400,
          origin,
        );
      }
      avatar_url = p.avatar_url;
    }

    assertFresh(p.signed_message);
    assertMatchesPayload(p.signed_message, { ...p, display_name, bio });
    verifySignature(p.wallet_address, p.signed_message, p.signature);

    // .select() dipaksa agar kita tahu apakah ada baris yang benar-benar
    // berubah. Tanpa ini UPDATE yang tidak mengenai apa pun tetap mengembalikan
    // 200, dan klien harus menebak-nebak apakah perubahan benar-benar terjadi.
    const { data: updated, error } = await supabaseAdmin
      .from('users')
      .update({ display_name, bio, avatar_url })
      .eq('wallet_address', p.wallet_address)
      .select('wallet_address')
      .maybeSingle();

    if (error) throw error;
    if (!updated) {
      return json(
        { error: 'Baris profil untuk wallet ini tidak ada. Login ulang lalu coba lagi.' },
        404,
        origin,
      );
    }
    return json({ ok: true, wallet_address: p.wallet_address }, 200, origin);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal menyimpan profil.';
    const status = /signature|wallet|Timestamp|cocok|kedaluwarsa|tidak valid/i.test(message) ? 403 : 400;
    return json({ error: message }, status, origin);
  }
});