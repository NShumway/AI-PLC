# Phase 1: Infrastructure & Authentication

## Overview
Set up the foundational AWS infrastructure, PostgreSQL database with pgvector, and Google OAuth authentication system. This phase establishes the backend and database layer that all other features will build upon.

## Goals
- Deploy AWS infrastructure (RDS PostgreSQL, App Runner, S3/CloudFront)
- Configure PostgreSQL with pgvector extension
- Implement complete database schema
- Build Google OAuth authentication with role-based access control
- Establish basic backend API structure

## Prerequisites
- AWS account with appropriate permissions
- Google Cloud Console project for OAuth setup
- Node.js and npm installed locally
- PostgreSQL client tools for database management

## AWS Infrastructure Setup

### Reference
Follow the existing `AWS_SETUP_GUIDE.md` for detailed AWS infrastructure setup instructions.

### Required AWS Resources

#### 1. RDS PostgreSQL Instance
- **Engine**: PostgreSQL 15+ (supports pgvector)
- **Instance class**: db.t3.micro or db.t4g.micro (for development)
- **Storage**: 20GB General Purpose SSD (gp3)
- **Configuration**:
  - Enable pgvector extension support
  - Configure security groups for App Runner access
  - Enable automated backups
  - Set up CloudWatch monitoring

#### 2. AWS App Runner
- **Service type**: Web service
- **Source**: Container registry or GitHub (depending on deployment strategy)
- **Instance**: 1 vCPU, 2GB memory (adjust as needed)
- **Auto scaling**: 1-5 instances
- **Environment variables** (to be set):
  - `DATABASE_URL`: PostgreSQL connection string
  - `GOOGLE_CLIENT_ID`: OAuth client ID
  - `GOOGLE_CLIENT_SECRET`: OAuth client secret
  - `OPENAI_API_KEY`: OpenAI API key
  - `SESSION_SECRET`: Random secret for session management
  - `FRONTEND_URL`: CloudFront distribution URL
  - `NODE_ENV`: production

#### 3. S3 + CloudFront
- **S3 Bucket**: Host React frontend build files
  - Enable static website hosting
  - Block public access (serve via CloudFront only)
- **CloudFront Distribution**:
  - Origin: S3 bucket
  - Enable HTTPS only
  - Default root object: index.html
  - Error pages: Redirect 404 to index.html (for SPA routing)

## Database Schema Implementation

### Enable pgvector Extension
```sql
-- Connect to your database
-- Run as superuser or database owner
CREATE EXTENSION IF NOT EXISTS vector;
```

### Create Tables

