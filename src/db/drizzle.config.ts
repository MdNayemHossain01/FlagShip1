import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';

dotenv.config();

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['public'],
  dbCredentials: {
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'flagship_app',
    password: process.env.PGPASSWORD || 'flagship_dev_pass',
    database: process.env.PGDATABASE || 'flagship',
    ssl: false,
  },
  verbose: true,
});
