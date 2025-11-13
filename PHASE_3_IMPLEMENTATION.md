# Phase 3 Implementation: Admin PDF Upload & Management

## Overview
Phase 3 implements a complete PDF upload and management system for admin users, including:
- PDF upload with metadata (title, topic)
- Synchronous text extraction and chunking
- Embedding generation and storage in PostgreSQL + ChromaDB
- Admin dashboard for managing books and topics
- Topic autocomplete with create-new capability
- Book deletion with cascade cleanup

## What Was Implemented

### Backend Services

#### 1. Chunking Service (`backend/src/services/chunking.ts`)
- Recursive character text splitter
- **Chunk size:** 1000 characters
- **Overlap:** 200 characters
- Respects sentence boundaries
- Maintains page number metadata

#### 2. PDF Processor Service (`backend/src/services/pdfProcessor.ts`)
- **Synchronous processing pipeline:**
  1. Extract text from PDF page-by-page
  2. Chunk text with overlap
  3. Generate embeddings via OpenAI
  4. Store in PostgreSQL `document_chunks` table
  5. Store in ChromaDB collection
- **Error handling:** Failed books stored with error message
- **Images:** Automatically skipped (pdf-parse extracts text only)
- **File size limit:** 100MB
- **No file storage:** PDFs processed in memory, never saved

#### 3. Admin API Endpoints (`backend/src/routes/admin.ts`)

**POST /api/admin/topics**
- Create new topic or return existing by name
- Case-insensitive duplicate checking

**GET /api/admin/books**
- List all books with topic names, uploader info, status
- Sorted by creation date (newest first)

**POST /api/admin/books/upload**
- Multipart form data upload (multer middleware)
- Fields: `title`, `topicId`, `pdf` file
- Validates PDF file type and size
- Processes synchronously (user waits for result)
- Returns success with chunk count or error

**DELETE /api/admin/books/:id**
- Prevents deletion during processing
- Cascades delete from PostgreSQL and ChromaDB
- Removes all document chunks

### Frontend Components

#### Admin Dashboard (`frontend/src/pages/Admin.tsx`)

**Features:**
- Role-based access (admin only)
- PDF upload form with validation
- Topic autocomplete (select existing or create new)
- Real-time file size display
- Processing status (shows "Processing..." during upload)
- Success/error alerts
- Books table with status badges
- Delete confirmation modal

**Upload Form Fields:**
1. **Title** - Text input for book title
2. **Topic** - Autocomplete text input
   - Filters existing topics as you type
   - Shows "Will create new topic" hint for new topics
   - Case-insensitive matching
3. **PDF File** - File picker (PDF only, 100MB max)

**Books Table Columns:**
- Title
- Topic name
- Status badge (pending/processing/complete/failed)
- Uploaded by (user name)
- Upload date
- Delete button (disabled during processing)
- Error tooltip for failed uploads

#### Styling (`frontend/src/styles/Admin.css`)
- Clean, modern design
- Status badges with color coding:
  - Pending: Orange
  - Processing: Blue
  - Complete: Green
  - Failed: Red
- Responsive layout
- Autocomplete dropdown styling
- Alert messages (success/error)

### Database Changes

#### Migration (`backend/migrations/002_add_error_message.sql`)
- Adds `error_message TEXT` column to `books` table
- Adds index on `processing_status` for faster queries
- Stores detailed error info for failed uploads

## Running the Migration

### Local Development

1. Ensure `.env` file exists in root directory with `DATABASE_URL`
2. Run migration:
```bash
cd backend
node run-migration.js
```

### AWS Production

SSH into your EC2 instance or use AWS Systems Manager Session Manager, then:

```bash
cd /path/to/aiplc/backend
node run-migration.js
```

Or run SQL directly via RDS query editor:
```sql
ALTER TABLE books ADD COLUMN error_message TEXT;
CREATE INDEX idx_books_processing_status ON books(processing_status);
```

## Testing

### Prerequisites
1. Local PostgreSQL database running
2. ChromaDB running (`docker run -p 8000:8000 chromadb/chroma`)
3. `.env` file configured with:
   - `DATABASE_URL`
   - `OPENAI_API_KEY`
   - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
   - `SESSION_SECRET`

