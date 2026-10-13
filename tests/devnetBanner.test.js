import { describe, it, expect, beforeEach } from 'vitest';
import { mountDevnetBanner, networkLabel } from '../src/components/devnetBanner.js';

describe('networkLabel', () => {
  it('maps known clusters to readable labels', () => {
    expect(networkLabel('devnet')).toBe('Devnet');
    expect(networkLabel('testnet')).toBe('Testnet');
    expect(networkLabel('mainnet-beta')).toBe('Mainnet');
  });

  it('falls back to "Devnet" for unknown values (safe default)', () => {
    expect(networkLabel('weird')).toBe('Devnet');
    expect(networkLabel(undefined)).toBe('Devnet');
  });
});

describe('mountDevnetBanner', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders an always-visible banner with faucet link and Phantom hint', () => {
    const el = mountDevnetBanner('devnet');
    expect(el).not.toBeNull();
    expect(el.textContent).toMatch(/Demo di Solana Devnet/);
    expect(el.textContent).toMatch(/Tidak memakai uang asli/);
    expect(el.textContent).toMatch(/Phantom/);

    const link = el.querySelector('a');
    expect(link.getAttribute('href')).toBe('https://faucet.solana.com/');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('does not render on mainnet', () => {
    expect(mountDevnetBanner('mainnet-beta')).toBeNull();
    expect(document.getElementById('devnet-banner')).toBeNull();
  });

  it('is idempotent (never renders twice)', () => {
    expect(mountDevnetBanner('devnet')).not.toBeNull();
    expect(mountDevnetBanner('devnet')).toBeNull();
    expect(document.querySelectorAll('#devnet-banner').length).toBe(1);
  });
});
