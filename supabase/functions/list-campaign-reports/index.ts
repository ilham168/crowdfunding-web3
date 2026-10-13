// =========================================================
// Supabase Edge Function: list-campaign-reports
//
// Satu-satunya cara TEBAK moderator membaca tabel `campaign_reports`.
//
// Tabel itu TIDAK punya policy SELECT untuk anon/authenticated. Kalau query
// langsung dari browser, PostgREST hanya membalas `[]` (bukan error), jadi UI
// akan menampilkan "Belum ada laporan" padahal isinya ada — itu kebohongan
// yang lebih buruk daripada error. Karena itu daftar laporan dibaca lewat
// fungsi ini dengan service role, dan hanya untuk wallet yang:
//   1. ada di whitelist `admin_wallets`, dan
//   2. membuktikan kepemilikan wallet-nya lewat signature.
//
// Whitelist saja tidak cukup: `wallet_address` yang dikirim klien hanyalah
// klaim, tanpa signature siapa pun yang tahu alamat admin bisa membaca seluruh
// daftar pelapor.
//
// Deploy:
//   supabase functions deploy list-campaign-reports --no-verify-jwt
// =========================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import { ed25519 } from 'npm:@noble/curves@1/ed25519.js';
import { handlePreflight, json } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_MESSAGE_AGE_MS = 5 * 60 * 1000;
const MAX_REPORTS = 200;
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

// Signature dari Phantom = base64 (lihat bufferToBase64() di src/wallet.js).
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

function field(message: string, label: string): string | null {
  const m = message.match(new RegExp(`^${label}: (.*)$`, 'm'));
  return m ? m[1].trim() : null;
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return handlePreflight(origin);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);

  try {
    const { wallet_address, signed_message, signature } = (await req.json()) as {
      wallet_address?: string;
      signed_message?: string;
      signature?: string;
    };

    if (!wallet_address || !BASE58_RE.test(wallet_address)) {
      return json({ error: 'wallet_address tidak valid.' }, 400, origin);
    }
    if (!signed_message || !signature) {
      return json({ error: 'signed_message dan signature wajib diisi.' }, 401, origin);
    }

    const when = Date.parse(field(signed_message, 'Timestamp') ?? '');
    if (Number.isNaN(when)) throw new Error('Timestamp tidak valid.');
    if (Math.abs(Date.now() - when) > MAX_MESSAGE_AGE_MS) {
      throw new Error('Pesan sudah kedaluwarsa. Muat ulang halaman lalu coba lagi.');
    }
    if (field(signed_message, 'Wallet') !== wallet_address) {
      throw new Error('Wallet pada pesan tidak cocok.');
    }

    const pk = base58ToBytes(wallet_address);
    const sig = base64ToBytes(signature);
    if (pk.length !== 32 || sig.length !== 64) throw new Error('Panjang kunci/signature tidak valid.');
    if (!ed25519.verify(sig, new TextEncoder().encode(signed_message), pk)) {
      throw new Error('Signature tidak valid untuk wallet ini.');
    }

    const { data: admin, error: aErr } = await supabaseAdmin
      .from('admin_wallets')
      .select('wallet_address')
      .eq('wallet_address', wallet_address)
      .maybeSingle();
    if (aErr) throw aErr;
    if (!admin) return json({ error: 'Wallet ini bukan moderator.' }, 403, origin);

    const { data, error } = await supabaseAdmin
      .from('campaign_reports')
      .select('id, campaign_id, reporter_wallet, reason, created_at')
      .order('created_at', { ascending: false })
      .limit(MAX_REPORTS);
    if (error) throw error;

    return json({ reports: data ?? [], truncated: (data?.length ?? 0) >= MAX_REPORTS }, 200, origin);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal memuat daftar laporan.';
    const status = /signature|tidak cocok|kedaluwarsa|timestamp|tidak valid/i.test(message)
      ? 403
      : 500;
    return json({ error: message }, status, origin);
  }
});