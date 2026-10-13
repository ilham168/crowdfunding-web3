/**
 * Mesin status → aksi moderasi panel admin. Dipisahkan dari `admin.js`
 * supaya bisa diuji sebagai unit murni (tanpa DOM / modul browser).
 *
 * Spec moderasi (satu-satunya sumber kebenaran):
 *   active  -> hanya "Tandai Ditinjau" (key: flagged)
 *   flagged -> "Aktifkan lagi" (key: active) + "Tutup" (key: closed)
 *   closed  -> TIDAK ADA aksi admin
 * Status tak dikenal -> tanpa aksi (fallback konservatif menuju []).
 */
export const ADMIN_ACTION_LABELS = {
  active: [{ key: 'flagged', label: 'Tandai Ditinjau' }],
  flagged: [
    { key: 'active', label: 'Aktifkan lagi' },
    { key: 'closed', label: 'Tutup' },
  ],
};

export function adminActionsFor(status) {
  return ADMIN_ACTION_LABELS[status] ?? [];
}