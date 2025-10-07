import { Router } from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { isEmailAuthorized, generateToken, AuthUser } from '../middleware/auth';

const router = Router();

/**
 * Configure Google OAuth Strategy
 */
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3002/auth/google/callback';

// Only configure Google OAuth if credentials are provided
const isOAuthConfigured = GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET;

if (!isOAuthConfigured) {
    console.warn('⚠️ Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env');
    console.warn('⚠️ Authentication routes will return 503 until OAuth is configured');
} else {
    passport.use(new GoogleStrategy({
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: GOOGLE_CALLBACK_URL,
        scope: ['profile', 'email']
    },
    async (accessToken, refreshToken, profile, done) => {
        try {
            const email = profile.emails?.[0]?.value;

            if (!email) {
                return done(new Error('No email found in Google profile'));
            }

            // Check if email is authorized
            if (!isEmailAuthorized(email)) {
                return done(null, false, {
                    message: `Unauthorized email domain. Only @sparklawnnwa.com emails are allowed.`
                });
            }

            const user: AuthUser = {
                email,
                name: profile.displayName || email.split('@')[0],
                picture: profile.photos?.[0]?.value,
                googleId: profile.id
            };

            return done(null, user);
        } catch (error) {
            return done(error as Error);
        }
    }));

    // Serialize user for session (not used with JWT, but required by Passport)
    passport.serializeUser((user: any, done) => {
        done(null, user);
    });

    passport.deserializeUser((user: any, done) => {
        done(null, user);
    });
}

/**
 * GET /auth/google
 * Initiate Google OAuth flow
 */
router.get('/google', (req, res, next) => {
    if (!isOAuthConfigured) {
        return res.status(503).json({
            error: 'OAuth not configured',
            message: 'Google OAuth credentials are not set. Please configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.'
        });
    }

    passport.authenticate('google', {
        scope: ['profile', 'email'],
        prompt: 'select_account' // Always show account selector (good for mobile)
    })(req, res, next);
});

/**
 * GET /auth/google/callback
 * Handle Google OAuth callback
 */
router.get('/google/callback', (req, res, next) => {
    if (!isOAuthConfigured) {
        return res.redirect('/unauthorized');
    }

    passport.authenticate('google', { session: false, failureRedirect: '/unauthorized' })(req, res, () => {
        const user = req.user as AuthUser;

        // Generate JWT token
        const token = generateToken(user);

        // Set HTTP-only cookie (secure in production)
        res.cookie('auth_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
        });

        // Redirect to return URL or default dashboard
        const returnTo = (req.query.state as string) || '/fleet-advanced';
        res.redirect(returnTo);
    });
});

/**
 * GET /auth/logout
 * Clear authentication and redirect
 */
router.get('/logout', (req, res) => {
    res.clearCookie('auth_token');
    res.redirect('/login');
});

/**
 * GET /auth/me
 * Get current user info (API endpoint for mobile)
 */
router.get('/me', (req, res) => {
    const token = req.cookies?.auth_token || req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    const { verifyToken } = require('../middleware/auth');
    const user = verifyToken(token);

    if (!user) {
        return res.status(401).json({ error: 'Invalid token' });
    }

    res.json({ user });
});

export default router;
