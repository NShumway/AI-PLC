// Script to check database connection and list users
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function checkDatabase() {
  const client = await pool.connect();
  try {
    console.log('✓ Successfully connected to database!');
    console.log(`Database URL: ${process.env.DATABASE_URL.replace(/:[^:@]+@/, ':****@')}`);

    // Try to query users table
    const result = await client.query('SELECT id, email, name, role FROM users ORDER BY created_at DESC');

    console.log(`\nFound ${result.rows.length} user(s):`);
    result.rows.forEach(u => {
      console.log(`  - ${u.email} (${u.name}) - Role: ${u.role}`);
    });
  } catch (error) {
    console.error('✗ Database error:', error.message);
    console.error('Code:', error.code);

    if (error.code === '42P01') {
      console.error('\nThe users table does not exist. Have you run the initial migration?');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

checkDatabase();
