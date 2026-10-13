import { NETWORK } from '../wallet.js';

const FAUCET_URL = 'https://faucet.solana.com/';

/** Label jaringan yang ramah pengguna. */
export function networkLabel(network = NETWORK) {
  if (network === 'mainnet-beta') return 'Mainnet';
  if (network === 'testnet') return 'Testnet';
  return 'Devnet';
}

/**
 * Banner pengingat bahwa ini demo devnet (tidak ada uang asli).
 *
 * Ditempel sebagai elemen PERTAMA di <body>, di luar #app, sehingga selalu
 * tampil di halaman login maupun setelah login tanpa perlu disentuh router.
 * Tidak dirender sama sekali kalau jaringan bukan devnet/testnet (mainnet),
 * supaya tidak menyesatkan saat nanti naik ke produksi.
 */
export function mountDevnetBanner(network = NETWORK) {
  if (network === 'mainnet-beta') return null;
  if (document.getElementById('devnet-banner')) return null;

  const el = document.createElement('div');
  el.id = 'devnet-banner';
  el.className = 'devnet-banner';
  el.setAttribute('role', 'note');

  const text = document.createElement('span');
  text.className = 'devnet-banner-text';
  text.textContent = `Demo di Solana ${networkLabel(network)}. Tidak memakai uang asli.`;

  const faucet = document.createElement('a');
  faucet.className = 'devnet-banner-link';
  faucet.href = FAUCET_URL;
  faucet.target = '_blank';
  faucet.rel = 'noopener noreferrer';
  faucet.textContent = 'Ambil SOL gratis →';

  const hint = document.createElement('span');
  hint.className = 'devnet-banner-hint';
  hint.textContent =
    'Di Phantom: Settings → Developer Settings → aktifkan Testnet Mode, lalu pilih Devnet.';

  el.append(text, faucet, hint);
  document.body.prepend(el);

  // Simpan tinggi banner agar .auth-screen bisa pas 100svh tanpa scroll kecil.
  const setHeight = () => {
    document.documentElement.style.setProperty('--devnet-banner-h', `${el.offsetHeight}px`);
  };
  setHeight();
  window.addEventListener('resize', setHeight);

  return el;
}
