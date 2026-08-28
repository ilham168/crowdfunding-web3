// =========================================================
// Live donation feed via Supabase Realtime (postgres_changes).
//
// Membungkus subscription ke tabel `donations` agar reusable:
//   - halaman detail campaign memakai filter `campaign_id=eq.<id>`
//   - halaman transparency (buku kas) tanpa filter (global)
//
// Mencegah kebocoran channel: hanya 1 channel donations aktif per waktu.
// Memanggil ulang subscribeDonations() otomatis meng-unsubscribe channel
// sebelumnya. Ditambah MutationObserver yang melepas channel begitu node
// penanda halaman terlepas dari DOM (rute berganti — router SPA ini
// mengganti innerHTML tanpa lifecycle hook resmi).
// =========================================================

import { supabase } from './supabaseClient.js';

let active = null; // { channel, observer, marker }

/**
 * Subscribe ke INSERT baru di tabel `donations`.
 *
 * @param {object} opts
 * @param {(rec: object) => void} opts.onEvent   dipanggil dengan baris donasi baru (`payload.new`)
 * @param {string}  [opts.filter]                filter postgres_changes, mis. `campaign_id=eq.<id>`
 * @param {(status: string) => void} [opts.onStatus] status channel ('SUBSCRIBED', 'TIMED_OUT', ...)
 * @param {Element} [opts.marker]                elemen penanda halaman; jika terlepas dari DOM,
 *                                               channel di-cleanup otomatis (rute berganti).
 * @returns {{ channel: import('@supabase/supabase-js').RealtimeChannel, unsubscribe: () => void }}
 */
export function subscribeDonations({ onEvent, filter, onStatus, marker }) {
  dispose();

  const topic = `donations-feed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const channel = supabase
    .channel(topic)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'donations', filter },
      (payload) => onEvent?.(payload.new)
    )
    .subscribe((status) => onStatus?.(status));

  active = { channel, observer: null, marker: marker ?? null };

  // Auto-cleanup bila halaman diganti (node penanda terlepas dari DOM).
  if (marker && typeof MutationObserver !== 'undefined' && marker.isConnected) {
    const rootEl = marker.closest('#app') || marker.parentElement || marker;
    const observer = new MutationObserver(() => {
      if (active && active.marker === marker && !marker.isConnected) {
        dispose();
      }
    });
    observer.observe(rootEl, { childList: true, subtree: true });
    active.observer = observer;
  }

  return {
    channel,
    unsubscribe() {
      if (active && active.channel === channel) dispose();
    },
  };
}

/** Bersihkan channel donations yang sedang aktif (jika ada). */
export function dispose() {
  if (!active) return;
  const { channel, observer } = active;
  active = null;
  if (observer) observer.disconnect();
  if (channel) {
    try {
      supabase.removeChannel(channel);
    } catch {
      /* abaikan: channel mungkin sudah tertutup */
    }
  }
}

/**
 * Pembantu dedupe (race condition): pastikan baris yang sama (berdasarkan id
 * atau tx_signature) hanya muncul sekali di DOM. Pakai jalur awal (initial
 * fetch) lalu setiap event realtime dicek ke sini sebelum di-prepend.
 * @param {Set<string>} [set]  set id yang sudah dikenal (default Set baru)
 */
export function createDedupe(set = new Set()) {
  return {
    known: set,
    isNew(rec) {
      const key = rec?.id ?? rec?.tx_signature;
      if (key == null || set.has(key)) return false;
      set.add(key);
      return true;
    },
  };
}
