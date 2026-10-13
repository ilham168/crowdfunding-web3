import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAntigravityParticles } from '../src/components/particles.js';

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

describe('particles', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.requestAnimationFrame = vi.fn((cb) => {
      return window.setTimeout(() => cb(performance.now()), 16);
    });
    window.cancelAnimationFrame = vi.fn((id) => window.clearTimeout(id));

    HTMLCanvasElement.prototype.getContext = vi.fn(() => ctxMock);
    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      width: 200,
      height: 200,
      top: 0,
      left: 0,
      right: 200,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
    window.open = vi.fn();
  });

  it('returns object with destroy()', () => {
    const container = document.createElement('div');
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);
    document.body.appendChild(container);

    const fx = createAntigravityParticles(canvas);
    expect(typeof fx.destroy).toBe('function');
  });

  it('stops requestAnimationFrame after destroy()', () => {
    const container = document.createElement('div');
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);
    document.body.appendChild(container);

    const fx = createAntigravityParticles(canvas);
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);

    fx.destroy();
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
  });
});
