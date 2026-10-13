// =========================================================
// supabase/functions/_shared/cors.ts
//
// Helper CORS bersama untuk SEMUA Edge Function proyek ini.
//
// Aturan yang dijaga keras di sini:
//   1. TIDAK ada wildcard "*". Header `Access-Control-Allow-Origin` hanya
//      di-reflect kalau `Origin` persis ada di daftar yang diizinkan.
//   2. Origin yang TIDAK cocok tidak menerima ACAO sama sekali — browser
//      akan memblokir respons sendiri (strict allowlist).
//   3. Preflight OPTIONS dikembalikan 204 TANPA body. Membawa body pada
//      response 204 MENGGUNAKAN Deno dan membuat runtime membalas
//      "Internal Server Error" (ini akar bug "Failed to fetch" di
//      create-campaign / verify-donation sebelumnya).
//   4. Semua jalur respons (200/4xx/5xx/preflight) memakai `json()` di sini
//      sehingga header CORS SELALU terpasang.
//
// Default jalur dev: http://localhost:5173 + http://127.0.0.1:5173 (port
// Vite bawaan). Kalau Vite pindah port, jangan edit di sini — daftarkan di
// secret ALLOWED_ORIGINS (koma-pisah) untuk project supabase, atau pin port
// Vite ke salah satu di atas. Default TIDAK longgar (mis. "localhost port
// apa saja") supaya tidak membuka kebocoran di produksi.
// =========================================================

const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const ALLOWED_HEADERS = [
  'authorization',
  'x-client-info',
  'apikey',
  'content-type',
  'x-admin-wallet',
];

export type CorsHeaders = Record<string, string>;

export function getAllowedOrigins(): string[] {
  const raw = Deno.env.get('ALLOWED_ORIGINS');
  if (raw && raw.trim()) {
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return DEFAULT_ALLOWED_ORIGINS;
}

/**
 * Header CORS. ACAO hanya di-set kalau `origin` ada di allowlist; untuk
 * origin yang tidak cocok (atau null) ACAO dihilangkan agar browser
 * memblokir sendiri.
 */
export function corsHeaders(origin: string | null): CorsHeaders {
  const headers: CorsHeaders = {
    'Access-Control-Allow-Headers': ALLOWED_HEADERS.join(', '),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
    'X-Content-Type-Options': 'nosniff',
  };
  if (origin && getAllowedOrigins().includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

/** Respons JSON dengan header CORS; dipakai di SEMUA jalur (error pun). */
export function json(
  body: unknown,
  status: number,
  origin: string | null,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

/**
 * Preflight OPTIONS. 204 TANPA body — kombinasi 204 + body membuat Deno
 * melempar dan runtime membalas 500 tanpa CORS (lihat header file ini).
 */
export function handlePreflight(origin: string | null): Response {
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}