#### Users Table
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_id VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'educator')),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_users_google_id ON users(google_id);
CREATE INDEX idx_users_email ON users(email);
```

#### Topics Table
```sql
CREATE TABLE topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_topics_name ON topics(name);
```

#### Books Table
```sql
CREATE TABLE books (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(500) NOT NULL,
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  processing_status VARCHAR(20) NOT NULL CHECK (processing_status IN ('pending', 'processing', 'complete', 'failed')),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_books_topic_id ON books(topic_id);
CREATE INDEX idx_books_uploaded_by ON books(uploaded_by);
CREATE INDEX idx_books_processing_status ON books(processing_status);
```

#### Messages Table
```sql
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID REFERENCES topics(id) ON DELETE CASCADE, -- NULL for "All Topics" chat
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  citations JSONB, -- Format: [{"book_title": "...", "page_number": 42}]
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_messages_topic_id ON messages(topic_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);
```

#### Document Chunks Table (Vector Storage)
```sql
CREATE TABLE document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  embedding vector(1536), -- OpenAI text-embedding-3-small dimension
  page_number INTEGER NOT NULL,
  book_title VARCHAR(500) NOT NULL,
  chunk_index INTEGER NOT NULL, -- Order within the document (0-based)
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create HNSW index for fast similarity search
CREATE INDEX idx_embedding ON document_chunks USING hnsw (embedding vector_cosine_ops);

-- Create indexes for metadata filtering
CREATE INDEX idx_chunks_book_id ON document_chunks(book_id);
CREATE INDEX idx_chunks_topic_id ON document_chunks(topic_id);
CREATE INDEX idx_chunks_book_title ON document_chunks(book_title);
```

### Seed Data (Optional)
```sql
-- Create a default admin user (update with your Google ID after first login)
-- INSERT INTO users (google_id, email, name, role)
-- VALUES ('your-google-id', 'your-email@example.com', 'Admin User', 'admin');
```

## Backend API Setup

### Tech Stack
- **Framework**: Express.js (Node.js)
- **Language**: TypeScript (recommended) or JavaScript
- **Database Client**: `pg` (node-postgres) + `pgvector` support
- **Authentication**: Passport.js with Google OAuth strategy
- **Session Management**: express-session with PostgreSQL store

### Project Structure
```
backend/
├── src/
│   ├── config/
│   │   ├── database.ts      # PostgreSQL connection setup
│   │   ├── passport.ts      # Google OAuth configuration
│   │   └── env.ts           # Environment variables
│   ├── middleware/
│   │   ├── auth.ts          # Authentication middleware
│   │   └── errorHandler.ts # Error handling middleware
│   ├── routes/
│   │   ├── auth.ts          # Authentication routes
│   │   ├── admin.ts         # Admin routes (placeholder for Phase 3)
│   │   └── chat.ts          # Chat routes (placeholder for Phase 2)
│   ├── services/
│   │   ├── database.ts      # Database query utilities
│   │   └── auth.ts          # Authentication business logic
│   ├── types/
│   │   └── index.ts         # TypeScript type definitions
│   └── index.ts             # Main application entry point
├── package.json
└── tsconfig.json (if using TypeScript)
```

### Required npm Packages
```json
{
  "dependencies": {
    "express": "^4.18.x",
    "pg": "^8.11.x",
    "pgvector": "^0.1.x",
    "passport": "^0.7.x",
    "passport-google-oauth20": "^2.0.x",
    "express-session": "^1.17.x",
    "connect-pg-simple": "^9.0.x",
    "dotenv": "^16.3.x",
    "cors": "^2.8.x",
    "helmet": "^7.1.x",
    "compression": "^1.7.x"
  },
  "devDependencies": {
    "@types/express": "^4.17.x",
    "@types/node": "^20.x.x",
    "@types/passport": "^1.0.x",
    "@types/passport-google-oauth20": "^2.0.x",
    "@types/pg": "^8.10.x",
    "typescript": "^5.x.x",
    "ts-node": "^10.x.x",
    "nodemon": "^3.x.x"
  }
}
```

### Database Connection Setup
```typescript
// src/config/database.ts
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for AWS RDS
  }
});

export default pool;
```

## Google OAuth Authentication

### Google Cloud Console Setup

1. **Create OAuth 2.0 Credentials**:
   - Go to Google Cloud Console → APIs & Services → Credentials
   - Create OAuth 2.0 Client ID
   - Application type: Web application
   - Authorized redirect URIs:
     - `http://localhost:3001/auth/google/callback` (development)
     - `https://your-app-runner-url/auth/google/callback` (production)

2. **Note your credentials**:
   - Client ID
   - Client secret

### Passport.js Configuration
```typescript
// src/config/passport.ts
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import pool from './database';

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      callbackURL: '/auth/google/callback',
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        if (!email) {
          return done(new Error('No email found in Google profile'));
        }

        // Check if user exists
        let result = await pool.query(
          'SELECT * FROM users WHERE google_id = $1',
          [profile.id]
        );

        let user = result.rows[0];

        if (!user) {
          // Create new user with 'educator' role by default
          result = await pool.query(
            `INSERT INTO users (google_id, email, name, role)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [profile.id, email, profile.displayName, 'educator']
          );
          user = result.rows[0];
        }

        return done(null, user);
      } catch (error) {
        return done(error);
      }
    }
  )
);

passport.serializeUser((user: any, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    done(null, result.rows[0]);
  } catch (error) {
    done(error);
  }
});

export default passport;
```

### Authentication Routes
```typescript
// src/routes/auth.ts
import { Router } from 'express';
import passport from '../config/passport';

const router = Router();

// Initiate Google OAuth flow
router.get('/google', passport.authenticate('google', {
  scope: ['profile', 'email']
}));

