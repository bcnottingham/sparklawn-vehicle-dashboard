import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

/**
 * Mobile-first authentication middleware
 * Verifies JWT tokens from cookies or Authorization header
 */

export interface AuthUser {
    email: string;
    name: string;
    picture?: string;
    googleId: string;
}

// Extend Express Request to include user
declare global {
    namespace Express {
        interface User extends AuthUser {}
    }
}

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';
const JWT_EXPIRES_IN = '30d'; // 30 days for mobile convenience

// Authorized email domain
const AUTHORIZED_DOMAIN = '@sparklawnnwa.com';

// Optional: Specific email whitelist (comma-separated in .env)
const getAuthorizedEmails = (): string[] | null => {
    const emails = process.env.AUTHORIZED_EMAILS;
    return emails ? emails.split(',').map(e => e.trim().toLowerCase()) : null;
};

/**
 * Check if email is authorized
 */
export function isEmailAuthorized(email: string): boolean {
    const lowerEmail = email.toLowerCase();

    // Check whitelist first if it exists
    const whitelist = getAuthorizedEmails();
    if (whitelist && whitelist.length > 0) {
        return whitelist.includes(lowerEmail);
    }

    // Fall back to domain check
    return lowerEmail.endsWith(AUTHORIZED_DOMAIN);
}

/**
 * Generate JWT token for authenticated user
 */
export function generateToken(user: AuthUser): string {
    return jwt.sign(
        {
            email: user.email,
            name: user.name,
            picture: user.picture,
            googleId: user.googleId
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
}

/**
 * Verify JWT token
 */
export function verifyToken(token: string): AuthUser | null {
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
        return decoded;
    } catch (error) {
        return null;
    }
}

/**
 * Middleware: Require authentication
 * Redirects to /login if not authenticated
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
    // Check for token in cookie (mobile-friendly)
    const cookieToken = req.cookies?.auth_token;

    // Check for token in Authorization header (API requests)
    const headerToken = req.headers.authorization?.replace('Bearer ', '');

    const token = cookieToken || headerToken;

    if (!token) {
        // Mobile: Return JSON for API calls, redirect for page requests
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({
                error: 'Authentication required',
                message: 'Please log in to access this resource'
            });
        }
        return res.redirect(`/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
    }

    const user = verifyToken(token);

    if (!user) {
        // Token invalid or expired
        res.clearCookie('auth_token');

        if (req.path.startsWith('/api/')) {
            return res.status(401).json({
                error: 'Invalid or expired token',
                message: 'Please log in again'
            });
        }
        return res.redirect(`/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
    }

    // Attach user to request
    req.user = user;
    next();
}

/**
 * Middleware: Optional authentication
 * Attaches user if authenticated, but doesn't require it
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction) {
    const cookieToken = req.cookies?.auth_token;
    const headerToken = req.headers.authorization?.replace('Bearer ', '');
    const token = cookieToken || headerToken;

    if (token) {
        const user = verifyToken(token);
        if (user) {
            req.user = user;
        }
    }

    next();
}

/**
 * Middleware: Redirect if already authenticated
 * Useful for /login page
 */
export function redirectIfAuthenticated(req: Request, res: Response, next: NextFunction) {
    const token = req.cookies?.auth_token;

    if (token && verifyToken(token)) {
        return res.redirect('/fleet-advanced');
    }

    next();
}

export default {
    requireAuth,
    optionalAuth,
    redirectIfAuthenticated,
    isEmailAuthorized,
    generateToken,
    verifyToken
};
