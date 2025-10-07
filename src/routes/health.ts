import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';

const router = Router();

/**
 * Lightweight health check endpoint
 * Returns 200 OK if server is running
 * Used by load balancers for basic health checks
 */
router.get('/healthz', (_req: Request, res: Response) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
    });
});

/**
 * Deep health check endpoint
 * Validates critical dependencies before returning 200
 * Used for deployment readiness checks
 */
router.get('/readyz', async (_req: Request, res: Response) => {
    const checks = {
        timestamp: new Date().toISOString(),
        status: 'ok',
        checks: {
            server: 'ok',
            database: 'checking',
            environment: 'checking'
        }
    };

    try {
        // Check MongoDB connection
        if (mongoose.connection.readyState === 1) {
            checks.checks.database = 'ok';
        } else {
            checks.checks.database = 'degraded';
            checks.status = 'degraded';
        }

        // Check required environment variables
        const requiredEnvVars = [
            'MONGODB_URI',
            'FORD_TELEMATICS_CLIENT_ID',
            'FORD_TELEMATICS_CLIENT_SECRET'
        ];

        const missingEnvVars = requiredEnvVars.filter(
            varName => !process.env[varName]
        );

        if (missingEnvVars.length === 0) {
            checks.checks.environment = 'ok';
        } else {
            checks.checks.environment = `missing: ${missingEnvVars.join(', ')}`;
            checks.status = 'error';
        }

        // Return appropriate status code
        if (checks.status === 'ok') {
            res.status(200).json(checks);
        } else if (checks.status === 'degraded') {
            res.status(503).json(checks);
        } else {
            res.status(500).json(checks);
        }

    } catch (error) {
        res.status(500).json({
            status: 'error',
            timestamp: new Date().toISOString(),
            error: error instanceof Error ? error.message : 'Unknown error',
            checks: checks.checks
        });
    }
});

export default router;
