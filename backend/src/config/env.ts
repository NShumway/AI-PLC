// Environment configuration
// This file can be used to validate and export environment variables

export const config = {
  port: process.env.PORT || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || '',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  similarityThreshold: parseFloat(process.env.SIMILARITY_THRESHOLD || '0.5'),
};

// Validate required env vars in production
if (config.nodeEnv === 'production') {
  const required = [
    'DATABASE_URL',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'OPENAI_API_KEY',
    'SESSION_SECRET',
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
