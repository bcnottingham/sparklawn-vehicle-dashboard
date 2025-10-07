import pino from 'pino';
import pinoHttp from 'pino-http';

/**
 * Production-ready structured logger using Pino
 * High-performance JSON logging with automatic request tracking
 */

// Configure Pino logger
const logger = pino({
    level: process.env.LOG_LEVEL || 'info',

    // Production: JSON output for log aggregation
    // Development: Pretty-print for readability
    transport: process.env.NODE_ENV === 'development' ? {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname'
        }
    } : undefined,

    // Base configuration
    base: {
        env: process.env.NODE_ENV || 'development',
        service: 'sparklawn-fleet-dashboard'
    },

    // Timestamp in ISO format
    timestamp: () => `,"time":"${new Date().toISOString()}"`,

    // Redact sensitive information
    redact: {
        paths: [
            'password',
            'token',
            'accessToken',
            'access_token',
            'refreshToken',
            'refresh_token',
            'authorization',
            'cookie',
            '*.password',
            '*.token',
            'req.headers.authorization',
            'req.headers.cookie'
        ],
        censor: '[REDACTED]'
    },

    // Format errors properly
    formatters: {
        level: (label) => {
            return { level: label };
        },
        bindings: (bindings) => {
            return {
                pid: bindings.pid,
                hostname: bindings.hostname,
                node_version: process.version
            };
        }
    }
});

/**
 * HTTP request logger middleware
 * Automatically logs all HTTP requests with timing and status
 */
export const httpLogger = pinoHttp({
    logger,

    // Custom request ID generator
    genReqId: (req) => {
        return req.headers['x-request-id'] ||
               req.headers['x-correlation-id'] ||
               `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    },

    // Customize request logging
    customLogLevel: (req, res, err) => {
        if (res.statusCode >= 500 || err) return 'error';
        if (res.statusCode >= 400) return 'warn';
        if (res.statusCode >= 300) return 'info';
        return 'info';
    },

    // Custom success message
    customSuccessMessage: (req, res) => {
        return `${req.method} ${req.url} ${res.statusCode} - ${res.getHeader('response-time')}ms`;
    },

    // Custom error message
    customErrorMessage: (req, res, err) => {
        return `${req.method} ${req.url} ${res.statusCode} - ${err.message}`;
    },

    // Customize serializers
    serializers: {
        req: (req) => ({
            id: req.id,
            method: req.method,
            url: req.url,
            headers: {
                host: req.headers.host,
                'user-agent': req.headers['user-agent'],
                'content-type': req.headers['content-type']
            },
            remoteAddress: req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
            remotePort: req.socket?.remotePort
        }),
        res: (res) => ({
            statusCode: res.statusCode,
            headers: {
                'content-type': res.getHeader('content-type'),
                'content-length': res.getHeader('content-length')
            }
        }),
        err: pino.stdSerializers.err
    },

    // Don't log health check endpoints (reduce noise)
    autoLogging: {
        ignore: (req) => {
            return req.url === '/healthz' ||
                   req.url === '/health' ||
                   req.url === '/readyz';
        }
    }
});

/**
 * Create child logger with additional context
 * Useful for service-specific logging
 *
 * @example
 * const dbLogger = createChildLogger({ service: 'mongodb' });
 * dbLogger.info({ query: 'find()' }, 'Database query executed');
 */
export function createChildLogger(bindings: Record<string, any>) {
    return logger.child(bindings);
}

/**
 * Log performance metrics
 */
export function logPerformance(operation: string, durationMs: number, metadata?: Record<string, any>) {
    logger.info({
        operation,
        duration_ms: durationMs,
        ...metadata
    }, `Performance: ${operation} completed in ${durationMs}ms`);
}

/**
 * Log API calls with retry information
 */
export function logApiCall(
    service: string,
    endpoint: string,
    method: string,
    statusCode?: number,
    durationMs?: number,
    attempt?: number
) {
    const logData: Record<string, any> = {
        service,
        endpoint,
        method,
        status_code: statusCode,
        duration_ms: durationMs,
        attempt
    };

    if (statusCode && statusCode >= 500) {
        logger.error(logData, `API call failed: ${method} ${endpoint}`);
    } else if (statusCode && statusCode >= 400) {
        logger.warn(logData, `API call error: ${method} ${endpoint}`);
    } else {
        logger.info(logData, `API call: ${method} ${endpoint}`);
    }
}

/**
 * Log business events (trips, alerts, etc.)
 */
export function logBusinessEvent(event: string, data: Record<string, any>) {
    logger.info({
        event_type: 'business',
        event_name: event,
        ...data
    }, `Business event: ${event}`);
}

// Export default logger
export default logger;