// Google OAuth callback
router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/login' }),
  (req, res) => {
    // Successful authentication, redirect to frontend
    res.redirect(process.env.FRONTEND_URL || 'http://localhost:3000');
  }
);

// Logout
router.post('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ message: 'Logged out successfully' });
  });
});

// Get current user
router.get('/me', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.json(req.user);
});

export default router;
```

### Authentication Middleware
```typescript
// src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const user = req.user as any;
  if (user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  next();
}
```

### Main Application Setup
```typescript
// src/index.ts
import express from 'express';
import session from 'express-session';
import passport from './config/passport';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import authRoutes from './routes/auth';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(compression());
app.use(express.json());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Routes
app.use('/auth', authRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

## Frontend Setup (Basic)

### Tech Stack
- **Framework**: React (with TypeScript recommended)
- **Build Tool**: Vite or Create React App
- **Routing**: React Router
- **HTTP Client**: Axios or fetch
- **State Management**: React Context API or Redux (if needed later)

### Project Structure
```
frontend/
├── src/
│   ├── components/
│   │   ├── PrivateRoute.tsx  # Protected route wrapper
│   │   └── Header.tsx        # App header with login/logout
│   ├── pages/
│   │   ├── Login.tsx         # Login page
│   │   ├── Chat.tsx          # Chat page (placeholder for Phase 2)
│   │   └── Admin.tsx         # Admin page (placeholder for Phase 3)
│   ├── context/
│   │   └── AuthContext.tsx   # Authentication context
│   ├── api/
│   │   └── client.ts         # API client configuration
│   ├── App.tsx
│   └── main.tsx
├── package.json
└── tsconfig.json
```

### Authentication Context
```typescript
// src/context/AuthContext.tsx
import React, { createContext, useContext, useEffect, useState } from 'react';
import axios from 'axios';

interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'educator';
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check authentication status on mount
    axios.get('/auth/me', { withCredentials: true })
      .then(response => setUser(response.data))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = () => {
    window.location.href = `${process.env.REACT_APP_API_URL}/auth/google`;
  };

  const logout = async () => {
    await axios.post('/auth/logout', {}, { withCredentials: true });
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
```

## Testing & Validation

### Database Tests
- [ ] Connect to RDS PostgreSQL instance
- [ ] Verify pgvector extension is installed: `SELECT * FROM pg_extension WHERE extname = 'vector';`
- [ ] Verify all tables are created
- [ ] Verify all indexes are created
- [ ] Test basic CRUD operations on each table

### Authentication Tests
- [ ] Navigate to `/auth/google` and complete OAuth flow
- [ ] Verify user is created in database
- [ ] Verify session persists across page refreshes
- [ ] Test `/auth/me` endpoint returns current user
- [ ] Test logout functionality
- [ ] Verify protected routes require authentication

### Infrastructure Tests
- [ ] App Runner deploys successfully
- [ ] Environment variables are set correctly
- [ ] App Runner can connect to RDS
- [ ] S3 bucket serves frontend files
- [ ] CloudFront distribution serves content over HTTPS
- [ ] CORS is configured correctly between frontend and backend

## Environment Variables

### Backend (.env)
```
DATABASE_URL=postgresql://username:password@rds-endpoint:5432/dbname
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
OPENAI_API_KEY=your-openai-api-key
SESSION_SECRET=your-random-session-secret
FRONTEND_URL=https://your-cloudfront-url.cloudfront.net
NODE_ENV=production
PORT=3001
```

### Frontend (.env)
```
REACT_APP_API_URL=https://your-app-runner-url.awsapprunner.com
```

## Success Criteria

- [ ] AWS infrastructure is deployed and operational
- [ ] PostgreSQL database with pgvector is configured
- [ ] All database tables and indexes are created
- [ ] Google OAuth login works end-to-end
- [ ] Users can log in and see their profile
- [ ] Role-based access control works (admin vs educator)
- [ ] Session persistence works across page refreshes
- [ ] Health check endpoint returns 200
- [ ] Frontend can communicate with backend API
- [ ] CORS is configured correctly

## Next Steps
After completing Phase 1, proceed to **Phase 2: Chat Interface & RAG** to build the chat UI and implement the RAG query system with strict knowledge boundaries.
