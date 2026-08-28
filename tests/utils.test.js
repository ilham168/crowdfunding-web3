import { describe, it, expect } from 'vitest';
import { escapeHtml, shortAddress, formatDate } from '../src/utils.js';

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
