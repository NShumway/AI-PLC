# AI-Powered PLC Coach

An AI-powered chatbot that helps educators in Professional Learning Communities (PLCs) by answering questions based on uploaded educational textbooks using RAG (Retrieval-Augmented Generation).

## Project Status

**Current Phase:** Phase 5 - Production Hardening (In Progress)

### Completed Phases:
- ✅ Phase 1: Infrastructure & Authentication
- ✅ Phase 2: Chat Interface & RAG
- ✅ Phase 3: PDF Ingestion Pipeline
- ✅ Phase 4: Multi-Topic Chat Interface

### Current Focus:
- 🔄 Phase 5: Production Hardening (security, performance, stability)

See `PHASE_5_PRODUCTION_HARDENING.md` for details.

## Prerequisites

- Node.js 18+ and npm
- PostgreSQL 15+ (with pgvector extension support)
- **poppler-utils** (provides `pdftotext` and `pdfinfo` commands for PDF processing)
- Google Cloud Console project (for OAuth)
- OpenAI API key

### Installing poppler-utils:
```bash
# macOS
brew install poppler

# Ubuntu/Debian
sudo apt-get install poppler-utils

# Amazon Linux 2 (AWS)
sudo yum install poppler-utils
```

## Setup Instructions

### 1. Database Setup

Create a PostgreSQL database and run the migration:

```bash
# Create database
createdb aiplc

# Run migration
psql aiplc -f backend/migrations/001_initial_schema.sql
```

See `backend/migrations/README.md` for more details.

### 2. Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable Google+ API
4. Create OAuth 2.0 credentials:
   - Application type: Web application
   - Authorized redirect URIs:
     - `http://localhost:3001/auth/google/callback` (development)
5. Note your Client ID and Client Secret

### 3. Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Edit .env and add your credentials:
# - DATABASE_URL
# - GOOGLE_CLIENT_ID
# - GOOGLE_CLIENT_SECRET
# - OPENAI_API_KEY
# - SESSION_SECRET (use a strong random string)
# - FRONTEND_URL (e.g., http://localhost:3000)
# - BACKEND_URL (e.g., http://localhost:3001)
# - NODE_ENV (development or production)
# - PROCESSING_DIR (optional, defaults to /tmp/processing)

# Run in development mode
npm run dev
```

Backend will run on `http://localhost:3001`

### 4. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Run in development mode
npm run dev
```

Frontend will run on `http://localhost:3000`

## Testing Phase 1

1. Open `http://localhost:3000`
2. Click "Sign in with Google"
3. Complete OAuth flow
4. You should be redirected to `/chat` with your user info displayed
5. First user is created as `educator` role
6. To make a user `admin`, update the database:

```sql
UPDATE users SET role = 'admin' WHERE email = 'your-email@example.com';
```

## Project Structure

```
AIPLC/
├── backend/                 # Node.js/Express backend
│   ├── src/
│   │   ├── config/         # Database and Passport config
│   │   ├── middleware/     # Auth middleware
│   │   ├── routes/         # API routes
│   │   └── index.ts        # Main server file
│   └── migrations/         # SQL migration files
├── frontend/               # React frontend
│   ├── src/
│   │   ├── components/     # React components
│   │   ├── context/        # Auth context
│   │   ├── pages/          # Page components
│   │   └── styles/         # CSS files
│   └── index.html
├── PRD.md                  # Product Requirements
├── PHASE_1_*.md            # Phase documentation
└── README.md               # This file
```

## API Endpoints (Phase 1)

### Authentication
- `GET /auth/google` - Initiate OAuth
- `GET /auth/google/callback` - OAuth callback
- `POST /auth/logout` - Logout
- `GET /auth/me` - Get current user

### Health Check
- `GET /health` - Server health status
- `GET /` - API info

## Database Schema

See `backend/migrations/001_initial_schema.sql` for complete schema.

Main tables:
- `users` - User accounts (Google OAuth)
- `topics` - System-wide content categories
- `books` - PDF metadata
- `messages` - Chat history
- `document_chunks` - Vector embeddings (pgvector)
- `session` - Express sessions

## Technologies

**Backend:**
- Node.js + Express + TypeScript
- PostgreSQL + pgvector
- Passport.js (Google OAuth)
- OpenAI API

**Frontend:**
- React + TypeScript
- Vite
- React Router
- Axios

## Development Commands

### Backend
```bash
npm run dev      # Development with hot reload
npm run build    # Build TypeScript
npm run start    # Run production build
```

### Frontend
```bash
npm run dev      # Development server
npm run build    # Production build
npm run preview  # Preview production build
```

## Next Steps

After completing Phase 1:

1. **Phase 2:** Implement chat interface with RAG system
   - Build chat UI
   - Integrate OpenAI for responses
   - Test strict knowledge boundaries

2. **Phase 3:** Build PDF ingestion pipeline
   - Admin upload interface
   - PDF text extraction
   - Vector embedding generation

3. **Phase 4:** Multi-topic chat interface
   - Topic sidebar
   - Topic filtering
   - Final integration

## Out of Scope / Future Considerations

The following features were considered but intentionally excluded from the current implementation. This section documents why they were excluded and how to implement them if needed in the future.

### S3/Blob Storage for PDFs

**Current Implementation**: PDFs are temporarily stored on local filesystem (`/tmp/processing`) during processing, then deleted.

