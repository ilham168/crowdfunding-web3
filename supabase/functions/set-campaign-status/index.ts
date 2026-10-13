// =========================================================
// Supabase Edge Function: set-campaign-status
//
// Satu-satunya jalur untuk mengubah `campaigns.status`.
//
// Dua jalur yang DIVERIFIKASI SERVER, tidak ada UPDATE policy publik:
//
//   1. CREATOR  — menutup campaign miliknya sendiri.
//      Klien menandatangani "New Status" untuk campaign tertentu.
//      Signature Ed25519 diverifikasi terhadap creator_wallet.
//      Admin TIDAK bisa memakai jalur ini untuk menutup campaign orang lain.
//
//   2. ADMIN    — membuka / menutup / menandai campaign milik orang lain.
//      Header x-admin-wallet diperiksa terhadap tabel `admin_wallets`
//      (whitelist) memakai service role, bukan RLS publik.
//      TIDAK perlu signature: otorisasi admin sudah tercermin di whitelist.
//
// Yang SENGAJA tidak bisa diubah di sini: campaign_wallet, title,
// creator_wallet. Data itu menentukan ke mana dana dikirim; lewat request
// HTTP, mengubahnya = mengarahkan dana orang ke dompet lain.
// `campaign_wallet` sengaja TIDAK menerima nilai dari klien: bentuk baris
// selalu creator_wallet === campaign_wallet (lihat create-campaign), jadi
// admin tidak bisa mengubahnya sama sekali lewat jalur HTTP.
//
// Deploy:
//   supabase functions deploy set-campaign-status --no-verify-jwt
// =========================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import { ed25519 } from 'npm:@noble/curves@1/ed25519.js';
import { handlePreflight, json } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

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

function field(message: string, label: string): string | null {
  const re = new RegExp(`^${label}: (.*)$`, 'm');
  const m = message.match(re);
  return m ? m[1].trim() : null;
}

function assertFresh(message: string): void {
  const ts = field(message, 'Timestamp');
  if (!ts) throw new Error('Pesan tidak memiliki Timestamp.');
  const when = Date.parse(ts);
  if (Number.isNaN(when)) throw new Error('Timestamp tidak valid.');
  if (Math.abs(Date.now() - when) > MAX_MESSAGE_AGE_MS) {
    throw new Error('Pesan sudah kedaluwarsa. Muat ulang halaman lalu coba lagi.');
  }
}

// Public key Solana dikirim sebagai base58, tapi signature dari Phantom dikirim
// sebagai base64 (lihat bufferToBase64() di src/wallet.js dan pola yang sama
// di create-campaign). Campur keduanya akan menolak signature yang sah.
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
  const pk = base58ToBytes(wallet);
  const sig = base64ToBytes(signature);
  if (pk.length !== 32 || sig.length !== 64) throw new Error('Panjang kunci/signature tidak valid.');
  if (!ed25519.verify(sig, new TextEncoder().encode(message), pk)) {
    throw new Error('Signature tidak valid untuk wallet ini.');
  }
}