### Manual Testing Steps

1. **Set up admin user:**
```sql
UPDATE users SET role = 'admin' WHERE email = 'your-email@example.com';
```

2. **Start backend:**
```bash
cd backend
npm run dev
```

3. **Start frontend:**
```bash
cd frontend
npm run dev
```

4. **Test workflow:**
   - Log in with Google OAuth
   - Navigate to `/admin` (link shows in chat if you're admin)
   - Create new topic or select existing
   - Upload a small PDF (test with a few pages first)
   - Verify processing status updates
   - Check books table for new entry
   - Test deletion
   - Verify chunks in database and ChromaDB

5. **Verify data:**
```sql
-- Check book was created
SELECT * FROM books ORDER BY created_at DESC LIMIT 1;

-- Check chunks were created
SELECT COUNT(*) FROM document_chunks WHERE book_id = 'your-book-id';

-- Check ChromaDB
curl http://localhost:8000/api/v1/collections/plc_documents
```

## Architecture Decisions

### Synchronous vs Asynchronous Processing
**Choice:** Synchronous
**Rationale:**
- Simpler implementation (no job queue needed)
- Immediate user feedback
- Most textbooks process in <30 seconds
- Can upgrade to async later if needed

### Dual Storage (PostgreSQL + ChromaDB)
**Choice:** Keep both synced
**Rationale:**
- PostgreSQL for relational queries and data integrity
- ChromaDB for fast vector similarity search
- Easier debugging with SQL queries
- Can analyze chunks and usage patterns

### Topic Management
**Choice:** Autocomplete text input (not dropdown)
**Rationale:**
- Simple UX for few topics
- Easy to create new topics inline
- No modal needed
- Scales well for <100 topics

### File Size Limit
**Choice:** 100MB
**Rationale:**
- Large enough for most textbooks (typically 10-50MB)
- Prevents memory issues with synchronous processing
- Can be adjusted if needed

### Image Handling
**Choice:** Skip images automatically
**Rationale:**
- `pdf-parse` extracts text only (no OCR)
- Focus on text-based content
- OCR can be added later if needed

## Known Limitations

1. **Scanned PDFs:** Won't extract text (no OCR)
2. **Large files:** May timeout with very large PDFs (>100MB)
3. **Page accuracy:** Page number tracking is approximate for some PDFs
4. **No batch upload:** One file at a time
5. **No edit:** Can't edit book metadata after upload (must delete and re-upload)

## Future Enhancements (Phase 4+)

- Asynchronous processing with job queue
- Progress bar for uploads
- Batch PDF upload
- Edit book metadata
- OCR support for scanned PDFs
- Advanced chunking strategies
- Book preview/sample chunks
- Analytics dashboard (most cited books, etc.)

## Files Created/Modified

### New Files
- `backend/src/services/chunking.ts`
- `backend/src/services/pdfProcessor.ts`
- `backend/migrations/002_add_error_message.sql`
- `backend/run-migration.js`
- `frontend/src/styles/Admin.css`

### Modified Files
- `backend/src/routes/admin.ts` - Implemented all endpoints
- `frontend/src/pages/Admin.tsx` - Full admin dashboard UI
- `backend/package.json` - Added @types/uuid

## Deployment Checklist

### Backend
- [ ] Run database migration on production
- [ ] Build backend: `npm run build`
- [ ] Verify environment variables in production
- [ ] Ensure ChromaDB is accessible
- [ ] Test upload with small PDF

### Frontend
- [ ] Build frontend: `npm run build`
- [ ] Deploy to S3/CloudFront
- [ ] Verify API endpoints are reachable
- [ ] Test admin access and upload

### Database
- [ ] Run migration on AWS RDS
- [ ] Verify `error_message` column exists
- [ ] Promote at least one user to admin role

## Support

For issues or questions:
1. Check logs: `docker logs <container>` or CloudWatch
2. Verify environment variables
3. Test ChromaDB connection
4. Check database migration status
5. Review error messages in books table
