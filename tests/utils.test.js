import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  escapeHtml,
  shortAddress,
  formatDate,
  statusMeta,
  donationBlockedMessage,
  progressPercent,
  safeStorageUrl,
  CAMPAIGN_STATUSES,
} from '../src/utils.js';

describe('utils', () => {
  it('escapes special characters', () => {
    expect(escapeHtml('a&b<c>d"e\'f')).toBe('a&amp;b&lt;c&gt;d&quot;e&#39;f');
  });
  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });
  it('leaves safe text unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  it('shortens long addresses', () => {
    const addr = '0x'.padEnd(44, 'a');
    expect(shortAddress(addr)).toBe('0xaa...aaaa');
  });
  it('returns original short addresses', () => {
    expect(shortAddress('0x1234')).toBe('0x1234');
  });
  it('returns empty for empty input', () => {
    expect(shortAddress('')).toBe('');
  });

  it('formats date in id-ID locale', () => {
    const iso = '2024-01-02T03:04:05.000Z';
    const formatted = formatDate(iso);
    expect(formatted).toContain('2024');
    expect(formatted).toContain('Jan');
  });
});

describe('safeStorageUrl', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('accepts https URLs on the configured project Supabase host', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://abc.supabase.co');
    const url = 'https://abc.supabase.co/storage/v1/object/public/avatars/x.png';
    expect(safeStorageUrl(url)).toBe(url);
  });

  it('rejects a different host, including look-alike domains', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://abc.supabase.co');
    expect(safeStorageUrl('https://evil.example.com/x.png')).toBe('');
    expect(safeStorageUrl('https://abc.supabase.co.evil.com/x.png')).toBe('');
    expect(safeStorageUrl('//evil.example.com/x.png')).toBe('');
  });

  it('rejects non-https schemes and non-URL values', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://abc.supabase.co');
    expect(safeStorageUrl('http://abc.supabase.co/x.png')).toBe('');
    expect(safeStorageUrl('javascript:alert(1)')).toBe('');
    expect(safeStorageUrl('data:image/svg+xml,<svg/>')).toBe('');
    expect(safeStorageUrl('not a url')).toBe('');
    expect(safeStorageUrl('')).toBe('');
    expect(safeStorageUrl(null)).toBe('');
    expect(safeStorageUrl(undefined)).toBe('');
  });

  it('rejects everything when the project URL is not configured', () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    expect(safeStorageUrl('https://abc.supabase.co/x.png')).toBe('');
  });
});

describe('CAMPAIGN_STATUSES', () => {
  it('only advertises the three statuses the database can actually store', () => {
    expect(Object.keys(CAMPAIGN_STATUSES).sort()).toEqual(['active', 'closed', 'flagged']);
  });

  it('never lets a status accept donations unless it is explicitly active', () => {
    Object.keys(CAMPAIGN_STATUSES).forEach((s) => {
      expect(statusMeta(s).acceptsDonation).toBe(s === 'active');
    });
  });
});

describe('statusMeta', () => {
  it('gives each status a human label and a badge class', () => {
    expect(statusMeta('active')).toMatchObject({
      key: 'active',
      label: 'Aktif',
      badge: 'is-active',
      acceptsDonation: true,
    });
    expect(statusMeta('closed')).toMatchObject({ key: 'closed', acceptsDonation: false });
    expect(statusMeta('flagged')).toMatchObject({ key: 'flagged', acceptsDonation: false });
  });

  it('falls back to "unknown" for statuses the app does not know', () => {
    // Penting: status tak dikenal harus default MENOLAK donasi, bukan diam-diam
    // membuka form donasi seperti logika lama sebelum statusMeta() ada.
    const meta = statusMeta('pause');
    expect(meta.key).toBe('unknown');
    expect(meta.acceptsDonation).toBe(false);
    expect(meta.label).toBe('Status tidak dikenal');
  });

  it('treats missing status as unknown, not active', () => {
    expect(statusMeta(undefined).acceptsDonation).toBe(false);
    expect(statusMeta(null).acceptsDonation).toBe(false);
    expect(statusMeta('').acceptsDonation).toBe(false);
  });

  it('does not crash on hostile input', () => {
    expect(() => statusMeta('<script>alert(1)</script>').label).not.toThrow();
  });
});

describe('donationBlockedMessage', () => {
  it('explains a closed campaign', () => {
    expect(donationBlockedMessage('closed')).toMatch(/ditutup/i);
  });

  it('explains a flagged campaign and mentions moderation', () => {
    const msg = donationBlockedMessage('flagged');
    expect(msg).toMatch(/ditinjau|moderasi/i);
  });

  it('never claims "closed" for an unknown status', () => {
    // Bug class yang sama dengan sukses palsu: jangan menampilkan alasan yang
    // tidak benar hanya karena itu satu-satunya kalimat yang tersedia.
    expect(donationBlockedMessage('pause')).not.toMatch(/ditutup/i);
    expect(donationBlockedMessage(undefined)).not.toMatch(/ditutup/i);
  });
});

describe('progressPercent', () => {
  it('computes a normal percentage', () => {
    expect(progressPercent(5, 10)).toBe(50);
    expect(progressPercent(0, 10)).toBe(0);
  });

  it('caps at 100 instead of overflowing the bar', () => {
    expect(progressPercent(25, 10)).toBe(100);
  });

  it('returns 0 for a zero or invalid target instead of Infinity/NaN', () => {
    expect(progressPercent(5, 0)).toBe(0);
    expect(progressPercent(5, null)).toBe(0);
    expect(progressPercent(5, 'abc')).toBe(0);
  });

  it('never returns NaN for garbage input', () => {
    [progressPercent(undefined, undefined), progressPercent('x', 'y'), progressPercent(-3, 10)].forEach(
      (v) => expect(Number.isFinite(v)).toBe(true),
    );
  });
});
