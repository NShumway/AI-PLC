// Script to create the aiplc database
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { Client } = require('pg');

// Connect to the default 'postgres' database to create our database
const client = new Client({
  user: 'shumway',
  host: 'localhost',
  database: 'postgres', // Connect to default database
  port: 5432,
});

async function createDatabase() {
  try {
    await client.connect();
    console.log('✓ Connected to PostgreSQL server');

    // Check if database exists
    const checkResult = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = 'aiplc'"
    );

    if (checkResult.rows.length > 0) {
      console.log('✓ Database "aiplc" already exists');
    } else {
      console.log('Creating database "aiplc"...');
      await client.query('CREATE DATABASE aiplc');
      console.log('✓ Database "aiplc" created successfully');
    }
  } catch (error) {
    console.error('✗ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

createDatabase();
