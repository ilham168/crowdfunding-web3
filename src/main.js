// Impor fungsi client dari Supabase
import { createClient } from '@supabase/supabase-js';

// TODO: Ganti dengan URL dan ANON KEY dari dasbor Supabase kamu
const supabaseUrl = 'https://XYZ.supabase.co';
const supabaseKey = 'ey...';
const supabase = createClient(supabaseUrl, supabaseKey);

let userWalletAddress = null;

// Fungsi utama untuk Koneksi + Tanda Tangan
async function connectAndLogin() {
  if (window.solana && window.solana.isPhantom) {
    try {
      // 1. Hubungkan Dompet
      const response = await window.solana.connect();
      userWalletAddress = response.publicKey.toString();
      
      // 2. Siapkan Pesan untuk Ditandatangani
      // Pesan ini yang akan muncul di pop-up Phantom pengguna
      const pesanLogin = `Selamat datang di Platform Donasi Web3!\n\nKlik "Sign" atau "Setujui" untuk memverifikasi bahwa kamu adalah pemilik dompet ini.\n\nWallet: ${userWalletAddress}`;
      
      // Phantom mewajibkan pesan diubah menjadi format byte (Uint8Array)
      const pesanEncoded = new TextEncoder().encode(pesanLogin);

      // 3. Minta Tanda Tangan (Sign Message)
      console.log("Meminta pengguna menandatangani pesan...");
      const { signature } = await window.solana.signMessage(pesanEncoded, "utf8");
      
      // Jika kode melewati baris di atas, artinya pengguna mengklik "Approve"
      console.log("Tanda tangan divalidasi!");

      // 4. Lanjutkan proses ke Supabase
      await prosesLoginSupabase(userWalletAddress);

    } catch (error) {
      console.error("Proses login dibatalkan atau gagal:", error);
      alert("Gagal masuk. Pastikan kamu menyetujui permintaan di Phantom.");
    }
  } else {
    alert("Phantom Wallet belum terinstal!");
    window.open("https://phantom.app/", "_blank");
  }
}

// Fungsi untuk mengecek dan menyimpan dompet ke Database
async function prosesLoginSupabase(walletAddress) {
  try {
    // Cek apakah alamat dompet ini sudah ada di tabel 'users'
    const { data: userLama, error: errorCek } = await supabase
        .from('users')
        .select('*')
        .eq('wallet_address', walletAddress)
        .single();

    if (userLama) {
        console.log("User lama terdeteksi. Berhasil login!");
    } else {
        // Jika belum ada, masukkan sebagai akun baru
        const { data: userBaru, error: errorInsert } = await supabase
            .from('users')
            .insert([{ wallet_address: walletAddress }])
            .select();
            
        if (errorInsert) throw errorInsert;
        console.log("Akun baru berhasil didaftarkan ke Supabase!");
    }

    // 5. Simpan sesi di peramban dan perbarui UI
    localStorage.setItem('userWallet', walletAddress);
    perbaruiUI(walletAddress);
    
  } catch (error) {
    console.error("Kesalahan Supabase:", error);
    alert("Terjadi kesalahan saat menghubungi database.");
  }
}

// Fungsi pembantu untuk mengubah tampilan web setelah login
function perbaruiUI(wallet) {
  const btnLogin = document.getElementById('btn-login');
  const walletStatus = document.getElementById('wallet-status');
  
  btnLogin.innerText = "Berhasil Login";
  btnLogin.disabled = true; 
  walletStatus.innerText = `Sesi Aktif: ${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
}

// Pasang fungsi ke tombol
document.getElementById('btn-login').addEventListener('click', connectAndLogin);

// 6. Cek apakah pengguna sudah login sebelumnya saat halaman dimuat (refresh)
window.onload = () => {
  const savedWallet = localStorage.getItem('userWallet');
  if (savedWallet) {
    userWalletAddress = savedWallet;
    perbaruiUI(savedWallet);
  }
}