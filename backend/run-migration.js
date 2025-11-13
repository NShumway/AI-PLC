// Script to run database migration
// Load .env from root directory (same as backend config)
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runMigration() {
  const client = await pool.connect();
  try {
    const migrationPath = path.join(__dirname, 'migrations', '002_add_error_message.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('Running migration: 002_add_error_message.sql');
    console.log('Database:', process.env.DATABASE_URL ? 'Connected' : 'No DATABASE_URL found');

    await client.query(migrationSQL);
    console.log('✓ Migration completed successfully!');
  } catch (error) {
    if (error.code === '42701') {
      console.log('✓ Column already exists - skipping migration');
    } else {
      console.error('✗ Migration failed:', error.message);
      process.exit(1);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
