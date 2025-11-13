import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import dotenv from 'dotenv';
import path from 'path';
import pool from './database';

// Load .env from root directory
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      callbackURL: process.env.BACKEND_URL
        ? `${process.env.BACKEND_URL}/auth/google/callback`
        : '/auth/google/callback',
      proxy: true,
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
          console.log('✓ New user created:', email);
        } else {
          console.log('✓ Existing user logged in:', email);
        }

        return done(null, user);
      } catch (error) {
        console.error('Error in Google Strategy:', error);
        return done(error as Error);
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
