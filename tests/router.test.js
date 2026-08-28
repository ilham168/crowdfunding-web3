import { describe, it, expect, beforeEach } from 'vitest';
import { registerRoute, matchRoute } from '../src/router.js';

describe('router - matchRoute', () => {
  beforeEach(() => {
    window.location.hash = '#/';
  });

  it('returns null for no registered routes', () => {
    expect(matchRoute(window.location.hash)).toBeNull();
  });

  it('matches static path and returns render with empty params', () => {
    registerRoute('/dashboard', () => 'dashboard');
    const match = matchRoute('#/dashboard');
    expect(match).not.toBeNull();
    expect(match.render()).toBe('dashboard');
    expect(match.params).toEqual({});
  });

  it('matches parameterized path and decodes param', () => {
    registerRoute('/campaign/:id', ({ params }) => params.id);
    const match = matchRoute('#/campaign/abc-123');
    expect(match).not.toBeNull();
    expect(match.render({ params: match.params })).toBe('abc-123');
    expect(match.params).toEqual({ id: 'abc-123' });
  });

  it('returns null for unmatched path', () => {
    registerRoute('/dashboard', () => 'dashboard');
    expect(matchRoute('#/unknown')).toBeNull();
  });
});
