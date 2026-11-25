import { resolve } from 'node:path';
import { createStore, type Store } from './store.js';
import type { ContentStore } from './storage.js';
import { createApplication, type Application, type ApplicationOptions } from './application.js';

export { contentToHtml } from './application.js';

export type AppOptions = Omit<ApplicationOptions, 'store'> & {
  store?: ContentStore;
  databasePath?: string;
  seed?: boolean;
};

// Local callers retain the concrete synchronous SQLite store (including .db),
// while hosts providing another store preserve that implementation's type.
export function createApp(options?: AppOptions & { store?: undefined }): Application<Store>;
export function createApp<T extends ContentStore>(options: AppOptions & { store: T }): Application<T>;
export function createApp(options: AppOptions): Application<ContentStore>;
export function createApp(options: AppOptions = {}): Application<ContentStore> {
  const env = options.env ?? process.env;
  const store = options.store ?? createStore(options.databasePath ?? env.DATABASE_PATH ?? resolve('data/blogmachine.sqlite'), options.seed ?? true);
  return createApplication({ ...options, env, store });
}
