import { createClient } from '@supabase/supabase-js';

const _supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const _supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!_supabaseUrl || !_supabaseKey) {
  console.warn(
    '[Supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY belum di-set. ' +
    'Salin .env.example menjadi .env dan isi dengan kredensial project Supabase kamu.'
  );
}

export const supabase = createClient(_supabaseUrl, _supabaseKey);

export const supabaseUrl = _supabaseUrl;
export const supabaseAnonKey = _supabaseKey;

/**
 * Panggil Supabase Edge Function. Dipakai untuk operasi yang butuh
 * verifikasi server-side (mis. verify-donation) sebelum data ditulis.
 */
export async function callEdgeFunction(functionName, payload) {
  const res = await fetch(`${_supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: _supabaseKey,
      Authorization: `Bearer ${_supabaseKey}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Edge function ${functionName} gagal (${res.status}).`);
  }
  return data;
}
