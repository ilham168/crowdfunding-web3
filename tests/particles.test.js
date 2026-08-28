import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAntigravityParticles } from '../src/components/particles.js';

describe('particles', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.requestAnimationFrame = vi.fn((cb) => {
      return window.setTimeout(() => cb(performance.now()), 16);
    });
    window.cancelAnimationFrame = vi.fn((id) => window.clearTimeout(id));
  });

  it('returns object with destroy()', () => {
    document.body.innerHTML = '<div style="width:100px;height:100px"><canvas></canvas></div>';
    const canvas = document.querySelector('canvas');
    const fx = createAntigravityParticles(canvas);
    expect(typeof fx.destroy).toBe('function');
  });

  it('stops requestAnimationFrame after destroy()', () => {
    document.body.innerHTML = '<div style="width:100px;height:100px"><canvas></canvas></div>';
    const canvas = document.querySelector('canvas');
    const fx = createAntigravityParticles(canvas);

    fx.destroy();
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
  });
});
