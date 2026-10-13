// =========================================================
// Supabase Edge Function: report-campaign
//
// Menerima laporan campaign dari pengguna biasa.
//
// INSERT ke `campaign_reports` SENGAJA tidak dibuka lewat RLS publik:
// policy INSERT berbasis `auth.uid()` selalu false untuk klien tanpa sesi,
// sedangkan policy `USING (true)` berarti siapa pun bisa mengarang laporan
// atas nama wallet lain. Semua INSERT karena itu lewat fungsi ini — dan fungsi
// ini mewajibkan signature `reporter_wallet`, jadi INSERT lewat fungsi pun tidak
// bisa mengarang laporan atas nama wallet orang lain.
//
// Yang dikembalikan hanya konfirmasi penerimaan. Daftar laporan TIDAK pernah
// dikembalikan ke pengirim. Pelapor hanya diberi tahu "laporan tercatat".
//
// Deploy:
//   supabase functions deploy report-campaign --no-verify-jwt
// =========================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import { ed25519 } from 'npm:@noble/curves@1/ed25519.js';
import { handlePreflight, json } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_MESSAGE_AGE_MS = 5 * 60 * 1000;
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

// Public key = base58, signature dari Phantom = base64 (lihat
// bufferToBase64() di src/wallet.js).
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

function verifySignature(wallet: string, message: string, signature: string): void {
  const pk = base58ToBytes(wallet);
  const sig = base64ToBytes(signature);
  if (pk.length !== 32 || sig.length !== 64) throw new Error('Panjang kunci/signature tidak valid.');
  if (!ed25519.verify(sig, new TextEncoder().encode(message), pk)) {
    throw new Error('Signature tidak valid untuk wallet ini.');
  }
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return handlePreflight(origin);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);

  try {
    const { campaign_id, reporter_wallet, reason, signed_message, signature } = (await req.json()) as {
      campaign_id?: string;
      reporter_wallet?: string;
      reason?: string;
      signed_message?: string;
      signature?: string;
    };

    if (!campaign_id || !reporter_wallet || !reason) {
      return json({ error: 'campaign_id, reporter_wallet, dan reason wajib diisi.' }, 400, origin);
    }
    if (!BASE58_RE.test(reporter_wallet)) {
      return json({ error: 'Format reporter_wallet tidak valid.' }, 400, origin);
    }
    const trimmed = reason.trim();
    // Batas yang sama persis dengan CHECK di database — dilindungi di kedua
    // sisi supaya data jelek tidak masuk walau migrasi belum dijalankan.
    if (trimmed.length < 10 || trimmed.length > 500) {
      return json({ error: 'Alasan laporan harus antara 10 dan 500 karakter.' }, 400, origin);
    }
    if (/[\r\n]/.test(trimmed)) {
      // Pesan bertanda tangan memakai "Label: nilai" per baris; alasan bertingkat
      // baris baru tidak akan cocok saat signature diverifikasi.
      return json({ error: 'Alasan laporan harus satu baris (tanpa newline).' }, 400, origin);
    }

    // Signature wajib: tanpa ini `reporter_wallet` hanyalah klaim, dan siapa pun
    // bisa mengirim laporan atas nama wallet orang lain. Batas satu laporan per
    // (campaign, pelapor) bukan bantuan: penyerang cukup mengganti wallet.
    if (!signed_message || !signature) {
      return json({ error: 'signed_message dan signature wajib diisi.' }, 400, origin);
    }
    const when = Date.parse(field(signed_message, 'Timestamp') ?? '');
    if (Number.isNaN(when)) throw new Error('Timestamp tidak valid.');
    if (Math.abs(Date.now() - when) > MAX_MESSAGE_AGE_MS) {
      throw new Error('Pesan sudah kedaluwarsa. Muat ulang halaman lalu coba lagi.');
    }
    if (field(signed_message, 'Wallet') !== reporter_wallet) {
      throw new Error('Wallet pada pesan tidak cocok.');
    }
    if (field(signed_message, 'Campaign') !== campaign_id) {
      throw new Error('Campaign pada pesan tidak cocok.');
    }
    if (field(signed_message, 'Reason') !== trimmed) {
      throw new Error('Alasan pada pesan tidak cocok.');
    }
    verifySignature(reporter_wallet, signed_message, signature);

    // Campaign harus benar-benar ada. Insert dengan FK yang gagal akan
    // menghasilkan error PostgREST yang membingungkan, jadi cek dulu.
    const { data: campaign, error: cErr } = await supabaseAdmin
      .from('campaigns')
      .select('id, creator_wallet')
      .eq('id', campaign_id)
      .maybeSingle();
    if (cErr) throw cErr;
    if (!campaign) return json({ error: 'Campaign tidak ditemukan.' }, 404, origin);

    // Laporan atas campaign milik sendiri ditolak: itu bukan moderasi, itu
    // cara menyalahgunakan sistem moderasi.
    if (campaign.creator_wallet === reporter_wallet) {
      return json({ error: 'Kamu tidak bisa melaporkan campaign milikmu sendiri.' }, 400, origin);
    }

    const { error } = await supabaseAdmin.from('campaign_reports').insert({
      campaign_id,
      reporter_wallet,
      reason: trimmed,
    });

    // 23505 = unique violation (sudah pernah melapor). Ini kondisi normal,
    // bukan kegagalan; pelapor perlu tahu laporannya sudah tercatat.
    if (error) {
      if (error.code === '23505') {
        return json({ ok: true, already_reported: true }, 200, origin);
      }
      throw error;
    }
    return json({ ok: true }, 201, origin);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal mengirim laporan.';
    const status = /signature|tidak cocok|kedaluwarsa|timestamp|tidak valid/i.test(message)
      ? 403
      : 500;
    return json({ error: message }, status, origin);
  }
});