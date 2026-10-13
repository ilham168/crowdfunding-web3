// CORS smoke test untuk 7 Edge Function. Jalankan SELEKITIF SAFE — hanya
// preflight OPTIONS + POST "berbentuk salah" (tidak menulis data apa pun).
//
//   node tests/e2e/cors-smoke.mjs
//
// Fungsi yang teruji (harus sudah ter-deploy ACTIVE):
//   create-campaign, verify-donation, check-admin, set-campaign-status,
//   update-profile, report-campaign, list-campaign-reports
//
// Ekspektasi setelah perbaikan BUG 1:
//   - OPTIONS + origin diizinkan -> 204, header ACAO = origin tersebut.
//   - OPTIONS + origin asing     -> TANPA ACAO (browser akan memblokir sendiri).
//   - POST + origin diizinkan    -> respons JSON apa pun (200/4xx/5xx) SELALU
//     membawa header ACAO (guard: tak ada jalur respons tanpa CORS).
const FUNCTIONS = [
  'create-campaign',
  'verify-donation',
  'check-admin',
  'set-campaign-status',
  'update-profile',
  'report-campaign',
  'list-campaign-reports',
];

const BASE = process.env.SUPABASE_URL || 'https://cnoymqsfnpwyjdwhqzfv.supabase.co';
const ALLOWED = 'http://localhost:5173';
const FOREIGN = 'http://evil.example';

async function req(fn, { method, headers, body }) {
  const res = await fetch(`${BASE}/functions/v1/${fn}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: res.status,
    acao: res.headers.get('access-control-allow-origin'),
    body: await res.text(),
  };
}

let failures = 0;
for (const fn of FUNCTIONS) {
  const label = `[${fn}]`;

  // 1) Preflight dari origin yang diizinkan.
  const pre = await req(fn, {
    method: 'OPTIONS',
    headers: { Origin: ALLOWED, 'Access-Control-Request-Method': 'POST' },
  });
  const preOk = pre.status >= 200 && pre.status < 300 && pre.acao === ALLOWED;
  if (!preOk) {
    failures++;
    console.log(`${label} PREFLIGHT GAGAL status=${pre.status} acao=${pre.acao}`);
  }

  // 2) Preflight dari origin asing → ACAO TIDAK boleh ada.
  const preForeign = await req(fn, {
    method: 'OPTIONS',
    headers: { Origin: FOREIGN, 'Access-Control-Request-Method': 'POST' },
  });
  const foreignOk = preForeign.acao === null;
  if (!foreignOk) {
    failures++;
    console.log(`${label} PREFLIGHT(asing) GAGAL acao=${preForeign.acao}`);
  }

  // 3) POST dari origin diizinkan dengan body KOSONG → respons apa pun harus
  //    memakai header CORS (guard jalur respons tanpa pengecualian).
  const post = await req(fn, {
    method: 'POST',
    headers: { Origin: ALLOWED, 'Content-Type': 'application/json' },
    body: {},
  });
  const postOk = post.acao === ALLOWED && post.body.length > 0;
  if (!postOk) {
    failures++;
    console.log(`${label} POST GAGAL status=${post.status} acao=${post.acao}`);
  }

  console.log(
    `${label} preflight=${pre.status}/${pre.acao ?? '-'} ` +
    `asing=${preForeign.acao ?? '(tanpa ACAO)'} post=${post.status}/${post.acao ?? '-'}`
  );
}

if (failures) {
  console.error(`\n${failures} kegagalan CORS smoke test.`);
  process.exit(1);
}
console.log('\nSemua 7 fungsi lolos CORS smoke test (204 + ACAO + POST ber-CORS).');