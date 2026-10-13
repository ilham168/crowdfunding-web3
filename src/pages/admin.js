import { navigate } from '../router.js';
import { supabase, callEdgeFunction } from '../supabaseClient.js';
import { disconnectWallet, signTextMessage } from '../wallet.js';
import { renderNav, bindLogout } from '../components/nav.js';
import { escapeHtml, requireWallet, statusMeta, shortAddress } from '../utils.js';
import {
  mountAntigravity,
  showToast,
  skeletonCards,
  confirmDialog,
  setBusy,
} from '../components/ui.js';
import { isAdminWallet } from '../adminAccess.js';
import { adminActionsFor } from '../adminActions.js';

/**
 * Panel moderator.
 *
 * KHAS halaman ini: jangan pernah percaya route untuk keamanan.
 * `#/admin` bisa diketik siapa saja, jadi halaman ini:
 *   1. memanggil Edge Function check-admin SEBELUM merender apa pun;
 *   2. menampilkan "bukan moderator" yang jujur kalau gagal;
 *   3. tidak pernah membuat link admin untuk pengguna biasa.
 *
 * Verifikasi sesungguhnya tetap di server (set-campaign-status memeriksa
 * ulang whitelist dengan service role), jadi walau halaman ini dibypass,
 * operasi berbahaya tetap ditolak.
 */
export async function renderAdmin(root) {
  const wallet = requireWallet();
  if (!wallet) return;

  // Shell NETRAL dulu: belum ada judul "Panel Moderator", avatar, atau konten
  // admin apa pun sampai check-admin menyatakan wallet ini moderator — tanpa
  // flash of unauthorized content untuk pengguna yang mengetik #/admin.
  root.innerHTML = renderAdminShell(wallet, false);
  mountAntigravity(root);
  bindLogout(root, () => { disconnectWallet(); navigate('/login'); });

  // Helper selalu mengembalikan boolean dan tidak melempar error: kegagalan
  // jaringan berarti "bukan moderator", bukan crash halaman.
  const isAdmin = await isAdminWallet(wallet);
  if (!isAdmin) {
    renderDenied(root, wallet);
    return;
  }

  // Baru setelah terverifikasi: render navbar dengan link Moderasi + panel.
  root.innerHTML = renderAdminShell(wallet, true);
  bindLogout(root, () => { disconnectWallet(); navigate('/login'); });
  mountAntigravity(root);

  const note = root.querySelector('#admin-note');
  if (note) note.textContent = `Moderator: ${shortAddress(wallet)}`;
  await loadAdminBody(root.querySelector('#admin-body'));
}

function renderAdminShell(wallet, authorized) {
  return `
    ${renderNav('admin', wallet, null, authorized)}
    <section class="page">
      <h1>${authorized ? 'Panel Moderator' : 'Memeriksa akses…'}</h1>
      <p id="admin-note" class="muted" role="status">
        ${authorized ? 'Memuat data…' : 'Memeriksa hak moderator…'}
      </p>
      <div id="admin-body"></div>
    </section>
  `;
}

