// =========================================================
// Supabase Edge Function: verify-donation
//
// Menggantikan insert langsung ke tabel `donations` dari sisi
// klien. Fungsi ini memverifikasi transaksi Solana on-chain
// SEBELUM menyimpan baris donasi, sehingga tidak ada yang bisa
// memasukkan donasi palsu (tanpa benar-benar mengirim SOL).
//
// Deploy:
//   supabase functions deploy verify-donation --no-verify-jwt
//
// Secrets (supabase secrets set ...):
//   SOLANA_NETWORK=devnet            (nama cluster, samakan dengan src/wallet.js)
//   ALLOWED_ORIGINS=https://domain-produksi,koma-pisah-origin-lain
//     Default bila tidak di-set: http://localhost:5173 (dev vite).
// =========================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  Connection,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type Cluster,
  type SignaturePubkeyPair,
} from 'npm:@solana/web3.js@1';

const NETWORK = Deno.env.get('SOLANA_NETWORK') || 'devnet';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const connection = new Connection(clusterApiUrl(NETWORK as Cluster), 'confirmed');

// Batas aman donasi dalam SOL. Di atas itu hampir pasti typo/penyalahgunaan.
const MAX_DONATION_SOL = 100000;
// Toleransi selisih lamports antara jumlah yang diklaim vs. yang terkirim.
// Klien & server sama-sama memakai Math.round(amount * LAMPORTS_PER_SOL),
// jadi transaksi asli pasti cocok persis; toleransi ini hanya jaring
// pengaman terhadap perubahan pembulatan di masa depan (1e-6 SOL).
const AMOUNT_TOLERANCE_LAMPORTS = 1000;

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

// Bentuk minimal hasil getTransaction yang kita butuhkan. Di-cast defensif
// karena tipe RPC dari @solana/web3.js cukup berubah-ubah antar versi.
interface TxWithMeta {
  transaction: {
    signatures: Array<{ publicKey?: PublicKey }>;
    serialize(opts?: { requireAllSignatures?: boolean }): Uint8Array;
  };
  meta: {
    err: unknown;
    preBalances: number[];
    postBalances: number[];
  } | null;
}

type CorsHeaders = Record<string, string>;

