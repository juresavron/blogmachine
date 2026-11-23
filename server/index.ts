import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { setGlobalProxyFromEnv } from 'node:http';
import express from 'express';
import { createApp } from './app.js';

const envFile = resolve('.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
setGlobalProxyFromEnv();
const { app, store } = createApp();
if (process.env.NODE_ENV === 'production') {
  const dist = resolve('dist');
  app.use(express.static(dist));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}
const port = Number(process.env.PORT ?? 3001);
const server = app.listen(port, '0.0.0.0', () => console.log(`Blog Machine API listening on port ${port}`));
function stop() { server.close(() => { store.close(); process.exit(0); }); }
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
