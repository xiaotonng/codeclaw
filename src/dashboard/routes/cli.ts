/**
 * Dashboard API routes for CLI extension management.
 *
 *   GET  /api/extensions/cli/catalog           — merged recommended + detection
 *   POST /api/extensions/cli/refresh           — { id } re-detect one entry
 *   POST /api/extensions/cli/auth/start        — { id } start oauth-web flow
 *   GET  /api/extensions/cli/auth/stream       — SSE stream of a running session
 *   POST /api/extensions/cli/auth/cancel       — { sessionId } kill the child
 *   POST /api/extensions/cli/auth/token        — { id, values } token auth
 *   POST /api/extensions/cli/logout            — { id } sign out
 */

import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import {
  getCliCatalog, refreshCliStatus,
  startCliAuthSession, getAuthSession, cancelAuthSession,
  applyCliToken, logoutCli,
  type AuthSessionEvent,
} from '../../agent/index.js';

const app = new Hono();

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

app.get('/api/extensions/cli/catalog', async (c) => {
  try {
    const items = await getCliCatalog();
    return c.json({ ok: true, items });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || 'catalog failed', items: [] }, 500);
  }
});

app.post('/api/extensions/cli/refresh', async (c) => {
  try {
    const { id } = await c.req.json() as { id: string };
    if (!id?.trim()) return c.json({ ok: false, error: 'id is required' }, 400);
    const status = await refreshCliStatus(id.trim());
    if (!status) return c.json({ ok: false, error: `unknown cli: ${id}` }, 404);
    return c.json({ ok: true, status });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || 'refresh failed' }, 500);
  }
});

// ---------------------------------------------------------------------------
// OAuth-web auth flow
// ---------------------------------------------------------------------------

app.post('/api/extensions/cli/auth/start', async (c) => {
  try {
    const { id } = await c.req.json() as { id: string };
    if (!id?.trim()) return c.json({ ok: false, error: 'id is required' }, 400);
    const result = await startCliAuthSession(id.trim());
    if (!result.ok) return c.json(result, 400);
    return c.json({ ok: true, sessionId: result.sessionId });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || 'start failed' }, 500);
  }
});

app.get('/api/extensions/cli/auth/stream', (c) => {
  const sessionId = c.req.query('sessionId') || '';
  if (!sessionId) return c.json({ ok: false, error: 'sessionId is required' }, 400);

  const session = getAuthSession(sessionId);
  if (!session) return c.json({ ok: false, error: 'session not found' }, 404);

  c.header('Content-Type', 'text/event-stream; charset=utf-8');
  c.header('Cache-Control', 'no-cache, no-transform');
  c.header('Connection', 'keep-alive');
  c.header('X-Accel-Buffering', 'no');

  return stream(c, async (s) => {
    const format = (ev: AuthSessionEvent): string => `data: ${JSON.stringify(ev)}\n\n`;

    // Replay backlog so a late client still sees what has been printed.
    if (session.backlog.length) {
      for (const chunk of session.backlog) {
        await s.write(format({ type: 'output', chunk }));
      }
    }

    let closed = false;
    const onEvent = async (ev: AuthSessionEvent) => {
      if (closed) return;
      try {
        await s.write(format(ev));
        if (ev.type === 'done') {
          closed = true;
          await s.write('event: close\ndata: {}\n\n');
          await s.close();
        }
      } catch { closed = true; }
    };
    session.events.on('event', onEvent);

    if (session.done) {
      await onEvent({ type: 'done', ok: session.ok, exitCode: session.exitCode });
      return;
    }

    // Heartbeat every 15s so proxies don't close the stream on us.
    const heartbeat = setInterval(() => {
      if (closed) { clearInterval(heartbeat); return; }
      s.write(':ping\n\n').catch(() => { closed = true; });
    }, 15_000);

    s.onAbort(() => {
      closed = true;
      clearInterval(heartbeat);
      session.events.off('event', onEvent);
    });
  });
});

app.post('/api/extensions/cli/auth/cancel', async (c) => {
  try {
    const { sessionId } = await c.req.json() as { sessionId: string };
    if (!sessionId?.trim()) return c.json({ ok: false, error: 'sessionId is required' }, 400);
    const cancelled = cancelAuthSession(sessionId.trim());
    return c.json({ ok: true, cancelled });
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || 'cancel failed' }, 500);
  }
});

// ---------------------------------------------------------------------------
// Token auth
// ---------------------------------------------------------------------------

app.post('/api/extensions/cli/auth/token', async (c) => {
  try {
    const { id, values } = await c.req.json() as { id: string; values: Record<string, string> };
    if (!id?.trim()) return c.json({ ok: false, error: 'id is required' }, 400);
    if (!values || typeof values !== 'object') return c.json({ ok: false, error: 'values is required' }, 400);
    const result = await applyCliToken(id.trim(), values);
    return c.json(result);
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || 'token apply failed' }, 500);
  }
});

app.post('/api/extensions/cli/logout', async (c) => {
  try {
    const { id } = await c.req.json() as { id: string };
    if (!id?.trim()) return c.json({ ok: false, error: 'id is required' }, 400);
    const result = await logoutCli(id.trim());
    return c.json(result);
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message || 'logout failed' }, 500);
  }
});

export default app;
