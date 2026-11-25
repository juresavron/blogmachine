import express from 'express';
import type { ContentStore } from './storage.js';
import { createApplication } from './application.js';

export interface NetlifyStorage extends ContentStore {
  acquireWriteLock(): Promise<null | (() => Promise<void>)>;
}

export function validNetlifyUser(user: { id: string; expiresAt: Date } | undefined, now = Date.now()): boolean {
  return Boolean(user?.id && user.expiresAt instanceof Date && user.expiresAt.getTime() > now);
}

/** Netlify's signed request context supplies identity; browser headers never do. */
export function createNetlifyApp(store: NetlifyStorage, isAuthenticated: () => boolean) {
  const app = express();
  let stopping = false;
  let active = 0;
  const drained: (() => void)[] = [];

  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (stopping) { res.status(503).json({ error: 'The workspace is restarting. Please try again.' }); return; }
    active++;
    let completed = false;
    let release: (() => Promise<void>) | undefined;
    const finish = async () => {
      if (completed) return;
      completed = true;
      try { await release?.(); }
      catch { console.error('Workspace storage lock could not be released.'); }
      finally { active--; if (active === 0) drained.splice(0).forEach(resolve => resolve()); }
    };
    const originalEnd = res.end;
    // A socket close can precede completion of a publishing operation. Keep the
    // database lock until the handler ends, even if its client disconnected.
    res.end = function (this: express.Response, ...args: Parameters<typeof res.end>) {
      const result = Reflect.apply(originalEnd, this, args);
      void finish();
      return result;
    } as typeof res.end;
    res.locals.setStorageLock = (unlock: () => Promise<void>) => { release = unlock; };
    next();
  });

  app.use('/api', (req, res, next) => {
    let authenticated = false;
    try { authenticated = isAuthenticated(); } catch { /* Missing platform context must fail closed. */ }
    if (!authenticated) {
      res.status(401).json({ error: 'Sign in through Netlify project access to open this workspace. The project must use Private visibility or team login protection.' });
      return;
    }
    next();
  });
  app.use('/api', async (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { next(); return; }
    try {
      const release = await store.acquireWriteLock();
      if (!release) { res.status(409).json({ error: 'Another workspace update is in progress. Please try again shortly.' }); return; }
      if (res.writableEnded) { await release(); return; }
      res.locals.setStorageLock(release);
      next();
    } catch {
      res.status(503).json({ error: 'Workspace storage is temporarily unavailable. Please try again.' });
    }
  });
  app.use(createApplication({ store }).app);

  let closing: Promise<void> | undefined;
  return {
    app,
    shutdown() {
      if (!closing) {
        stopping = true;
        closing = (async () => {
          if (active > 0) await new Promise<void>(resolve => drained.push(resolve));
          await store.close();
        })();
      }
      return closing;
    },
  };
}
