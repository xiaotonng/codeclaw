import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prepareMock = vi.fn();

vi.mock('../src/browser-profile.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/browser-profile.ts')>();
  return {
    ...actual,
    prepareManagedBrowserForAutomation: (...args: unknown[]) => prepareMock(...args),
  };
});

const supervisor = await import('../src/browser-supervisor.ts');

describe('browser-supervisor', () => {
  beforeEach(() => {
    supervisor._resetManagedBrowserSupervisor();
    prepareMock.mockReset();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('coalesces concurrent ensure() calls into a single prepare invocation', async () => {
    prepareMock.mockResolvedValue({
      profileDir: '/tmp/profile',
      closedPids: [],
      cdpEndpoint: 'http://127.0.0.1:39222',
      connectionMode: 'launch',
    });
    // Make the cached endpoint look healthy so subsequent ensure() calls within
    // the cache window do not even reach the prepare path.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ webSocketDebuggerUrl: 'ws://x' }), { status: 200 })));

    const [a, b, c] = await Promise.all([
      supervisor.ensureManagedBrowser(),
      supervisor.ensureManagedBrowser(),
      supervisor.ensureManagedBrowser(),
    ]);

    expect(prepareMock).toHaveBeenCalledTimes(1);
    expect(a.cdpEndpoint).toBe('http://127.0.0.1:39222');
    expect(b.cdpEndpoint).toBe('http://127.0.0.1:39222');
    expect(c.cdpEndpoint).toBe('http://127.0.0.1:39222');
  });

  it('reuses the cached endpoint across calls instead of relaunching Chrome', async () => {
    prepareMock.mockResolvedValue({
      profileDir: '/tmp/profile',
      closedPids: [],
      cdpEndpoint: 'http://127.0.0.1:39222',
      connectionMode: 'launch',
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ webSocketDebuggerUrl: 'ws://x' }), { status: 200 })));

    await supervisor.ensureManagedBrowser();
    await supervisor.ensureManagedBrowser();
    await supervisor.ensureManagedBrowser();

    expect(prepareMock).toHaveBeenCalledTimes(1);
  });

  it('re-prepares after invalidate() drops the cache', async () => {
    prepareMock.mockResolvedValue({
      profileDir: '/tmp/profile',
      closedPids: [],
      cdpEndpoint: 'http://127.0.0.1:39222',
      connectionMode: 'attach',
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ webSocketDebuggerUrl: 'ws://x' }), { status: 200 })));

    await supervisor.ensureManagedBrowser();
    expect(prepareMock).toHaveBeenCalledTimes(1);

    supervisor.invalidateManagedBrowser();
    await supervisor.ensureManagedBrowser();
    expect(prepareMock).toHaveBeenCalledTimes(2);
  });

  it('probe() does not trigger Chrome launch when nothing is cached', async () => {
    const snapshot = await supervisor.probeManagedBrowser();

    expect(prepareMock).not.toHaveBeenCalled();
    expect(snapshot).toEqual({ cdpEndpoint: null, connectionMode: 'unavailable' });
  });

  it('probe() returns the cached endpoint after a successful ensure()', async () => {
    prepareMock.mockResolvedValue({
      profileDir: '/tmp/profile',
      closedPids: [],
      cdpEndpoint: 'http://127.0.0.1:39222',
      connectionMode: 'attach',
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ webSocketDebuggerUrl: 'ws://x' }), { status: 200 })));

    await supervisor.ensureManagedBrowser();
    const probe = await supervisor.probeManagedBrowser();

    expect(probe.cdpEndpoint).toBe('http://127.0.0.1:39222');
    // Probe alone should not invoke prepare again.
    expect(prepareMock).toHaveBeenCalledTimes(1);
  });
});
