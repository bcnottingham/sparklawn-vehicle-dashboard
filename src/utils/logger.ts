import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import fs from 'fs';

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

const isDevelopment = process.env.NODE_ENV !== 'production';

// Custom format for pretty printing in development
const devFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.colorize(),
    winston.format.printf(({ level, message, timestamp, stack }) => {
        return `${timestamp} [${level}]: ${stack || message}`;
    })
);

// Production format
const prodFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
);

// Combined log transport with daily rotation
const combinedTransport = new DailyRotateFile({
    filename: path.join(logsDir, 'combined-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '10m',
    maxFiles: '7d',
    format: prodFormat,
    auditFile: path.join(logsDir, 'combined-audit.json'),
    zippedArchive: true
});

// Error log transport with daily rotation
const errorTransport = new DailyRotateFile({
    filename: path.join(logsDir, 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '10m',
    maxFiles: '7d',
    level: 'error',
    format: prodFormat,
    auditFile: path.join(logsDir, 'error-audit.json'),
    zippedArchive: true
});

// Create logger instance
const logger = winston.createLogger({
    level: isDevelopment ? 'debug' : 'info',
    format: prodFormat,
    transports: [
        combinedTransport,
        errorTransport
    ]
});

// Add console transport in development
if (isDevelopment) {
    logger.add(new winston.transports.Console({
        format: devFormat
    }));
} else {
    // In production, only add console for errors and warnings
    logger.add(new winston.transports.Console({
        level: 'warn',
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.simple()
        )
    }));
}

// Log rotation events
combinedTransport.on('rotate', (oldFilename, newFilename) => {
    logger.info(`Log file rotated: ${oldFilename} -> ${newFilename}`);
});

combinedTransport.on('archive', (zipFilename) => {
    logger.info(`Log file archived: ${zipFilename}`);
});

// Export logger and helper functions
export default logger;

// Helper function to reduce verbose logging in production
export const debugLog = (message: string, meta?: any) => {
    if (isDevelopment || process.env.DEBUG_LOGGING === 'true') {
        logger.debug(message, meta);
    }
};

// Performance logging helper
export const perfLog = (label: string, startTime?: number) => {
    if (isDevelopment) {
        const duration = startTime ? Date.now() - startTime : 0;
        logger.debug(`[PERF] ${label}${startTime ? ` took ${duration}ms` : ' started'}`);
        return Date.now();
    }
    return startTime || Date.now();
};