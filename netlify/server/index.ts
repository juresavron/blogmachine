import { setGlobalProxyFromEnv } from 'node:http';
import { getDatabase } from '@netlify/database';
import { getContext, onShutdown } from '@netlify/server';
import { createPostgresStore } from '../../server/postgres-store.js';
import { createNetlifyApp, validNetlifyUser } from '../../server/netlify-app.js';

setGlobalProxyFromEnv();
const store = await createPostgresStore(getDatabase().pool);
const workspace = createNetlifyApp(store, () => validNetlifyUser(getContext().user));
onShutdown(() => workspace.shutdown());
export default workspace.app;
