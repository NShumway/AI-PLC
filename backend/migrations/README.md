# Database Migrations

## Running Migrations

### Option 1: Using psql (PostgreSQL CLI)
```bash
psql $DATABASE_URL -f migrations/001_initial_schema.sql
```

### Option 2: Using a PostgreSQL client
Connect to your database and run the SQL file `001_initial_schema.sql`.

### Option 3: Using Node.js script
```bash
npm run migrate
```

## Migration Files

- `001_initial_schema.sql` - Initial database schema with pgvector extension, all tables, and indexes

## Verifying Migration

After running the migration, verify it worked:

```sql
-- Check if pgvector is installed
SELECT * FROM pg_extension WHERE extname = 'vector';

-- List all tables
\dt

-- Check vector column
\d document_chunks
```

You should see:
- pgvector extension installed
- 6 tables: users, topics, books, messages, document_chunks, session
- All indexes created