async function isAdmin(wallet: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('admin_wallets')
    .select('wallet_address')
    .eq('wallet_address', wallet)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const ALLOWED = new Set(['active', 'closed', 'flagged']);

interface Payload {
  campaign_id: string;
  wallet_address: string;
  new_status: string;
  flag_reason?: string | null;
  signed_message?: string;
  signature?: string;
  admin_wallet?: string;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return handlePreflight(origin);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);

  try {
    const p = (await req.json()) as Payload;
    const { campaign_id, wallet_address, new_status } = p;

    if (!campaign_id || !wallet_address || !new_status) {
      return json({ error: 'campaign_id, wallet_address, dan new_status wajib diisi.' }, 400, origin);
    }
    if (!ALLOWED.has(new_status)) {
      return json({ error: `Status tidak dikenal: ${new_status}` }, 400, origin);
    }
    const flagReason = (p.flag_reason ?? '').trim() || null;
    if (flagReason && /[\r\n]/.test(flagReason)) {
      // Format pesan bertanda tangan memakai "Label: nilai" per baris, jadi nilai
      // bertingkat baris baru tidak akan cocok saat signature diverifikasi.
      return json({ error: 'flag_reason harus satu baris (tanpa newline).' }, 400, origin);
    }
    if (new_status === 'flagged' && !flagReason) {
      return json({ error: 'Menandai flagged wajib menyertakan flag_reason.' }, 400, origin);
    }

    // Muat campaign dengan service role supaya campaign yang di-RLS-kan pun
    // bisa diperiksa (policy SELECT campaigns tetap publik, tapi jangan
    // bergantung pada itu).
    const { data: campaign, error: cErr } = await supabaseAdmin
      .from('campaigns')
      .select('id, creator_wallet, status, flag_reason')
      .eq('id', campaign_id)
      .maybeSingle();

    if (cErr) throw cErr;
    if (!campaign) return json({ error: 'Campaign tidak ditemukan.' }, 404, origin);

    const isCreator = campaign.creator_wallet === wallet_address;

    // WAJIB signature untuk SIAPAPUN, termasuk admin. Sebelumnya jalur admin
    // hanya mengecek `admin_wallet` yang dikirim client — siapa pun bisa menulis
    // alamat wallet admin yang diketahui dan langsung mendapat hak moderasi.
    // Whitelist hanya berarti "wallet ini memang admin", BUKAN "pemohon ini
    // pemilik wallet tersebut"; kepemilikan dibuktikan oleh signature.
    if (!p.signed_message || !p.signature) {
      return json(
        { error: 'signed_message dan signature wajib diisi (creator maupun admin).' },
        400,
        origin,
      );
    }
    assertFresh(p.signed_message);

    const signedWallet = field(p.signed_message, 'Wallet');
    const signedCampaign = field(p.signed_message, 'Campaign');
    const signedStatus = field(p.signed_message, 'New Status');
    if (signedWallet !== wallet_address) throw new Error('Wallet pada pesan tidak cocok.');
    if (signedCampaign !== campaign_id) throw new Error('Campaign pada pesan tidak cocok.');
    if (signedStatus !== new_status) throw new Error('Status pada pesan tidak cocok.');

    // Alasan laporan ikut ditandatangani supaya signature tidak bisa dipakai
    // ulang dengan flag_reason yang berbeda.
    const signedReason = field(p.signed_message, 'Flag Reason') || null;
    if (signedReason !== flagReason) throw new Error('Alasan pada pesan tidak cocok.');

    verifySignature(wallet_address, p.signed_message, p.signature);

    const claimAdmin = Boolean(p.admin_wallet) && p.admin_wallet === wallet_address;
    const adminOk = claimAdmin ? await isAdmin(wallet_address) : false;

    if (adminOk) {
      // Jalur admin. Kolom yang boleh disentuh HANYA status + flag_reason;
      // update tidak pernah menyebut campaign_wallet/title/creator_wallet.
      const { error } = await supabaseAdmin
        .from('campaigns')
        .update({ status: new_status, flag_reason: flagReason })
        .eq('id', campaign_id);
      if (error) throw error;
      return json({ ok: true, via: 'admin', status: new_status }, 200, origin);
    }

    if (!isCreator) {
      return json(
        { error: 'Hanya creator campaign ini atau admin yang boleh mengubah statusnya.' },
        403,
        origin,
      );
    }

    // Jalur creator: hanya boleh menutup campaign sendiri.
    if (new_status !== 'closed') {
      return json(
        { error: 'Creator hanya boleh menutup campaignnya sendiri (status: closed).' },
        403,
        origin,
      );
    }

    // Tutup: set flag_reason NULL karena ini keputusan creator, bukan laporan.
    const { error } = await supabaseAdmin
      .from('campaigns')
      .update({ status: 'closed', flag_reason: null })
      .eq('id', campaign_id);
    if (error) throw error;
    return json({ ok: true, via: 'creator', status: 'closed' }, 200, origin);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal mengubah status.';
    const status = /signature|tidak cocok|tidak valid|kedaluwarsa/i.test(message) ? 403 : 400;
    return json({ error: message }, status, origin);
  }
});