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

import { getProvider, getSavedWallet, clearWallet, connectAndSign, explorerUrl } from '../src/wallet.js';

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

    it('connects, signs, saves wallet and returns address', async () => {
      const address = 'FakePublicKey11111111111111111111111111111111';
      window.solana = {
        isPhantom: true,
        connect: vi.fn().mockResolvedValue({ publicKey: { toString: () => address } }),
        signMessage: vi.fn().mockResolvedValue({}),
      };

      const result = await connectAndSign();
      expect(result).toBe(address);
      expect(getSavedWallet()).toBe(address);
      expect(window.solana.connect).toHaveBeenCalledTimes(1);
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
