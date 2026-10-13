import { navigate } from '../router.js';
import { supabase, callEdgeFunction } from '../supabaseClient.js';
import { isAdminWallet } from '../adminAccess.js';
import { disconnectWallet, isValidSolanaAddress, signTextMessage } from '../wallet.js';
import { renderNav, bindLogout } from '../components/nav.js';
import { escapeHtml, requireWallet } from '../utils.js';
import { mountAntigravity, showToast, setBusy } from '../components/ui.js';

export async function renderCreateCampaign(root) {
  const wallet = requireWallet();
  if (!wallet) return;
  const isAdmin = await isAdminWallet(wallet);

  root.innerHTML = `
    ${renderNav('create', wallet, null, isAdmin)}
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

        <fieldset class="optional-block">
          <legend>
            <span class="optional-badge">Opsional</span>
            Bukti &amp; Lokasi
            <span class="optional-hint">Memperkuat kepercayaan donatur — semua optional, boleh dikosongkan.</span>
          </legend>

          <label>
            <span class="muted">Foto dokumentasi (maks. 5, masing-masing maks. 5MB)</span>
            <input id="doc-photos" type="file" accept="image/*" multiple />
          </label>
          <div id="photo-previews" class="photo-previews" aria-live="polite"></div>

          <label>
            <span class="muted">Titik lokasi (koordinat + label deskriptif)</span>
            <div class="location-controls">
              <input id="loc-lat" type="number" step="any" min="-90" max="90" placeholder="Latitude, contoh -6.9175" />
              <input id="loc-lng" type="number" step="any" min="-180" max="180" placeholder="Longitude, contoh 107.6191" />
            </div>
            <input id="loc-label" type="text" maxlength="120" placeholder="Label lokasi, contoh: Desa Sukamaju, Kec. Cianjur" />
            <button id="btn-use-location" type="button" class="btn-ghost">Gunakan Lokasi Saya</button>
            <p id="loc-status" class="muted" hidden></p>
          </label>
        </fieldset>

        <button type="submit" class="btn-primary btn-block">Publikasikan Campaign</button>
      </form>
    </section>
  `;

  mountAntigravity(root);
  bindLogout(root, () => {
    disconnectWallet();
    navigate('/login');
  });

  // --- State & logika foto dokumentasi (opsional) ------------------------
  const photoFiles = [];
  const photosInput = root.querySelector('#doc-photos');
  const previews = root.querySelector('#photo-previews');

  function renderPreviews() {
    previews.innerHTML = photoFiles.map((f, i) => `
      <figure class="photo-preview">
        <img src="${URL.createObjectURL(f)}" alt="Pratinjau foto ${i + 1}" />
        <button type="button" class="remove-photo" data-idx="${i}" aria-label="Hapus foto ${i + 1}">&times;</button>
      </figure>
    `).join('');
  }

  photosInput.addEventListener('change', () => {
    const files = Array.from(photosInput.files) || [];
    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        showToast(`${file.name} bukan file gambar.`, 'error');
        continue;
      }
      if (file.size > 5 * 1024 * 1024) {
        showToast(`${file.name} melebihi 5MB.`, 'error');
        continue;
      }
      if (photoFiles.length >= 5) {
        showToast('Maksimal 5 foto per campaign.', 'error');
        break;
      }
      photoFiles.push(file);
    }
    photosInput.value = '';
    renderPreviews();
  });

  previews.addEventListener('click', (e) => {
    const btn = e.target.closest('.remove-photo');
    if (!btn) return;
    photoFiles.splice(Number(btn.dataset.idx), 1);
    renderPreviews();
  });

  // --- "Gunakan Lokasi Saya" (navigator.geolocation, opsional) -----------
  const latInput = root.querySelector('#loc-lat');
  const lngInput = root.querySelector('#loc-lng');
  const locLabelInput = root.querySelector('#loc-label');
  const locStatus = root.querySelector('#loc-status');

  root.querySelector('#btn-use-location').addEventListener('click', () => {
    if (!navigator.geolocation) {
      locStatus.textContent = 'Browser tidak mendukung geolokasi. Silakan isi koordinat secara manual atau kosongkan.';
      locStatus.hidden = false;
      return;
    }
    locStatus.textContent = 'Meminta izin lokasi...';
    locStatus.hidden = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        latInput.value = pos.coords.latitude.toFixed(6);
        lngInput.value = pos.coords.longitude.toFixed(6);
        locStatus.textContent = 'Lokasi terisi.';
      },
      (err) => {
        let msg = 'Gagal mengambil lokasi. Silakan isi secara manual atau kosongkan.';
        if (err && err.code === 1) {
          msg = 'Anda menolak izin lokasi. Bisa isi koordinat manual atau kosongkan saja.';
        } else if (err && err.code === 2) {
          msg = 'Lokasi tidak tersedia. Isi manual atau kosongkan saja.';
        }
        locStatus.textContent = msg;
        locStatus.hidden = false;
      },
      { enableHighAccuracy: false, timeout: 10000 }
    );
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

    // Lokasi (opsional): kosongkan bila tidak valid → tidak memblokir submit.
    let location_lat = latInput.value.trim();
    let location_lng = lngInput.value.trim();
    const location_label = locLabelInput.value.trim();
    if (!location_lat || !location_lng) {
      location_lat = null;
      location_lng = null;
    } else {
      const latN = Number(location_lat);
      const lngN = Number(location_lng);
      if (isNaN(latN) || latN < -90 || latN > 90 || isNaN(lngN) || lngN < -180 || lngN > 180) {
        showToast('Koordinat lokasi tidak valid. Periksa latitude/longitude atau kosongkan.', 'error');
        return;
      }
      location_lat = latN;
      location_lng = lngN;
    }
    const label = location_label || null;

    setBusy(btn, true, 'Upload foto...');

    // Upload foto ke Storage dulu, lalu simpan URL-nya (opsional).
    let photo_urls = null;
    try {
      if (photoFiles.length) {
        const urls = [];
        for (const file of photoFiles) {
          const ext = (file.type.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
          const path = `campaign-photos/${wallet}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
          const { error: upErr } = await supabase.storage.from('campaign-photos').upload(path, file, { contentType: file.type });
          if (upErr) throw upErr;
          const { data: pub } = supabase.storage.from('campaign-photos').getPublicUrl(path);
          urls.push(pub.publicUrl);
        }
        photo_urls = urls;
      }
    } catch (err) {
      setBusy(btn, false);
      console.error('[upload foto campaign]', err);
      showToast(
        `Gagal mengunggah foto (${err.message || 'error tidak dikenal'}). Coba lagi atau hapus foto.`,
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
        photo_urls,
        location_lat,
        location_lng,
        location_label: label,
      });

      showToast('Campaign berhasil dipublikasikan.', 'success');
      navigate('/dashboard');
    } catch (err) {
      console.error('[create-campaign]', err);
      setBusy(btn, false);
      // Bedakan penyebab: penolakan server vs kegagalan koneksi/fetch. Kata
      // "Failed to fetch" dari browser tidak informatif bagi pengguna.
      if (err instanceof Error && /Failed to fetch|NetworkError|ERR_NETWORK|ECONNREFUSED/i.test(err.message)) {
        showToast(
          'Gagal terhubung ke server donasi. Periksa koneksi internet lalu coba lagi.',
          'error'
        );
        return;
      }
      showToast(err.message || 'Gagal membuat campaign.', 'error');
    }
  });
}