function getAllowedOrigins(): string[] {
  const raw = Deno.env.get('ALLOWED_ORIGINS');
  if (raw && raw.trim()) {
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return DEFAULT_ALLOWED_ORIGINS;
}

function buildCorsHeaders(origin: string | null): CorsHeaders {
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

function json(body: unknown, status = 200, cors: CorsHeaders): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function isValidSolanaAddress(address: string): boolean {
  try {
    const pubkey = new PublicKey(address);
    return PublicKey.isOnCurve(pubkey.toBuffer());
  } catch {
    return false;
  }
}

function signerPubkeys(tx: TxWithMeta['transaction']): string[] {
  if (!tx.signatures || tx.signatures.length === 0) {
    return [];
  }
  return tx.signatures
    .filter((s) => s.publicKey)
    .map((s) => s.publicKey!.toString());
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
    return json(
      { error: 'Konfigurasi server tidak lengkap (Supabase env kosong).' },
      500,
      cors
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return json({ error: 'Body harus berupa JSON.' }, 400, cors);
  }

  const { campaign_id, donor_wallet, amount_sol, tx_signature } = body;

  // --- Validasi input dasar -------------------------------------------
  if (
    typeof campaign_id !== 'string' || typeof donor_wallet !== 'string' ||
    typeof tx_signature !== 'string'
  ) {
    return json({ error: 'campaign_id, donor_wallet, dan tx_signature wajib diisi.' }, 400, cors);
  }
  if (!UUID_RE.test(campaign_id.toLowerCase())) {
    return json({ error: 'campaign_id bukan UUID yang valid.' }, 400, cors);
  }
  if (!isValidSolanaAddress(donor_wallet)) {
    return json({ error: 'Alamat wallet donatur tidak valid.' }, 400, cors);
  }
  const amount = Number(amount_sol);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_DONATION_SOL) {
    return json({
      error: `Jumlah donasi harus antara 0 dan ${MAX_DONATION_SOL} SOL.`,
    }, 400, cors);
  }
  if (
    tx_signature.length < 86 ||
    tx_signature.length > 88 ||
    !BASE58_RE.test(tx_signature)
  ) {
    return json({ error: 'Signature transaksi bukan base58 yang valid.' }, 400, cors);
  }

  // --- Ambil campaign utk cek alamat penerima --------------------------
  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('id, campaign_wallet, title')
    .eq('id', campaign_id)
    .maybeSingle();

  if (campaignError) {
    console.error('[campaign lookup]', campaignError.message);
    return json({ error: 'Gagal mengambil data campaign.' }, 500, cors);
  }
  if (!campaign) {
    return json({ error: 'Campaign tidak ditemukan.' }, 404, cors);
  }

  const recipient = campaign.campaign_wallet as string;
  if (!isValidSolanaAddress(recipient)) {
    return json({ error: 'Alamat penerima campaign tidak valid.' }, 500, cors);
  }

  // --- Verifikasi transaksi di jaringan Solana -------------------------
  let tx: TxWithMeta | null;
  try {
    tx = await connection.getTransaction(tx_signature, {
      maxSupportedTransactionVersion: 0,
    }) as unknown as TxWithMeta | null;
  } catch (err) {
    console.error('[getTransaction]', err);
    return json({ error: 'Gagal memverifikasi transaksi ke jaringan Solana.' }, 502, cors);
  }

  if (!tx || !tx.meta || tx.meta.err) {
    return json({ error: 'Transaksi tidak ditemukan atau gagal di jaringan.' }, 422, cors);
  }
  if (!tx.transaction || !tx.transaction.signatures) {
    return json({ error: 'Transaksi tidak memiliki tanda tangan yang bisa diverifikasi.' }, 422, cors);
  }

  // Pastikan transaksi benar-benar dibuat oleh si donatur (fee payer).
  const signers = signerPubkeys(tx.transaction);
  if (!signers.includes(donor_wallet)) {
    return json({ error: 'Transaksi tidak ditandatangani oleh dompet donatur.' }, 422, cors);
  }

  // Decode ulang pesan transaksi untuk membaca daftar account keys.
  let decoded: Transaction;
  try {
    decoded = Transaction.from(
      tx.transaction.serialize({ requireAllSignatures: false })
    );
  } catch {
    return json({ error: 'Transaksi tidak bisa di-decode (format tidak didukung).' }, 422, cors);
  }

  const wantLamports = Math.round(amount * LAMPORTS_PER_SOL);

  // --- Analisis pre/post balances --------------------------------------
  const pre = tx.meta.preBalances || [];
  const post = tx.meta.postBalances || [];
  const accountKeys = decoded.compileMessage().getAccountKeys();
  const keyObjects = accountKeys.keySegments().flat();
  const keyIndex = new Map(keyObjects.map((pk, i) => [pk.toString(), i]));

  let matched = false;

  for (const ix of decoded.instructions) {
    if (!(ix instanceof TransactionInstruction)) continue;
    if (!ix.programId.equals(SystemProgram.programId)) {
      continue;
    }

    const fromMeta = ix.keys[0];
    const toMeta = ix.keys[1];
    if (!fromMeta || !toMeta) continue;

    const fromIdx = keyIndex.get(fromMeta.pubkey.toString());
    const toIdx = keyIndex.get(toMeta.pubkey.toString());
    if (fromIdx == null || toIdx == null) continue;

    const fromAddr = keyObjects[fromIdx].toString();
    const toAddr = keyObjects[toIdx].toString();

    // Transfer harus persis dari donatur ke alamat penerima campaign.
    if (fromAddr !== donor_wallet || toAddr !== recipient) continue;

    const preFrom = pre[fromIdx];
    const postFrom = post[fromIdx];
    const preTo = toIdx < pre.length ? pre[toIdx] : null;
    const postTo = toIdx < post.length ? post[toIdx] : null;

    const fromDelta = preFrom - postFrom;
    const toDelta = (postTo ?? 0) - (preTo ?? 0);

    if (
      Math.abs(toDelta - wantLamports) <= AMOUNT_TOLERANCE_LAMPORTS &&
      fromDelta >= wantLamports
    ) {
      matched = true;
      break;
    }
  }

  if (!matched) {
    return json({
      error:
        `Transaksi ditemukan, tapi tidak cocok dengan donasi ${amount} SOL ` +
        `ke alamat penerima campaign.`,
    }, 422, cors);
  }

  // --- Verifikasi lolos: simpan donasi dengan service role -------------
  const { data, error: insertError } = await supabase
    .from('donations')
    .insert([{
      campaign_id,
      donor_wallet,
      amount_sol: amount,
      tx_signature,
    }])
    .select()
    .single();

  if (insertError) {
    if (insertError.code === '23505') {
      return json({ error: 'Transaksi donasi ini sudah pernah dicatat.' }, 409, cors);
    }
    console.error('[insert donation]', insertError.message);
    return json({ error: 'Gagal menyimpan donasi.' }, 500, cors);
  }

  return json({
    ok: true,
    donation: data,
    verified: true,
    explorer: `https://explorer.solana.com/tx/${tx_signature}?cluster=${NETWORK}`,
  }, 201, cors);
});