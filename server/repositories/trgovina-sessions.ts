import { databaseEnvironment } from './environment.js';
import { trgovinaConfiguration, testTrgovinaConnection } from './trgovina.js';
import { createSupabaseSessions, type SessionOptions } from './supabase-sessions.js';
export const trgovinaProjectUrl = 'https://cybwzhgretztcjfdefoy.supabase.co';
export function createTrgovinaSessions(options: SessionOptions) {
  return createSupabaseSessions(options, {
    id: 'trgovina', label: 'Trgovina', origin: trgovinaProjectUrl, tokenKey: 'TRGOVINA_SUPABASE_ACCESS_TOKEN',
    environment: o => databaseEnvironment('trgovina', o.workspace, o.env, o.repositoryRoot),
    configuration: env => { const config = trgovinaConfiguration(env); if (config.origin !== trgovinaProjectUrl) throw new Error('Use the existing Trgovina project.'); return config; },
    test: testTrgovinaConnection,
  });
}
