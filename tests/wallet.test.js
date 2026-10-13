import { describe, it, expect, vi, beforeEach } from 'vitest';

const localStorageData = new Map();

const localStorageMock = {
  getItem: (key) => localStorageData.get(key) ?? null,
  setItem: (key, value) => localStorageData.set(key, String(value)),
  removeItem: (key) => localStorageData.delete(key),
  clear: () => localStorageData.clear(),
};

const canvasEl = document.createElement('canvas');
const ctxMock = {
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  setTransform: vi.fn(),
};

vi.stubGlobal('localStorage', localStorageMock);
canvasEl.getContext = vi.fn(() => ctxMock);

import {
  getProvider,
  getSavedWallet,
  clearWallet,
  connectAndSign,
  signTextMessage,
  saveSession,
  explorerUrl,
} from '../src/wallet.js';

describe('wallet', () => {
  beforeEach(() => {
    localStorageData.clear();
    window.solana = null;
  });

  describe('getProvider', () => {
    it('returns null when Phantom is missing', () => {
      expect(getProvider()).toBeNull();
    });

    it('returns solana when isPhantom is true', () => {
      window.solana = { isPhantom: true };
      expect(getProvider()).toBe(window.solana);
    });

    it('ignores non-Phantom providers', () => {
      window.solana = { isPhantom: false };
      expect(getProvider()).toBeNull();
    });
  });

  describe('localStorage wallet helpers', () => {
    it('reads saved wallet and clear removes it', () => {
      localStorageData.set('userWallet', 'addr');
      expect(getSavedWallet()).toBe('addr');
      clearWallet();
      expect(getSavedWallet()).toBeNull();
    });
  });

  describe('connectAndSign', () => {
    it('throws when Phantom is unavailable', async () => {
      await expect(connectAndSign()).rejects.toThrow('Phantom Wallet belum terinstal.');
    });

    it('connects, signs, and returns address WITHOUT saving the session', async () => {
      const address = 'FakePublicKey11111111111111111111111111111111';
      window.solana = {
        isPhantom: true,
        connect: vi.fn().mockResolvedValue({ publicKey: { toString: () => address } }),
        signMessage: vi.fn().mockResolvedValue({}),
      };

      const result = await connectAndSign();
      expect(result).toBe(address);
      expect(window.solana.connect).toHaveBeenCalledTimes(1);
      expect(window.solana.signMessage).toHaveBeenCalledTimes(1);

      // Guard regression P1-05: wallet TIDAK boleh tersimpan di sini. Kalau
      // connectAndSign() menulis localStorage, lalu upsertUser() di halaman
      // login gagal, user tetap punya sesi aktif padahal login belum tuntas.
      expect(getSavedWallet()).toBeNull();
    });

    it('rejects when the user rejects the signature', async () => {
      const address = 'FakePublicKey11111111111111111111111111111111';
      window.solana = {
        isPhantom: true,
        connect: vi.fn().mockResolvedValue({ publicKey: { toString: () => address } }),
        signMessage: vi.fn().mockRejectedValue(new Error('User rejected the request.')),
      };

      await expect(connectAndSign()).rejects.toThrow('User rejected the request.');
      expect(getSavedWallet()).toBeNull();
    });
  });

  describe('signTextMessage', () => {
    it('throws a clear error when no wallet extension is present', async () => {
      await expect(signTextMessage('halo')).rejects.toThrow(/Dompet tidak ditemukan/);
    });

    it('connects on demand when the wallet is installed but locked', async () => {
      // Skenario nyata: user buka #/profile langsung dari localStorage,
      // Phantom terpasang tapi belum connect sehingga publicKey masih null.
      const address = 'LockedButInstalled11111111111111111111111';
      window.solana = {
        isPhantom: true,
        publicKey: null,
        connect: vi.fn().mockImplementation(() => {
          window.solana.publicKey = { toString: () => address };
          return Promise.resolve({ publicKey: window.solana.publicKey });
        }),
        signMessage: vi.fn().mockResolvedValue({
          signature: new Uint8Array([1, 2, 3, 4]),
        }),
      };

      const out = await signTextMessage('pesan uji');
      expect(out.message).toBe('pesan uji');
      expect(out.signature).toBe(Buffer.from([1, 2, 3, 4]).toString('base64'));
      expect(window.solana.connect).toHaveBeenCalledTimes(1);
    });

    it('reports a connection refusal as a readable error', async () => {
      window.solana = {
        isPhantom: true,
        publicKey: null,
        connect: vi.fn().mockRejectedValue(new Error('User rejected the request.')),
        signMessage: vi.fn(),
      };
      await expect(signTextMessage('pesan')).rejects.toThrow(/Tidak bisa terhubung ke dompet/);
    });

    it('does not ask for a signature when the connection fails', async () => {
      window.solana = {
        isPhantom: true,
        publicKey: null,
        connect: vi.fn().mockRejectedValue(new Error('nope')),
        signMessage: vi.fn(),
      };
      await expect(signTextMessage('pesan')).rejects.toThrow();
      expect(window.solana.signMessage).not.toHaveBeenCalled();
    });
  });

  describe('saveSession', () => {
    it('persists the wallet only when the caller decides login succeeded', () => {
      saveSession('AddrSession');
      expect(getSavedWallet()).toBe('AddrSession');
    });

    it('clearWallet removes it again', () => {
      saveSession('AddrSession');
      clearWallet();
      expect(getSavedWallet()).toBeNull();
    });
  });

  describe('explorerUrl', () => {
    it('returns explorer link for valid signature', () => {
      const url = explorerUrl('abc123');
      expect(url).toBe('https://explorer.solana.com/tx/abc123?cluster=devnet');
    });

    it('returns # for invalid signature', () => {
      expect(explorerUrl('')).toBe('#');
      expect(explorerUrl('!!!')).toBe('#');
    });
  });
});