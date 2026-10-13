// =========================================================
// Supabase Edge Function: check-admin
//
// Satu-satunya cara klien memeriksa apakah wallet-nya punya hak moderator.
//
// Tabel `admin_wallets` TIDAK punya policy SELECT untuk anon/authenticated —
// kalau terbaca publik, daftar admin jadi target serang. Fungsi ini memakai
// service role, memeriksa whitelist, lalu hanya mengembalikan boolean.
//
// Catatan: ini rate limiting, bukan otorisasi. Siapa pun yang bisa memanggil
// endpoint hanya memperoleh jawaban "ya/tidak" untuk wallet yang mereka sebut sendiri.
// Otorisasi sebenarnya tetap di server pada operasi yang sensitif
// (set-campaign-status), yang tidak mempercayai klaim admin dari klien.
//
// Deploy:
//   supabase functions deploy check-admin --no-verify-jwt
// =========================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import { handlePreflight, json } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return handlePreflight(origin);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);

  try {
    const { wallet_address } = (await req.json()) as { wallet_address?: string };
    if (!wallet_address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet_address)) {
      return json({ error: 'wallet_address tidak valid.' }, 400, origin);
    }

    const { data, error } = await supabaseAdmin
      .from('admin_wallets')
      .select('wallet_address')
      .eq('wallet_address', wallet_address)
      .maybeSingle();

    if (error) throw error;
    // Selalu kembalikan 200: "wallet ini bukan admin" bukan kondisi error.
    return json({ is_admin: Boolean(data) }, 200, origin);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal memeriksa status admin.';
    return json({ error: message }, 500, origin);
  }
});