**Why Not S3**:
- Single backend server deployment - no need for shared storage across instances
- Processing completes in minutes/hours, temporary local storage is sufficient
- Simpler architecture without additional AWS dependencies
- Cost savings (no S3 storage/transfer costs)

**When You'd Need S3**:
- Horizontal scaling (multiple backend instances)
- Serverless deployment (AWS Lambda, containers with ephemeral storage)
- Very long processing times requiring persistence
- Need to retain original PDFs for reprocessing

**How to Migrate to S3**:
```typescript
// Install AWS SDK
npm install @aws-sdk/client-s3

// Replace file operations in bookProcessorNew.ts
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({ region: process.env.AWS_REGION });

// Upload
await s3.send(new PutObjectCommand({
  Bucket: process.env.PDF_BUCKET,
  Key: `processing/${bookId}.pdf`,
  Body: pdfBuffer
}));

// Download for processing
const response = await s3.send(new GetObjectCommand({
  Bucket: process.env.PDF_BUCKET,
  Key: `processing/${bookId}.pdf`
}));
```

---

### Redis for Session Storage & Caching

**Current Implementation**:
- Sessions stored in PostgreSQL
- Topics list cached in-memory

**Why Not Redis**:
- PostgreSQL session storage works well for single instance
- In-memory cache sufficient for low-traffic scenarios
- Reduces operational complexity (one less service to manage)
- pgvector already requires PostgreSQL, so it's always available

**When You'd Need Redis**:
- Multiple backend instances (need shared session storage)
- High-traffic scenarios (faster session lookups)
- Advanced caching strategies (distributed cache)
- Rate limiting across multiple servers

**How to Migrate**:
```bash
npm install connect-redis redis
```
```typescript
import RedisStore from 'connect-redis';
import { createClient } from 'redis';

const redisClient = createClient({ url: process.env.REDIS_URL });
await redisClient.connect();

app.use(session({
  store: new RedisStore({ client: redisClient }),
  // ... rest of config
}));
```

---

### Background Job Queue (Bull/BullMQ)

**Current Implementation**: Fire-and-forget async processing with in-memory tracking

**Why Not Bull**:
- Current async processing with staging tables works reliably
- No need for job retry/priority/scheduling features
- Simpler code without queue abstractions
- One less dependency (Redis) required

**When You'd Need Bull**:
- Complex job workflows (chained jobs, job dependencies)
- Need for job retry with backoff strategies
- Job priority queues
- Scheduled/delayed jobs
- Job progress tracking UI

**How to Migrate**: Bull package already in dependencies (unused). See Bull documentation for implementation.

---

### Component Library (Material-UI, Chakra, etc.)

**Current Implementation**: Custom CSS for all components

**Why Not Component Library**:
- Simple UI with few components
- Full control over styling
- Smaller bundle size
- No learning curve for new library

**When You'd Need It**:
- Building many new complex UI components
- Need for consistent design system
- Accessibility features out-of-the-box
- Responsive design patterns

---

### Advanced Monitoring (Sentry, DataDog, New Relic)

**Current Implementation**: Console logging and AWS CloudWatch

**Why Not Advanced Monitoring**:
- Console logs sufficient for development/small deployments
- CloudWatch provides basic production monitoring
- Additional cost for APM services

**When You'd Need It**:
- Production deployment at scale
- Need for error tracking with stack traces
- Performance monitoring and profiling
- User session replay
- Alerting and on-call workflows

**Quick Win**: Add Sentry for error tracking (free tier available):
```bash
npm install @sentry/node
```

---

### WebSockets for Real-Time Updates

**Current Implementation**: HTTP polling (manual refresh)

**Why Not WebSockets**:
- Educational use case - not time-critical
- Simple request/response model easier to debug
- No need for real-time collaboration features
- Reduces server complexity

**When You'd Need It**:
- Real-time collaborative features
- Live progress updates during PDF processing
- Multi-user chat in same topic
- Instant notification of new content

---

### Automated Testing (E2E, Integration)

**Current Implementation**: Manual testing, some unit tests

**Why Limited Testing**:
- Rapid development phase focused on features
- Small codebase easy to test manually
- Unit tests for critical logic (RAG, chunking)

**Recommended Next Step**: Add integration tests for Phase 5 security fixes:
```typescript
// Test CSRF protection, rate limiting, authorization
// Use supertest for API testing
```

---

## Documentation

- [Product Requirements Document](./PRD.md)
- [Phase 1: Infrastructure & Auth](./PHASE_1_INFRASTRUCTURE_AUTH.md)
- [Phase 2: Chat & RAG](./PHASE_2_CHAT_RAG.md)
- [Phase 3: PDF Ingestion](./PHASE_3_PDF_INGESTION.md)
- [Phase 4: Multi-Topic Chat](./PHASE_4_MULTI_TOPIC_CHAT.md)
- [Phase 5: Production Hardening](./PHASE_5_PRODUCTION_HARDENING.md)
- [Deployment Guide](./DEPLOYMENT.md)

## Troubleshooting

### Database connection fails
- Verify PostgreSQL is running
- Check DATABASE_URL in .env
- Ensure pgvector extension is installed: `CREATE EXTENSION vector;`

### OAuth fails
- Verify Google Client ID and Secret
- Check redirect URI matches Google Console
- Ensure callback URL is correct: `http://localhost:3001/auth/google/callback`

### Frontend can't connect to backend
- Check backend is running on port 3001
- Verify CORS settings in backend
- Check Vite proxy configuration

## License

ISC
