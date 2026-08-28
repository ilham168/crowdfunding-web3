// =========================================================
// Supabase Edge Function: create-campaign
//
// Membuat campaign TANPA membiarkan anon key langsung insert ke tabel
// `campaigns`. Fungsi ini memverifikasi kepemilikan wallet SEBELUM
// menyimpan, sehingga:
//   1. Tidak ada yang bisa membuat campaign dengan alamat penerima
//      (campaign_wallet) milik orang lain tanpa tanda tangan pemiliknya.
//   2. Tidak ada spam campaign palsu dari klien yang hanya menebak nilai.
//
// Alur:
//   - Klien menandatangani pesan (lihat src/wallet.js signTextMessage)
//     berisi campaign_wallet + title + timestamp.
//   - Fungsi ini memverifikasi signature Ed25519 terhadap campaign_wallet.
//   - Dipaksa campaign_wallet === creator_wallet dan ada pada batch signature
//     (pemilik wallet yang menandatangani = penerima dana).
//
// Deploy:
//   supabase functions deploy create-campaign --no-verify-jwt
//   supabase secrets set ALLOWED_ORIGINS=https://domain-produksi
// =========================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import { ed25519 } from 'npm:@noble/curves@1/ed25519.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

// Batas toleransi kebaruan timestamp (mencegah replay tanda tangan lama).
const MAX_MESSAGE_AGE_MS = 5 * 60 * 1000;

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;
const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

// --- base58 decode (Solana public key) -----------------------------------
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE = 58n;

function base58ToBytes(input: string): Uint8Array {
  let num = 0n;
  for (const ch of input) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('karakter base58 tidak valid');
    num = num * BASE + BigInt(idx);
  }
  const bytes: number[] = [];
  while (num > 0n) {
    bytes.unshift(Number(num & 0xffn));
    num >>= 8n;
  }
  // leading '1' = 0
  for (const ch of input) {
    if (ch === '1') bytes.unshift(0);
    else break;
  }
  return new Uint8Array(bytes);
}

function getSignerAddress(message: string): string {
  // Pesan menyertakan baris "Wallet: <address>".
  const m = message.match(/Wallet:\s*([1-9A-HJ-NP-Za-km-z]{32,44})/);
  return m ? m[1] : '';
}

function getTimestamp(message: string): number {
  const m = message.match(/Timestamp:\s*([0-9T:.Z\-+]+)/);
  return m ? Date.parse(m[1]) : NaN;
}

// --- CORS ---------------------------------------------------------------
function getAllowedOrigins(): string[] {
  const raw = Deno.env.get('ALLOWED_ORIGINS');
  if (raw && raw.trim()) {
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return DEFAULT_ALLOWED_ORIGINS;
}

function buildCorsHeaders(origin: string | null) {
  const allowed = getAllowedOrigins();
  const value = origin && allowed.includes(origin) ? origin : DEFAULT_ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': value,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'X-Content-Type-Options': 'nosniff',
  };
}

function json(body: unknown, status = 200, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const allowedOrigins = getAllowedOrigins();

  if (origin && !allowedOrigins.includes(origin)) {
    return json({ error: 'Origin tidak diizinkan.' }, 403, buildCorsHeaders(null));
  }
  const cors = buildCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 204, headers: cors });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method tidak diizinkan.' }, 405, cors);
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'Konfigurasi server tidak lengkap.' }, 500, cors);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return json({ error: 'Body harus berupa JSON.' }, 400, cors);
  }

  const {
    title, description, target_amount, campaign_wallet, creator_wallet,
    signed_message, signature,
  } = body;

  // --- Validasi input dasar ---------------------------------------------
  if (
    typeof title !== 'string' || typeof description !== 'string' ||
    typeof campaign_wallet !== 'string' || typeof creator_wallet !== 'string' ||
    typeof signed_message !== 'string' || typeof signature !== 'string'
  ) {
    return json({ error: 'Field wajib tidak lengkap.' }, 400, cors);
  }

  if (title.trim().length < 3 || title.trim().length > 80) {
    return json({ error: 'Judul harus antara 3 dan 80 karakter.' }, 400, cors);
  }
  if (description.trim().length < 10 || description.trim().length > 1000) {
    return json({ error: 'Deskripsi harus antara 10 dan 1000 karakter.' }, 400, cors);
  }
  const amount = Number(target_amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) {
    return json({ error: 'Target donasi harus antara 0 dan 100000 SOL.' }, 400, cors);
  }

  // --- Verifikasi kepemilikan wallet -------------------------------------
  // campaign_wallet harus identik dengan creator_wallet, dan pesan yang
  // ditandatangani harus di-sign oleh pemilik campaign_wallet tsb.
  if (campaign_wallet !== creator_wallet) {
    return json({
      error: 'Untuk saat ini, campaign_wallet harus sama dengan wallet yang menandatangani (creator).',
    }, 422, cors);
  }
  if (!BASE58_RE.test(campaign_wallet) || campaign_wallet.length < 32 || campaign_wallet.length > 44) {
    return json({ error: 'Format wallet tidak valid.' }, 400, cors);
  }

  // Verifikasi pesan: wallet yang disebut di dalam pesan harus cocok.
  const signedAddr = getSignerAddress(signed_message);
  if (signedAddr !== campaign_wallet) {
    return json({ error: 'Pesan yang ditandatangani tidak sesuai kampanye ini.' }, 422, cors);
  }

  // Verifikasi kebaruan (anti replay).
  const ts = getTimestamp(signed_message);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_MESSAGE_AGE_MS) {
    return json({ error: 'Tanda tangan kedaluwarsa. Silakan ulangi.' }, 422, cors);
  }

  // Verifikasi tanda tangan Ed25519 terhadap public key Solana.
  let pubkey: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    pubkey = base58ToBytes(campaign_wallet);
    sigBytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
  } catch {
    return json({ error: 'Gagal membaca public key / signature.' }, 400, cors);
  }
  if (pubkey.length !== 32 || sigBytes.length !== 64) {
    return json({ error: 'Public key atau signature berukuran tidak valid.' }, 400, cors);
  }
  const msgBytes = new TextEncoder().encode(signed_message);
  if (!ed25519.verify(sigBytes, msgBytes, pubkey)) {
    return json({ error: 'Tanda tangan tidak valid: bukan pemilik wallet.' }, 422, cors);
  }

  // --- Simpan dengan service role ----------------------------------------
  const { data, error: insertError } = await supabase
    .from('campaigns')
    .insert([{
      title: title.trim(),
      description: description.trim(),
      target_amount: amount,
      campaign_wallet,
      creator_wallet,
    }])
    .select()
    .single();

  if (insertError) {
    console.error('[insert campaign]', insertError.message);
    return json({ error: 'Gagal menyimpan campaign.' }, 500, cors);
  }

  return json({ ok: true, campaign: data }, 201, cors);
});
