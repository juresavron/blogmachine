import type { DataStore } from '../store.js';
import type { Post, Publication, Site } from '../types.js';

export function createD1Store(db: D1Database): DataStore {
  type Table = 'sites' | 'posts' | 'publications' | 'repository_changes';
  async function all<T>(table: Table): Promise<T[]> {
    const rows = await db.prepare(`SELECT data FROM ${table} ORDER BY rowid${table === 'repository_changes' ? ' DESC' : ''}`).all<{ data: string }>();
    return rows.results.map(row => JSON.parse(row.data) as T);
  }
  async function get<T>(table: Table, id: string): Promise<T | undefined> {
    const row = await db.prepare(`SELECT data FROM ${table} WHERE id = ?`).bind(id).first<{ data: string }>();
    return row ? JSON.parse(row.data) as T : undefined;
  }
  async function put(table: 'sites' | 'posts' | 'repository_changes', value: { id: string }) {
    await db.prepare(`INSERT INTO ${table}(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`).bind(value.id, JSON.stringify(value)).run();
  }
  return {
    sites: () => all<Site>('sites'), posts: () => all<Post>('posts'), publications: () => all<Publication>('publications'),
    site: id => get<Site>('sites', id), post: id => get<Post>('posts', id), publication: id => get<Publication>('publications', id),
    putSite: value => put('sites', value), putPost: value => put('posts', value),
    async putPublication(value) {
      await db.prepare('INSERT INTO publications(id,post_id,site_id,data) VALUES (?,?,?,?) ON CONFLICT(post_id,site_id) DO UPDATE SET data=excluded.data').bind(value.id, value.postId, value.siteId, JSON.stringify(value)).run();
    },
    changes: () => all('repository_changes'), change: id => get('repository_changes', id), putChange: value => put('repository_changes', value), initChanges() {},
    async deletePost(id) { await db.batch([db.prepare('DELETE FROM publications WHERE post_id=?').bind(id), db.prepare('DELETE FROM posts WHERE id=?').bind(id)]); },
    async deleteSite(id) {
      // JSON updates and record deletion commit together, including concurrent post edits.
      await db.batch([
        db.prepare('DELETE FROM publications WHERE site_id=?').bind(id),
        db.prepare(`UPDATE posts SET data=json_set(data,'$.siteIds',json((SELECT coalesce(json_group_array(value),'[]') FROM json_each(posts.data,'$.siteIds') WHERE value<>?)), '$.status', CASE WHEN EXISTS(SELECT 1 FROM publications WHERE post_id=posts.id AND json_extract(data,'$.status')='published') THEN 'published' ELSE 'draft' END) WHERE EXISTS(SELECT 1 FROM json_each(posts.data,'$.siteIds') WHERE value=?)`).bind(id,id),
        db.prepare('DELETE FROM sites WHERE id=?').bind(id),
      ]);
    },
    close() {},
  };
}
