import { describe, it, expect } from 'vitest';
import { adminActionsFor, ADMIN_ACTION_LABELS } from '../src/adminActions.js';

/**
 * Guard mesin status → aksi panel admin. Kalau spec berubah, test ini
 * menolak agar UI tidak diam-diam memberi aksi yang salah (BUG 2 lama:
 * closed punya "Aktifkan", active punya "Tutup").
 */
describe('adminActionsFor (status → aksi moderasi)', () => {
  it('active hanya punya aksi "Tandai Ditinjau" (flagged)', () => {
    expect(adminActionsFor('active')).toEqual([
      { key: 'flagged', label: 'Tandai Ditinjau' },
    ]);
  });

  it('flagged punya "Aktifkan lagi" (active) dan "Tutup" (closed)', () => {
    expect(adminActionsFor('flagged')).toEqual([
      { key: 'active', label: 'Aktifkan lagi' },
      { key: 'closed', label: 'Tutup' },
    ]);
  });

  it('closed TIDAK punya aksi admin sama sekali', () => {
    expect(adminActionsFor('closed')).toEqual([]);
  });

  it('status tidak dikenal tidak punya aksi (fail-aman), bukan error', () => {
    expect(adminActionsFor('whatever')).toEqual([]);
    expect(adminActionsFor(undefined)).toEqual([]);
    expect(adminActionsFor(null)).toEqual([]);
  });

  it('semua aksi valid: target status dikenali dan tidak menunjuk status sendiri', () => {
    for (const [status, actions] of Object.entries(ADMIN_ACTION_LABELS)) {
      for (const action of actions) {
        expect(typeof action.key).toBe('string');
        expect(typeof action.label).toBe('string');
        expect(action.label.length).toBeGreaterThan(0);
        expect(action.key).not.toBe(status);
      }
    }
  });
});