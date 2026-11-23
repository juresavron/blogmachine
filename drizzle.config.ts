import { defineConfig } from 'drizzle-kit';
export default defineConfig({ dialect: 'sqlite', schema: './server/hosted/schema.ts', out: './drizzle' });
