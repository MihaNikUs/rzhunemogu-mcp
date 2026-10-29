import pg from 'pg';

const { Pool } = pg;

// Пул подключений к PostgreSQL
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgres://rzhunemogu:rzhunemogu_deploy_2026@localhost:5432/rzhunemogu',
  max: 10,
});

export default pool;