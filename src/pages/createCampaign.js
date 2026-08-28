import { navigate } from '../router.js';
import { callEdgeFunction } from '../supabaseClient.js';
import { disconnectWallet, isValidSolanaAddress, signTextMessage } from '../wallet.js';
import { renderNav, bindLogout } from '../components/nav.js';
import { escapeHtml, requireWallet } from '../utils.js';
import { mountAntigravity, showToast, setBusy } from '../components/ui.js';

export async function renderCreateCampaign(root) {
  const wallet = requireWallet();
  if (!wallet) return;

  root.innerHTML = `
    ${renderNav('create', wallet)}
    <section class="page narrow">
      <a href="#/dashboard" class="back-link">&larr; Kembali</a>
      <h1>Buat Campaign Baru</h1>
      <p class="hint">
        Dana donasi akan dikirim <strong>langsung</strong> ke alamat dompetmu
        (non-custodial, tidak melalui server kami). Demi keamanan, alamat
        penerima harus <strong>sama dengan wallet yang kamu pakai untuk login</strong> —
        ini dibuktikan dengan tanda tangan digital (bukti kepemilikan) sebelum
        campaign dipublikasikan.
      </p>
      <form id="form-create" class="form-card">
        <label>Judul Campaign
          <input type="text" name="title" required maxlength="80" placeholder="Contoh: Bantuan Korban Banjir Yogyakarta" />
        </label>
        <label>Deskripsi
          <textarea name="description" rows="5" required maxlength="1000" placeholder="Jelaskan tujuan dan penggunaan dana..."></textarea>
        </label>
        <label>Target Donasi (SOL)
          <input type="number" name="target_amount" step="0.01" min="0.01" required placeholder="10" />
        </label>
        <label>Alamat Dompet Penerima Dana
          <input type="text" name="campaign_wallet" required value="${escapeHtml(wallet)}" />
        </label>
        <button type="submit" class="btn-primary btn-block">Publikasikan Campaign</button>
      </form>
    </section>
  `;

  mountAntigravity(root);
  bindLogout(root, () => {
    disconnectWallet();
    navigate('/login');
  });

  root.querySelector('#form-create').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const form = new FormData(e.target);

    const title = form.get('title').trim();
    const description = form.get('description').trim();
    const target_amount = Number(form.get('target_amount'));
    const campaign_wallet = form.get('campaign_wallet').trim();

    if (!title || title.length < 3) {
      showToast('Judul campaign minimal 3 karakter.', 'error');
      return;
    }
    if (title.length > 80) {
      showToast('Judul campaign maksimal 80 karakter.', 'error');
      return;
    }
    if (!description || description.length < 10) {
      showToast('Deskripsi minimal 10 karakter.', 'error');
      return;
    }
    if (description.length > 1000) {
      showToast('Deskripsi maksimal 1000 karakter.', 'error');
      return;
    }
    if (!target_amount || isNaN(target_amount) || target_amount <= 0) {
      showToast('Target donasi harus lebih dari 0 SOL.', 'error');
      return;
    }
    if (target_amount < 0.01) {
      showToast('Target donasi minimal 0.01 SOL.', 'error');
      return;
    }
    if (target_amount > 100000) {
      showToast('Target donasi terlalu besar (maks 100.000 SOL).', 'error');
      return;
    }
    if (!isValidSolanaAddress(campaign_wallet)) {
      showToast('Alamat dompet penerima tidak valid. Pastikan alamat Solana yang benar.', 'error');
      return;
    }
    // Verifikasi kepemilikan: dana hanya boleh masuk ke wallet yang benar-benar
    // ditandatangani oleh pemiliknya. Jadi campaign_wallet harus sama dengan
    // wallet yang terhubung (creator), supaya tidak bisa menunjuk wallet orang lain.
    if (campaign_wallet !== wallet) {
      showToast(
        'Alamat penerima dana harus sama dengan wallet yang kamu gunakan untuk login.',
        'error'
      );
      return;
    }

    setBusy(btn, true, 'Minta tanda tangan...');
    try {
      // Tanda tangani pesan yang mengikat wallet + judul + timestamp.
      const signed_message =
        `Verifikasi Kepemilikan Campaign — Platform Donasi Web3\n\n` +
        `Saya menyatakan membuat campaign di atas wallet milik saya:\n\n` +
        `Wallet: ${campaign_wallet}\n` +
        `Title: ${title}\n` +
        `Timestamp: ${new Date().toISOString()}`;

      const { signature } = await signTextMessage(signed_message);

      setBusy(btn, true, 'Memverifikasi & menyimpan...');
      await callEdgeFunction('create-campaign', {
        title,
        description,
        target_amount,
        campaign_wallet,
        creator_wallet: wallet,
        signed_message,
        signature,
      });

      showToast('Campaign berhasil dipublikasikan.', 'success');
      navigate('/dashboard');
    } catch (err) {
      showToast(err.message || 'Gagal membuat campaign.', 'error');
      setBusy(btn, false);
    }
  });
}
