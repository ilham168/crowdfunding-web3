import { describe, it, expect, vi, beforeEach } from 'vitest';

const invokeMock = vi.fn();

vi.mock('../src/supabaseClient.js', () => ({
  callEdgeFunction: (...args) => invokeMock(...args),
}));

import { isAdminWallet, clearAdminCache } from '../src/adminAccess.js';

describe('isAdminWallet', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    clearAdminCache();
  });

  it('returns false immediately for an empty wallet', async () => {
    expect(await isAdminWallet(null)).toBe(false);
    expect(await isAdminWallet('')).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('returns true only when the server says so', async () => {
    invokeMock.mockResolvedValue({ is_admin: true });
    expect(await isAdminWallet('WalletA')).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith('check-admin', { wallet_address: 'WalletA' });
  });

  it('treats a missing/undefined field as NOT admin', async () => {
    // Menolak default adalah pilihan aman: UI panel admin tidak boleh
    // terbuka hanya karena server membalas tanpa field.
    invokeMock.mockResolvedValue({});
    expect(await isAdminWallet('WalletB')).toBe(false);
  });

  it('caches per wallet so the check is not repeated on every navigation', async () => {
    invokeMock.mockResolvedValue({ is_admin: true });
    await isAdminWallet('WalletC');
    await isAdminWallet('WalletC');
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it('does not reuse one wallet answer for a different wallet', async () => {
    invokeMock.mockResolvedValueOnce({ is_admin: true }).mockResolvedValueOnce({ is_admin: false });
    expect(await isAdminWallet('WalletD')).toBe(true);
    expect(await isAdminWallet('WalletE')).toBe(false);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to false when the request fails', async () => {
    invokeMock.mockRejectedValue(new Error('ERR_NAME_NOT_RESOLVED'));
    expect(await isAdminWallet('WalletF')).toBe(false);
  });
});