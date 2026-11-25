import { databaseEnvironment } from './environment.js';
import { mediaspedConfiguration, mediaspedProjectUrl, testMediaspedConnection } from './mediasped.js';
import { createSupabaseSessions, emailProof, supabaseSessionError, type SessionOptions } from './supabase-sessions.js';
export type { SupabaseSessionStatus as MediaspedSessionStatus } from './supabase-sessions.js';
export function createMediaspedSessions(options: SessionOptions) {
  return createSupabaseSessions(options, {
    id: 'mediasped', label: 'Mediašped', origin: mediaspedProjectUrl, tokenKey: 'MEDIASPED_SUPABASE_ACCESS_TOKEN',
    environment: o => databaseEnvironment('mediasped', o.workspace, o.env, o.repositoryRoot),
    configuration: env => mediaspedConfiguration(env, false), test: testMediaspedConnection,
  });
}
export type MediaspedSessions = ReturnType<typeof createMediaspedSessions>;
export const mediaspedSessionError = supabaseSessionError;
export const mediaspedEmailProof = (proof: string, email: string) => emailProof(proof, email, mediaspedProjectUrl, 'Mediašped');
