import type { Post, Publication, Site } from './types.js';
import type { RepositorySource } from './repositories/snapshots.js';
import type { PreparedChange } from './repositories/routes.js';

export type Awaitable<T> = T | Promise<T>;

/** Shared operations for local SQLite and durable production storage. */
export interface ContentStore {
  sites(): Awaitable<Site[]>;
  posts(): Awaitable<Post[]>;
  publications(): Awaitable<Publication[]>;
  site(id: string): Awaitable<Site | undefined>;
  post(id: string): Awaitable<Post | undefined>;
  publication(id: string): Awaitable<Publication | undefined>;
  putSite(site: Site): Awaitable<void>;
  putPost(post: Post): Awaitable<void>;
  putPublication(publication: Publication): Awaitable<void>;
  deletePost(id: string): Awaitable<void>;
  deleteSite(id: string): Awaitable<void>;
  repositoryChanges(): Awaitable<PreparedChange[]>;
  repositoryChange(id: string): Awaitable<PreparedChange | undefined>;
  putRepositoryChange(change: PreparedChange): Awaitable<void>;
  repositorySource?(id: string): Awaitable<RepositorySource | undefined>;
  putRepositorySource?(source: RepositorySource): Awaitable<void>;
  close(): Awaitable<void>;
}

