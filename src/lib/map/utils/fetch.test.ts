import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __cacheCounts,
  __clearFetchCache,
  cachedFetch,
  FETCH_CACHE_TTL_MS,
} from './fetch';

describe('cachedFetch', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __clearFetchCache();
    fetchSpy = vi.fn(
      async (_: RequestInfo | URL) =>
        new Response('hello', { status: 200, headers: { 'x-mark': '1' } }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    __clearFetchCache();
    vi.useRealTimers();
  });

  it('returns a Response for a basic GET', async () => {
    const res = await cachedFetch('https://example.com/a');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('serves the second call from cache without re-fetching', async () => {
    await cachedFetch('https://example.com/a');
    const second = await cachedFetch('https://example.com/a');
    expect(await second.text()).toBe('hello');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(__cacheCounts().cached).toBe(1);
  });

  it('coalesces concurrent identical requests into one network call', async () => {
    const [a, b, c] = await Promise.all([
      cachedFetch('https://example.com/b'),
      cachedFetch('https://example.com/b'),
      cachedFetch('https://example.com/b'),
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Each caller should have its own readable Response body.
    expect(await a.text()).toBe('hello');
    expect(await b.text()).toBe('hello');
    expect(await c.text()).toBe('hello');
  });

  it('different URLs are cached independently', async () => {
    await cachedFetch('https://example.com/x');
    await cachedFetch('https://example.com/y');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(__cacheCounts().cached).toBe(2);
  });

  it('skips cache for non-GET requests', async () => {
    await cachedFetch('https://example.com/p', { method: 'POST' });
    await cachedFetch('https://example.com/p', { method: 'POST' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(__cacheCounts().cached).toBe(0);
  });

  it('does not cache non-2xx responses', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('rate limited', { status: 429 }));
    await cachedFetch('https://example.com/z');
    expect(__cacheCounts().cached).toBe(0);
    // Second call still hits network.
    await cachedFetch('https://example.com/z');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('expires entries after TTL', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    await cachedFetch('https://example.com/t');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    vi.setSystemTime(FETCH_CACHE_TTL_MS + 1);
    await cachedFetch('https://example.com/t');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('preserves response body across multiple .text() reads from cache', async () => {
    await cachedFetch('https://example.com/m');
    const a = await cachedFetch('https://example.com/m');
    const b = await cachedFetch('https://example.com/m');
    expect(await a.text()).toBe('hello');
    expect(await b.text()).toBe('hello');
  });
});
