import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Post, Publication, Site } from './types.js';

export function createStore(path: string, seed = true) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS sites (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS publications (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, site_id TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(post_id, site_id));
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);

  function all<T>(table: 'sites' | 'posts' | 'publications'): T[] {
    return (db.prepare(`SELECT data FROM ${table} ORDER BY rowid`).all() as { data: string }[]).map(row => JSON.parse(row.data) as T);
  }
  function get<T>(table: 'sites' | 'posts' | 'publications', id: string): T | undefined {
    const row = db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) as T : undefined;
  }
  function put(table: 'sites' | 'posts', value: Site | Post) {
    db.prepare(`INSERT INTO ${table}(id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`).run(value.id, JSON.stringify(value));
  }
  function putPublication(value: Publication) {
    db.prepare('INSERT INTO publications(id, post_id, site_id, data) VALUES (?, ?, ?, ?) ON CONFLICT(post_id, site_id) DO UPDATE SET data = excluded.data').run(value.id, value.postId, value.siteId, JSON.stringify(value));
  }

  if (seed && !db.prepare("SELECT value FROM metadata WHERE key = 'seeded'").get()) {
    const now = new Date().toISOString();
    const ago = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();
    const sites: Site[] = [
      { id: 'site-journal', name: 'The Sunday Edit', url: 'https://thesundayedit.example', platform: 'demo', searchConsoleProperty: '', credentialKey: 'SUNDAY_EDIT', createdAt: ago(12) },
      { id: 'site-studio', name: 'Studio Notes', url: 'https://studionotes.example', platform: 'demo', searchConsoleProperty: '', credentialKey: 'STUDIO_NOTES', createdAt: ago(8) },
      { id: 'site-field', name: 'Fieldwork Journal', url: 'https://fieldwork.example', platform: 'demo', searchConsoleProperty: '', credentialKey: 'FIELDWORK', createdAt: ago(4) },
    ];
    const posts: Post[] = [
      { id: 'post-slow', title: 'The art of slowing down in a busy world', slug: 'the-art-of-slowing-down', excerpt: 'Small rituals that make room for the things that matter.', content: 'A little space goes a long way. Some of our best ideas arrive when we give them room. A quiet morning, an unhurried walk, or a notebook left open can change the rhythm of a day.\n\nStart small. Choose one daily ritual that helps you pay attention, and protect a few minutes for it.\n\nThere is no perfect routine. Notice what leaves you feeling clearer, and let that be your starting point.', status: 'published', siteIds: ['site-journal', 'site-studio'], createdAt: ago(5), updatedAt: ago(2) },
      { id: 'post-story', title: 'Why every brand needs a better story', slug: 'why-every-brand-needs-a-better-story', excerpt: 'Finding the thread that connects your work to your audience.', content: 'A useful brand story begins with the people you want to help. What do they care about? What would make their day easier?\n\nWrite down one specific example of how your work makes a difference. Build the story around that moment.', status: 'draft', siteIds: ['site-studio'], createdAt: ago(2), updatedAt: ago(1) },
      { id: 'post-ideas', title: 'A practical guide to collecting good ideas', slug: 'a-practical-guide-to-collecting-good-ideas', excerpt: 'Build a simple system for noticing, saving, and developing inspiration.', content: 'Good ideas rarely arrive fully formed. Keep a running list of questions, observations, and small things that catch your attention.\n\nOnce a week, revisit your collection and choose one idea to explore in more detail.', status: 'draft', siteIds: [], createdAt: ago(1), updatedAt: now },
    ];
    db.exec('BEGIN');
    try {
      sites.forEach(site => put('sites', site));
      posts.forEach(post => put('posts', post));
      for (const siteId of posts[0]!.siteIds) {
        const site = sites.find(site => site.id === siteId)!;
        putPublication({ id: `publication-${siteId}`, postId: posts[0]!.id, siteId, url: `${site.url}/${posts[0]!.slug}/`, status: 'published', mode: 'demo', error: null, publishedAt: ago(2), indexingStatus: 'not_inspected', lastInspectedAt: null });
      }
      db.prepare("INSERT INTO metadata(key, value) VALUES ('seeded', '1')").run();
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  return {
    db,
    sites: () => all<Site>('sites'),
    posts: () => all<Post>('posts'),
    publications: () => all<Publication>('publications'),
    site: (id: string) => get<Site>('sites', id),
    post: (id: string) => get<Post>('posts', id),
    publication: (id: string) => get<Publication>('publications', id),
    putSite: (site: Site) => put('sites', site),
    putPost: (post: Post) => put('posts', post),
    putPublication,
    changes: () => (db.prepare('SELECT data FROM repository_changes ORDER BY rowid DESC').all() as { data: string }[]).map(row => JSON.parse(row.data)),
    change: (id: string) => { const row = db.prepare('SELECT data FROM repository_changes WHERE id = ?').get(id) as { data: string } | undefined; return row ? JSON.parse(row.data) : undefined; },
    putChange: (value: { id: string }) => { db.prepare('INSERT INTO repository_changes(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run(value.id, JSON.stringify(value)); },
    initChanges: () => { db.exec('CREATE TABLE IF NOT EXISTS repository_changes (id TEXT PRIMARY KEY, data TEXT NOT NULL)'); },
    deletePost(id: string) {
      db.exec('BEGIN');
      try {
        db.prepare('DELETE FROM publications WHERE post_id = ?').run(id);
        db.prepare('DELETE FROM posts WHERE id = ?').run(id);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    deleteSite(id: string) {
      db.exec('BEGIN');
      try {
        db.prepare('DELETE FROM publications WHERE site_id = ?').run(id);
        for (const post of all<Post>('posts')) {
          if (post.siteIds.includes(id)) put('posts', { ...post, siteIds: post.siteIds.filter(siteId => siteId !== id), status: all<Publication>('publications').some(publication => publication.postId === post.id && publication.status === 'published') ? 'published' : 'draft' });
        }
        db.prepare('DELETE FROM sites WHERE id = ?').run(id);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    close: () => db.close(),
  };
}

export type Store = ReturnType<typeof createStore>;
type Awaitable<T> = T | Promise<T>;
export type DataStore = { [K in Exclude<keyof Store, 'db'>]: (...args: Parameters<Store[K]>) => Awaitable<ReturnType<Store[K]>> };
