// Script to promote user to admin role
// Load .env from root directory
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function promoteToAdmin(email) {
  const client = await pool.connect();
  try {
    console.log(`Promoting user ${email} to admin...`);

    const result = await client.query(
      'UPDATE users SET role = $1 WHERE email = $2 RETURNING id, email, name, role',
      ['admin', email]
    );

    if (result.rows.length === 0) {
      console.error(`✗ User not found: ${email}`);
      console.log('Available users:');
      const users = await client.query('SELECT email, name, role FROM users');
      users.rows.forEach(u => console.log(`  - ${u.email} (${u.name}) - ${u.role}`));
      process.exit(1);
    }

    const user = result.rows[0];
    console.log('✓ User promoted to admin:');
    console.log(`  ID: ${user.id}`);
    console.log(`  Email: ${user.email}`);
    console.log(`  Name: ${user.name}`);
    console.log(`  Role: ${user.role}`);
  } catch (error) {
    console.error('✗ Failed to promote user:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

const email = process.argv[2];
if (!email) {
  console.error('Usage: node promote-admin.js <email>');
  process.exit(1);
}

promoteToAdmin(email);
