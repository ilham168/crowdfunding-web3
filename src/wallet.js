import {
  Connection,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  SystemProgram,
} from '@solana/web3.js';
import { clearAdminCache } from './adminAccess.js';

// Satu sumber konfigurasi jaringan untuk frontend: baca VITE_SOLANA_NETWORK
// (fallback devnet). WAJIB sama dengan secret SOLANA_NETWORK pada Edge Function,
// kalau tidak, verifikasi donasi di server akan memeriksa cluster yang berbeda.
export const NETWORK = import.meta.env.VITE_SOLANA_NETWORK || 'devnet';
export const connection = new Connection(clusterApiUrl(NETWORK), 'confirmed');

const WALLET_STORAGE_KEY = 'userWallet';

export function getProvider() {
  if (window.solana && window.solana.isPhantom) return window.solana;
  return null;
}

export function getSavedWallet() {
  return localStorage.getItem(WALLET_STORAGE_KEY);
}

function saveWallet(address) {
  localStorage.setItem(WALLET_STORAGE_KEY, address);
}

export function clearWallet() {
  localStorage.removeItem(WALLET_STORAGE_KEY);
}

/**
 * Tandai sesi sebagai selesai. WAJIB dipanggil SETELAH langkah login lain
 * (mis. penyimpanan baris user di server) benar-benar berhasil.
 *
 * Kenapa dipisah: kalau wallet langsung disimpan di dalam connectAndSign(),
 * lalu langkah berikutnya gagal, user tetap punya "sesi aktif" di localStorage
 * walau login-nya belum tuntas — refresh berikutnya langsung masuk dashboard.
 */
export function saveSession(address) {
  saveWallet(address);
}

/**
 * Hubungkan wallet + minta tanda tangan pesan untuk membuktikan
 * pengguna memang pemilik dompet tersebut (login tanpa password).
 *
 * TIDAK menyimpan sesi ke localStorage — pemanggil yang memutuskan, setelah
 * seluruh alur login sukses (lihat saveSession).
 */
export async function connectAndSign() {
  const provider = getProvider();
  if (!provider) {
    window.open('https://phantom.app/', '_blank');
    throw new Error('Phantom Wallet belum terinstal.');
  }

  const resp = await provider.connect();
  const address = resp.publicKey.toString();

  const message =
    `Selamat datang di Platform Donasi Web3!\n\n` +
    `Klik "Sign" untuk memverifikasi bahwa kamu adalah pemilik dompet ini.\n\n` +
    `Wallet: ${address}\nWaktu: ${new Date().toISOString()}`;

  const encoded = new TextEncoder().encode(message);
  await provider.signMessage(encoded, 'utf8');

  return address;
}

export function disconnectWallet() {
  const provider = getProvider();
  if (provider?.disconnect) provider.disconnect();
  clearWallet();
  // Sesi berakhir: jangan biarkan status admin lama (per-wallet) tersisa.
  clearAdminCache();
}

/**
 * Minta wallet menandatangani pesan teks bebas, kembalikan pesan + signature
 * (base64) untuk diverifikasi server-side. Dipakai untuk membuktikan
 * kepemilikan wallet (login, verifikasi kepemilikan campaign, dst).
 */
export async function signTextMessage(text) {
  const provider = await ensureConnected();
  const encoded = new TextEncoder().encode(text);
  const { signature } = await provider.signMessage(encoded, 'utf8');
  return { message: text, signature: bufferToBase64(signature) };
}

/**
 * Pastikan ada provider yang siap menandatangani.
 *
 * Kenapa tidak langsung throw "wallet belum terhubung": user bisa membuka
 * #/profile langsung dari localStorage tanpa lewat halaman login, dan dompetnya
 * bisa dalam keadaan terkunci sehingga `publicKey` masih null meski ekstensi
 * sudah terpasang. Memaksa connect() memberi satu dialog yang jelas —
 * jauh lebih baik daripada error yang membuat user mengira aplikasinya rusak.
 */
async function ensureConnected() {
  const provider = getProvider();
  if (!provider) {
    throw new Error(
      'Dompet tidak ditemukan. Pasang Phantom Wallet, atau muat ulang halaman ini.'
    );
  }
  if (provider.publicKey) return provider;

  try {
    const resp = await provider.connect();
    if (resp?.publicKey) provider.publicKey = resp.publicKey;
  } catch {
    throw new Error(
      'Tidak bisa terhubung ke dompet. Buka Phantom lalu izinkan koneksi ke situs ini.'
    );
  }
  if (!provider.publicKey) throw new Error('Dompet tidak mengembalikan public key.');
  return provider;
}

function bufferToBase64(buf) {
  let bin = '';
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/**
 * Kirim SOL langsung dari dompet donatur ke dompet campaign.
 * Non-custodial: dana tidak pernah mampir ke server kita.
 */
export async function sendDonation(campaignWalletAddress, amountSol) {
  // Sama seperti signTextMessage: wallet bisa terpasang tapi belum connect
  // setelah reload. ensureConnected() memberi satu dialog Phantom yang jelas.
  const provider = await ensureConnected();

  if (!amountSol || isNaN(amountSol) || amountSol <= 0) {
    throw new Error('Jumlah donasi harus lebih dari 0.');
  }

  if (!isValidSolanaAddress(campaignWalletAddress)) {
    throw new Error('Alamat dompet campaign tidak valid.');
  }

  const toPubkey = new PublicKey(campaignWalletAddress);
  const lamports = Math.round(amountSol * LAMPORTS_PER_SOL);

  const balance = await connection.getBalance(provider.publicKey);
  if (lamports > balance) {
    const balSOL = (balance / LAMPORTS_PER_SOL).toFixed(4);
    throw new Error(`Saldo tidak cukup. Saldo kamu: ${balSOL} SOL.`);
  }

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

  const tx = new Transaction({
    feePayer: provider.publicKey,
    blockhash,
    lastValidBlockHeight,
  }).add(
    SystemProgram.transfer({
      fromPubkey: provider.publicKey,
      toPubkey,
      lamports,
    })
  );

  const result = await provider.signAndSendTransaction(tx);
  const signature = result.signature ?? result;

  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
  return signature;
}

export function explorerUrl(signature) {
  if (!signature || !/^[A-Za-z0-9]+$/.test(signature)) return '#';
  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=${NETWORK}`;
}

export function isValidSolanaAddress(address) {
  try {
    const pubkey = new PublicKey(address);
    return PublicKey.isOnCurve(pubkey.toBuffer());
  } catch {
    return false;
  }
}

export async function getWalletBalance() {
  const provider = getProvider();
  if (!provider?.publicKey) return 0;
  const balance = await connection.getBalance(provider.publicKey);
  return balance;
}
