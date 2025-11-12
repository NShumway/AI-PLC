# AI-Powered PLC Coach

An AI-powered chatbot that helps educators in Professional Learning Communities (PLCs) by answering questions based on uploaded educational textbooks using RAG (Retrieval-Augmented Generation).

## Project Status

**Current Phase:** Phase 1 - Infrastructure & Authentication ✓

- ✅ Project structure set up
- ✅ Backend API with Express + TypeScript
- ✅ PostgreSQL database with pgvector
- ✅ Google OAuth authentication
- ✅ React frontend with routing
- 🔄 Phase 2: Chat Interface & RAG (Next)
- ⏳ Phase 3: PDF Ingestion Pipeline
- ⏳ Phase 4: Multi-Topic Chat Interface

## Prerequisites

- Node.js 18+ and npm
- PostgreSQL 15+ (with pgvector extension support)
- Google Cloud Console project (for OAuth)
- OpenAI API key

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
# - SESSION_SECRET

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

## Documentation

- [Product Requirements Document](./PRD.md)
- [Phase 1: Infrastructure & Auth](./PHASE_1_INFRASTRUCTURE_AUTH.md)
- [Phase 2: Chat & RAG](./PHASE_2_CHAT_RAG.md)
- [Phase 3: PDF Ingestion](./PHASE_3_PDF_INGESTION.md)
- [Phase 4: Multi-Topic Chat](./PHASE_4_MULTI_TOPIC_CHAT.md)
- [AWS Setup Guide](./AWS_SETUP_GUIDE.md)

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
