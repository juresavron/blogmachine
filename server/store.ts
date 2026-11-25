import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Post, Publication, Site } from './types.js';
import type { PreparedChange } from './repositories/routes.js';
import type { ContentStore } from './storage.js';
import { demoContent } from './seed.js';

export function createStore(path: string, seed = true) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS sites (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS publications (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, site_id TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(post_id, site_id));
    CREATE TABLE IF NOT EXISTS repository_changes (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);

  function all<T>(table: 'sites' | 'posts' | 'publications' | 'repository_changes'): T[] {
    return (db.prepare(`SELECT data FROM ${table} ORDER BY rowid`).all() as { data: string }[]).map(row => JSON.parse(row.data) as T);
  }
  function get<T>(table: 'sites' | 'posts' | 'publications' | 'repository_changes', id: string): T | undefined {
    const row = db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) as T : undefined;
  }
  function put(table: 'sites' | 'posts', value: Site | Post) {
    db.prepare(`INSERT INTO ${table}(id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`).run(value.id, JSON.stringify(value));
  }
  function putPublication(value: Publication) {
    db.prepare('INSERT INTO publications(id, post_id, site_id, data) VALUES (?, ?, ?, ?) ON CONFLICT(post_id, site_id) DO UPDATE SET id = excluded.id, data = excluded.data').run(value.id, value.postId, value.siteId, JSON.stringify(value));
  }

  if (seed && !db.prepare("SELECT value FROM metadata WHERE key = 'seeded'").get()) {
    const { sites, posts, publications } = demoContent();
    db.exec('BEGIN');
    try {
      sites.forEach(site => put('sites', site));
      posts.forEach(post => put('posts', post));
      publications.forEach(putPublication);
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
    repositoryChanges: () => (db.prepare('SELECT data FROM repository_changes ORDER BY rowid DESC').all() as { data: string }[]).map(row => JSON.parse(row.data) as PreparedChange),
    repositoryChange: (id: string) => get<PreparedChange>('repository_changes', id),
    putRepositoryChange(change: PreparedChange) {
      db.prepare('INSERT INTO repository_changes(id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run(change.id, JSON.stringify(change));
    },
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
  } satisfies ContentStore & { db: DatabaseSync };
}

export type Store = ReturnType<typeof createStore>;
