import { navigate } from '../router.js';
import { connectAndSign, saveSession, clearWallet, getSavedWallet } from '../wallet.js';
import { supabase } from '../supabaseClient.js';
import { mountAntigravity, showToast, setBusy } from '../components/ui.js';

export async function renderLogin(root) {
  if (getSavedWallet()) {
    navigate('/dashboard');
    return;
  }

  root.innerHTML = `
    <section class="auth-screen">
      <div class="auth-card">
        <div class="brand brand-lg">Donasi<span>Web3</span></div>
        <h2>Donasi Transparan di jaringan Solana</h2>
        <p>
          Hubungkan dompet Solana kamu untuk mulai berdonasi atau membuat
          campaign penggalangan dana. Setiap donasi dikirim langsung
          dompet-ke-dompet dan tercatat di blockchain — siapa pun bisa
          memverifikasi arus kasnya.
        </p>
        <button id="btn-connect" class="btn-primary btn-block" type="button">
          Connect Wallet
        </button>
        <p class="hint">Perlu Phantom Wallet terpasang di browser kamu.</p>
      </div>
    </section>
  `;

  const screen = root.querySelector('.auth-screen');
  if (screen) mountAntigravity(screen, { fixed: false });

  const btn = root.querySelector('#btn-connect');

  btn.addEventListener('click', async () => {
    setBusy(btn, true, 'Menghubungkan...');
    let address;
    try {
      address = await connectAndSign();
      setBusy(btn, true, 'Menyimpan akun...');
      await upsertUser(address);
      // Sesi baru disimpan di sini — SETELAH baris user benar-benar ada di
      // server. Sebelumnya wallet langsung ditulis ke localStorage di dalam
      // connectAndSign(), sehingga kegagalan upsertUser masih menyisakan sesi
      // aktif: user melihat error, tapi refresh berikutnya langsung masuk
      // dashboard seolah login-nya tuntas.
      saveSession(address);
      showToast('Berhasil masuk!', 'success');
      navigate('/dashboard');
    } catch (err) {
      console.error('[login]', err);
      // Jaring pengaman: pastikan tidak ada sesi tersisa kalau langkah gagal.
      if (address) clearWallet();
      showToast(readableLoginError(err), 'error');
      setBusy(btn, false);
    }
  });
}

function readableLoginError(err) {
  const msg = err?.message || 'Gagal menghubungkan wallet.';
  if (/ERR_NAME_NOT_RESOLVED|Failed to fetch|fetch failed|NetworkError/i.test(msg)) {
    return (
      'Tidak bisa menghubungi server. Periksa koneksi internet dan pastikan ' +
      'VITE_SUPABASE_URL di .env menunjuk project Supabase yang benar.'
    );
  }
  if (/rejected|cancell?ed|denied|User refused/i.test(msg)) {
    return 'Permintaan ditolak di wallet. Coba lagi dan setujui permintaan tanda tangan.';
  }
  return msg;
}

async function upsertUser(walletAddress) {
  try {
    const { data: existing, error: selectErr } = await supabase
      .from('users')
      .select('id')
      .eq('wallet_address', walletAddress)
      .maybeSingle();

    if (selectErr) throw selectErr;

    if (!existing) {
      const { error: insertErr } = await supabase
        .from('users')
        .insert([{ wallet_address: walletAddress }]);
      if (insertErr) throw insertErr;
    }
  } catch (err) {
    console.error('[upsertUser]', err);
    throw new Error('Gagal menyimpan data user: ' + (err.message || ''));
  }
}