function renderDenied(root, wallet, message) {
  const note = root.querySelector('#admin-note');
  if (note) note.textContent = 'Akses ditolak.';
  const h1 = root.querySelector('h1');
  if (h1) h1.textContent = 'Akses ditolak.';
  const body = root.querySelector('#admin-body');
  if (body) {
    body.innerHTML = `
      <p class="empty-state">Halaman ini hanya untuk moderator.</p>
      ${
        message
          ? `<p class="inline-warning">${escapeHtml(message)}</p>`
          : ''
      }
      <p><a href="#/dashboard" class="back-link">&larr; Kembali ke dashboard</a></p>
    `;
  }
  // Spec admin: non-admin = "Akses ditolak" + redirect ke dashboard.
  // Guard: hanya redirect kalau user masih di #/admin (jangan melempar user
  // yang sudah pindah halaman sendiri).
  setTimeout(() => {
    if (((window.location.hash || '').replace(/^#/, '') || '/admin') === '/admin') {
      navigate('/dashboard');
    }
  }, 1200);
}

/**
 * State filter campaign di panel. Dipertahankan antar-refresh supaya setelah
 * aksi moderasi (yang memuat ulang dari server) tab yang dipilih tidak reset.
 */
let adminCampaignFilter = 'all';
let adminCampaignsCache = [];

/**
 * Ambil daftar laporan lewat Edge Function terproteksi.
 *
 * Tidak ada fallback ke query anon: kalau pemanggilan gagal, error-nya
 * ditampilkan apa adanya. Diam-diam menampilkan "0 laporan" membuat moderator
 * mengira tidak ada yang perlu ditinjau.
 */
async function fetchCampaignReports() {
  const wallet = requireWallet();
  if (!wallet) throw new Error('Wallet tidak ditemukan.');
  const { message, signature } = await signTextMessage(
    buildAdminProofMessage({ wallet }),
  );
  return callEdgeFunction('list-campaign-reports', {
    wallet_address: wallet,
    signed_message: message,
    signature,
  });
}

/**
 * Pesan pembuktian moderator. WAJIB identik dengan yang di-parse server
 * (label per baris) karena server mencocokkan isi pesan sebelum memverifikasi
 * signature.
 */
function buildAdminProofMessage({ wallet }) {
  return (
    'Akses Daftar Laporan — Platform Donasi Web3\n\n' +
    `Wallet: ${wallet}\n` +
    `Timestamp: ${new Date().toISOString()}`
  );
}

async function loadAdminBody(body) {
  if (!body) return;
  body.innerHTML = skeletonCards(2);

  // Laporan TIDAK boleh diambil dengan query anon: `campaign_reports` tidak
  // punya policy SELECT, jadi PostgREST membalas `[]` (bukan error) dan panel
  // akan menampilkan "Belum ada laporan" padahal isinya ada. Query itu
  // sengaja diganti pemanggilan Edge Function yang memverifikasi signature
  // moderator lebih dulu.
  const reportPromise = fetchCampaignReports().catch((err) => ({
    error: err instanceof Error ? err.message : 'Gagal memuat daftar laporan.',
  }));

  const [campRes, reportRes, donationRes, userCount] = await Promise.all([
    supabase
      .from('campaigns')
      .select('id, title, creator_wallet, status, flag_reason, created_at')
      .order('created_at', { ascending: false }),
    reportPromise,
    // Statistik donasi: angka transaksi + total SOL. Data ini publik
    // (transparansi), jadi perhitungan sisi klien aman — bukan data sensitif.
    supabase.from('donations').select('amount_sol'),
    supabase.from('users').select('id', { count: 'exact', head: true }),
  ]);

  body.innerHTML = '';

  // Statistik jujur: kalau query stat gagal, tampilkan peringatan — jangan
  // pernah menyajikan angka 0 sebagai "sukses".
  const statsErrorLines = [];
  if (donationRes.error) statsErrorLines.push(`donasi (${donationRes.error.message})`);
  if (userCount.error) statsErrorLines.push(`wallet (${userCount.error.message})`);

  const donations = donationRes.data || [];
  const totalTx = donations.length;
  const totalSol = donations.reduce((s, d) => s + Number(d.amount_sol || 0), 0);
  const walletCount = userCount.count;

  const reports = reportRes?.reports || [];
  const reportBlock = reportRes?.error
    ? `<p class="inline-warning">
         Daftar laporan gagal dimuat (${escapeHtml(reportRes.error)}). Periksa
         signature wallet kamu, lalu muat ulang.
       </p>`
    : reports.length
      ? reportsHtml(reports) +
        (reportRes.truncated
          ? `<p class="inline-warning">Menampilkan ${reports.length} laporan terbaru.</p>`
          : '')
      : `<p class="empty-state">Belum ada laporan.</p>`;

  if (campRes.error) {
    body.innerHTML = `<p class="error">Gagal memuat campaign: ${escapeHtml(campRes.error.message)}</p>`;
    return;
  }

  const flagged = (campRes.data || []).filter((c) => c.status === 'flagged');
  adminCampaignsCache = campRes.data || [];
  body.innerHTML = `
    <div class="admin-summary" aria-label="Statistik platform">
      <p><strong>${(campRes.data || []).length}</strong> campaign total</p>
      <p><strong>${flagged.length}</strong> sedang ditinjau</p>
      <p><strong>${totalTx}</strong> transaksi donasi</p>
      <p><strong>${totalSol.toFixed(4)}</strong> SOL total donasi</p>
      <p><strong>${Number.isFinite(walletCount) ? walletCount : '–'}</strong> wallet terdaftar</p>
    </div>
    ${
      statsErrorLines.length
        ? `<p class="inline-warning">Statistik sebagian gagal dimuat: ${escapeHtml(statsErrorLines.join(', '))}. Tabel di bawah tetap menampilkan data terbaru.</p>`
        : ''
    }
    <h2>Laporan Terbaru</h2>
    ${reportBlock}
    <h2 id="campaigns-heading">Semua Campaign</h2>
    <div id="campaigns-section">${campaignsAdminHtml(adminCampaignsCache, adminCampaignFilter)}</div>
  `;

  bindAdminActions(body);
  bindAdminFilterTabs(body);
}

function reportsHtml(reports) {
  return `
    <div class="table-panel">
      <table class="ledger-table" aria-label="Laporan campaign terbaru">
        <thead>
          <tr>
            <th scope="col">Campaign</th>
            <th scope="col">Pelapor</th>
            <th scope="col">Alasan</th>
            <th scope="col">Waktu</th>
          </tr>
        </thead>
        <tbody>
          ${reports
            .map(
              (r) => `
            <tr>
              <td data-label="Campaign"><code>${escapeHtml(String(r.campaign_id).slice(0, 8))}…</code></td>
              <td data-label="Pelapor"><code>${escapeHtml(shortAddress(r.reporter_wallet))}</code></td>
              <td data-label="Alasan">${escapeHtml(r.reason)}</td>
              <td data-label="Waktu">${escapeHtml(new Date(r.created_at).toLocaleString('id-ID'))}</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

/**
 * Tabel campaign untuk moderasi, difilter oleh tab.
 *
 * Aksi per status dijamin oleh `adminActionsFor()` (src/adminActions.js) —
 * test `tests/adminActions.test.js` menjaga mesin status ini supaya active
 * hanya punya "Tandai Ditinjau", flagged punya "Aktifkan lagi"+"Tutup", dan
 * closed tidak punya aksi sama sekali.
 */

const ADMIN_FILTER_TABS = [
  { filter: 'all', label: 'Semua' },
  { filter: 'active', label: 'Aktif' },
  { filter: 'flagged', label: 'Ditinjau' },
  { filter: 'closed', label: 'Ditutup' },
];

function adminFilterTabs(campaigns, activeFilter) {
  const count = (status) =>
    status === null
      ? campaigns.length
      : campaigns.filter((c) => c.status === status).length;
  return `
    <div class="tabs" role="tablist" aria-label="Filter campaign">
      ${ADMIN_FILTER_TABS.map((t) => {
        const active = t.filter === activeFilter;
        return `
          <button type="button" class="tab ${active ? 'is-active' : ''}" role="tab"
                  aria-selected="${active}" data-filter="${escapeHtml(t.filter)}">
            ${escapeHtml(t.label)} (${count(t.filter === 'all' ? null : t.filter)})
          </button>`;
      }).join('')}
    </div>
  `;
}

function campaignsAdminHtml(campaigns, activeFilter = 'all') {
  const filtered = activeFilter === 'all'
    ? campaigns
    : campaigns.filter((c) => c.status === activeFilter);

  if (filtered.length === 0) {
    return `
      ${adminFilterTabs(campaigns, activeFilter)}
      <p class="empty-state">Tidak ada campaign dengan status ini.</p>
    `;
  }

  return `
    ${adminFilterTabs(campaigns, activeFilter)}
    <div class="table-panel">
      <table class="ledger-table" aria-label="Daftar campaign untuk moderasi">
        <thead>
          <tr>
            <th scope="col">Judul</th>
            <th scope="col">Creator</th>
            <th scope="col">Status</th>
            <th scope="col">Aksi</th>
          </tr>
        </thead>
        <tbody>
          ${filtered
            .map((c) => {
              const meta = statusMeta(c.status);
              const actions = adminActionsFor(c.status);
              return `
              <tr data-campaign="${escapeHtml(c.id)}">
                <td data-label="Judul">
                  <a href="#/campaign/${escapeHtml(c.id)}">${escapeHtml(c.title)}</a>
                  ${
                    c.flag_reason
                      ? `<br /><small class="flag-reason">${escapeHtml(c.flag_reason)}</small>`
                      : ''
                  }
                </td>
                <td data-label="Creator"><code>${escapeHtml(shortAddress(c.creator_wallet))}</code></td>
                <td data-label="Status"><span class="status-badge status-badge--inline ${meta.badge}">${escapeHtml(meta.label)}</span></td>
                <td data-label="Aksi">
                  ${
                    actions.length
                      ? `<div class="card-actions">
                          ${actions
                            .map(
                              (a) =>
                                `<button type="button" class="btn-ghost" data-action="${escapeHtml(a.key)}">${escapeHtml(a.label)}</button>`
                            )
                            .join('')}
                        </div>`
                      : `<span class="muted">—</span>`
                  }
                </td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

/** Bind tab filter: filter sisi-klien dari cache (tanpa refetch server). */
function bindAdminFilterTabs(body) {
  body.querySelectorAll('button[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      adminCampaignFilter = btn.dataset.filter;
      const section = body.querySelector('#campaigns-section');
      // Tab yang sama diklik lagi → no-op (hindari re-render tak berguna).
      if (section) section.innerHTML = campaignsAdminHtml(adminCampaignsCache, adminCampaignFilter);
      bindAdminActions(body);
      bindAdminFilterTabs(body);
    });
  });
}

/**
 * Aksi moderasi.
 *
 * Setelah server mengubah status, baris di-refresh dari server — bukan
 * diasumsikan sukses dari response 200. Kalau barisnya masih status lama,
 * berarti perubahan tidak benar-benar tersimpan.
 */
function bindAdminActions(body) {
  body.querySelectorAll('tr[data-campaign]').forEach((row) => {
    const campaignId = row.dataset.campaign;
    row.querySelectorAll('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const next = btn.dataset.action;
        let flagReason = null;

        if (next === 'flagged') {
          const reason = window.prompt(
            'Alasan penandaan (10–500 karakter). Akan tampil di halaman campaign untuk semua pengunjung.',
            ''
          );
          if (reason === null) return;
          flagReason = reason.trim();
          if (flagReason.length < 10 || flagReason.length > 500) {
            showToast('Alasan harus antara 10 dan 500 karakter.', 'error');
            return;
          }
        } else {
          const meta = statusMeta(next);
          const confirmed = await confirmDialog({
            title: `Ubah status ke "${meta.label}"?`,
            message: `Campaign ini akan menjadi ${meta.label}. Donasi baru ${
              next === 'active' ? 'akan dibuka kembali' : 'akan diblokir'
            }. Riwayat donasi lama tidak dihapus.`,
            confirmText: 'Ya, ubah status',
            tone: 'danger',
          });
          if (!confirmed) return;
        }

        setBusy(btn, true, 'Menyimpan...');
        try {
          const wallet = requireWallet();
          if (!wallet) return;
          // Signature WAJIB: server memakai whitelist hanya untuk memastikan
          // wallet ini memang admin, sedangkan kepemilikan wallet
          // dibuktikan oleh tanda tangan. Tanpa ini, siapa pun yang tahu
          // alamat admin bisa moderasi dengan mengetik `admin_wallet`.
          const { message, signature } = await signTextMessage(
            buildStatusMessage({ wallet, campaignId, status: next, flagReason }),
          );
          const { error } = await supabase.functions.invoke('set-campaign-status', {
            body: {
              campaign_id: campaignId,
              wallet_address: wallet,
              admin_wallet: wallet,
              new_status: next,
              flag_reason: flagReason,
              signed_message: message,
              signature,
            },
          });
          if (error) throw error;
          showToast(`Status campaign diubah ke ${next}.`, 'success');
          await loadAdminBody(body);
        } catch (err) {
          console.error('[set-campaign-status]', err);
          showToast(readableAdminError(err), 'error');
          setBusy(btn, false);
        }
      });
    });
  });
}

/**
 * Pesan yang ditandatangani admin. WAJIB identik dengan yang di-parse server
 * (label per baris, nilai tanpa newline) karena server mencocokkan isi pesan
 * dengan payload sebelum memverifikasi signature.
 */
function buildStatusMessage({ wallet, campaignId, status, flagReason }) {
  const lines = [
    'Verifikasi Status Campaign — Platform Donasi Web3',
    '',
    `Wallet: ${wallet}`,
    `Campaign: ${campaignId}`,
    `New Status: ${status}`,
    `Flag Reason: ${flagReason ?? ''}`,
    `Timestamp: ${new Date().toISOString()}`,
  ];
  return lines.join('\n');
}

function readableAdminError(err) {
  const msg = err?.message || 'Gagal mengubah status campaign.';
  if (/does not exist|42P01|schema cache|PGRST/i.test(msg)) {
    return (
      'Server belum mendukung fitur ini. Jalankan migration terbaru ' +
      'lalu deploy ulang Edge Function set-campaign-status.'
    );
  }
  if (/row-level security|42501/i.test(msg)) {
    return 'Akses ditolak kebijakan RLS. Periksa status admin wallet ini.';
  }
  return msg;
}