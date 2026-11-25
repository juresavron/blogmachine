import type { ContentStore } from './storage.js';
import type { Post, Publication, Site } from './types.js';
import type { PreparedChange } from './repositories/routes.js';
import { demoContent } from './seed.js';

type Table = 'blogmachine_sites' | 'blogmachine_posts' | 'blogmachine_publications' | 'blogmachine_repository_changes';
interface Connection {
  query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}
interface DatabaseClient extends Connection { release(error?: Error | boolean): void; }
/** The shared query/session API implemented by pg and Netlify's Neon pool. */
export interface DatabasePool extends Connection {
  connect(): Promise<DatabaseClient>;
  end(): Promise<void>;
}
type ReleaseWriteLock = () => Promise<void>;

/** Durable storage for serverless instances. The supplied pool retains its TLS configuration. */
export async function createPostgresStore(pool: DatabasePool, seed = true) {
  async function transaction<T>(run: (client: DatabaseClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }
  async function all<T>(table: Table, connection: Connection = pool, descending = false): Promise<T[]> {
    const result = await connection.query<{ data: T }>(`SELECT data FROM ${table} ORDER BY ordinal ${descending ? 'DESC' : 'ASC'}`);
    return result.rows.map(row => row.data);
  }
  async function get<T>(table: Table, id: string): Promise<T | undefined> {
    const result = await pool.query<{ data: T }>(`SELECT data FROM ${table} WHERE id = $1`, [id]);
    return result.rows[0]?.data;
  }
  async function put(table: 'blogmachine_sites' | 'blogmachine_posts' | 'blogmachine_repository_changes', value: Site | Post | PreparedChange, connection: Connection = pool): Promise<void> {
    await connection.query(`INSERT INTO ${table}(id, data) VALUES ($1, $2::jsonb) ON CONFLICT(id) DO UPDATE SET data = EXCLUDED.data`, [value.id, JSON.stringify(value)]);
  }
  async function putPublication(value: Publication, connection: Connection = pool): Promise<void> {
    await connection.query(`INSERT INTO blogmachine_publications(id, post_id, site_id, data) VALUES ($1, $2, $3, $4::jsonb)
      ON CONFLICT(post_id, site_id) DO UPDATE SET id = EXCLUDED.id, data = EXCLUDED.data`, [value.id, value.postId, value.siteId, JSON.stringify(value)]);
  }

  // A transaction-scoped, schema-specific lock makes concurrent cold starts and seed checks atomic.
  await transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database()), hashtext(current_schema() || ':blogmachine:schema'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS blogmachine_sites (id TEXT PRIMARY KEY, data JSONB NOT NULL, ordinal BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE);
      CREATE TABLE IF NOT EXISTS blogmachine_posts (id TEXT PRIMARY KEY, data JSONB NOT NULL, ordinal BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE);
      CREATE TABLE IF NOT EXISTS blogmachine_publications (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, site_id TEXT NOT NULL, data JSONB NOT NULL, ordinal BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE, UNIQUE(post_id, site_id));
      CREATE TABLE IF NOT EXISTS blogmachine_repository_changes (id TEXT PRIMARY KEY, data JSONB NOT NULL, ordinal BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE);
      CREATE TABLE IF NOT EXISTS blogmachine_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    const seeded = await client.query("SELECT value FROM blogmachine_metadata WHERE key = 'seeded'");
    if (seed && seeded.rowCount === 0) {
      const content = demoContent();
      for (const site of content.sites) await put('blogmachine_sites', site, client);
      for (const post of content.posts) await put('blogmachine_posts', post, client);
      for (const publication of content.publications) await putPublication(publication, client);
      await client.query("INSERT INTO blogmachine_metadata(key, value) VALUES ('seeded', '1')");
    }
  });

  const heldLocks = new Set<ReleaseWriteLock>();
  const store = {
    sites: () => all<Site>('blogmachine_sites'),
    posts: () => all<Post>('blogmachine_posts'),
    publications: () => all<Publication>('blogmachine_publications'),
    site: (id: string) => get<Site>('blogmachine_sites', id),
    post: (id: string) => get<Post>('blogmachine_posts', id),
    publication: (id: string) => get<Publication>('blogmachine_publications', id),
    putSite: (site: Site) => put('blogmachine_sites', site),
    putPost: (post: Post) => put('blogmachine_posts', post),
    putPublication: (publication: Publication) => putPublication(publication),
    repositoryChanges: () => all<PreparedChange>('blogmachine_repository_changes', pool, true),
    repositoryChange: (id: string) => get<PreparedChange>('blogmachine_repository_changes', id),
    putRepositoryChange: (change: PreparedChange) => put('blogmachine_repository_changes', change),
    async deletePost(id: string): Promise<void> {
      await transaction(async client => {
        await client.query('DELETE FROM blogmachine_publications WHERE post_id = $1', [id]);
        await client.query('DELETE FROM blogmachine_posts WHERE id = $1', [id]);
      });
    },
    async deleteSite(id: string): Promise<void> {
      await transaction(async client => {
        await client.query('DELETE FROM blogmachine_publications WHERE site_id = $1', [id]);
        const posts = await client.query<{ data: Post }>('SELECT data FROM blogmachine_posts ORDER BY ordinal FOR UPDATE');
        const publications = await client.query<{ post_id: string }>("SELECT post_id FROM blogmachine_publications WHERE data->>'status' = 'published'");
        const publishedPosts = new Set(publications.rows.map(row => row.post_id));
        for (const { data: post } of posts.rows) {
          if (post.siteIds.includes(id)) await put('blogmachine_posts', { ...post, siteIds: post.siteIds.filter(siteId => siteId !== id), status: publishedPosts.has(post.id) ? 'published' : 'draft' }, client);
        }
        await client.query('DELETE FROM blogmachine_sites WHERE id = $1', [id]);
      });
    },
    async acquireWriteLock(): Promise<ReleaseWriteLock | null> {
      // Pin a backend transaction until the complete mutation (including remote work) ends.
      // A checked-out client alone does not preserve session affinity through transaction poolers.
      // Store queries use another pool connection while this one owns the transaction lock.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_xact_lock(hashtext(current_database()), hashtext(current_schema() || ':blogmachine:write')) AS locked");
        if (!result.rows[0]?.locked) { await client.query('ROLLBACK'); client.release(); return null; }
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        client.release(error instanceof Error ? error : new Error('Could not acquire write lock.'));
        throw error;
      }
      let releasePromise: Promise<void> | undefined;
      const release: ReleaseWriteLock = () => releasePromise ??= (async () => {
        heldLocks.delete(release);
        let releaseError: Error | undefined;
        try { await client.query('COMMIT'); }
        catch (error) { releaseError = error instanceof Error ? error : new Error('Could not release write lock.'); throw error; }
        finally { client.release(releaseError); }
      })();
      heldLocks.add(release);
      return release;
    },
    async close(): Promise<void> {
      try { await Promise.all([...heldLocks].map(release => release())); }
      finally { await pool.end(); }
    },
  } satisfies ContentStore & { acquireWriteLock(): Promise<ReleaseWriteLock | null> };
  return store;
}

export type PostgresStore = Awaited<ReturnType<typeof createPostgresStore>>;
