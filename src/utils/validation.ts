import { Request, Response, NextFunction } from 'express';
import { z, ZodError, ZodSchema } from 'zod';

/**
 * Request validation middleware using Zod schemas
 * Validates request body, query params, and route params
 */

export interface ValidationSchemas {
    body?: ZodSchema;
    query?: ZodSchema;
    params?: ZodSchema;
}

/**
 * Create validation middleware for Express routes
 *
 * @example
 * router.post('/trips',
 *   validate({ body: CreateTripSchema }),
 *   async (req, res) => { ... }
 * );
 */
export function validate(schemas: ValidationSchemas) {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            // Validate request body
            if (schemas.body) {
                req.body = await schemas.body.parseAsync(req.body);
            }

            // Validate query parameters
            if (schemas.query) {
                req.query = await schemas.query.parseAsync(req.query);
            }

            // Validate route parameters
            if (schemas.params) {
                req.params = await schemas.params.parseAsync(req.params);
            }

            next();
        } catch (error) {
            if (error instanceof ZodError) {
                return res.status(400).json({
                    error: 'Validation failed',
                    details: error.errors.map(err => ({
                        path: err.path.join('.'),
                        message: err.message,
                        code: err.code
                    }))
                });
            }

            next(error);
        }
    };
}

/**
 * Common validation schemas
 */

// Vehicle ID validation
export const VehicleIdSchema = z.object({
    vehicleId: z.string().min(1, 'Vehicle ID is required')
});

// VIN validation (17 characters)
export const VINSchema = z.string()
    .length(17, 'VIN must be exactly 17 characters')
    .regex(/^[A-HJ-NPR-Z0-9]{17}$/, 'Invalid VIN format');

// Date range validation
export const DateRangeSchema = z.object({
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional()
}).refine(
    (data) => {
        if (data.startDate && data.endDate) {
            return new Date(data.startDate) <= new Date(data.endDate);
        }
        return true;
    },
    {
        message: 'End date must be after start date'
    }
);

// Pagination validation
export const PaginationSchema = z.object({
    page: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().min(1)).optional().default('1'),
    limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().min(1).max(1000)).optional().default('50')
});

// Trip ID validation
export const TripIdSchema = z.object({
    tripId: z.string().min(1, 'Trip ID is required')
});

// Trip creation validation
export const CreateTripSchema = z.object({
    vehicleId: z.string().min(1),
    startTime: z.string().datetime(),
    endTime: z.string().datetime().optional(),
    startLocation: z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        address: z.string().optional()
    }),
    endLocation: z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        address: z.string().optional()
    }).optional()
});

// Location validation
export const LocationSchema = z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180)
});

// Client creation validation (for client management)
export const CreateClientSchema = z.object({
    name: z.string().min(1, 'Client name is required'),
    address: z.string().min(1, 'Address is required'),
    location: LocationSchema.optional(),
    phone: z.string().optional(),
    email: z.string().email().optional(),
    notes: z.string().optional()
});

// PDF generation validation
export const PDFGenerationSchema = z.object({
    download: z.enum(['true', 'false']).optional(),
    slack: z.enum(['true', 'false']).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional()
});

// Slack test validation
export const SlackTestSchema = z.object({
    message: z.string().max(1000).optional()
});

/**
 * Sanitize user input to prevent injection attacks
 */
export function sanitizeInput(input: string): string {
    return input
        .replace(/[<>]/g, '') // Remove angle brackets
        .replace(/javascript:/gi, '') // Remove javascript: protocol
        .replace(/on\w+\s*=/gi, '') // Remove event handlers
        .trim();
}

/**
 * Validate and sanitize MongoDB ObjectId
 */
export function validateObjectId(id: string): boolean {
    return /^[0-9a-fA-F]{24}$/.test(id);
}

/**
 * Parse and validate ISO date string
 */
export function parseISODate(dateString: string): Date {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
        throw new Error(`Invalid date format: ${dateString}`);
    }
    return date;
}

/**
 * Safe parseInt with validation
 */
export function safeParseInt(value: string | undefined, defaultValue: number = 0): number {
    if (!value) return defaultValue;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Safe parseFloat with validation
 */
export function safeParseFloat(value: string | undefined, defaultValue: number = 0): number {
    if (!value) return defaultValue;
    const parsed = parseFloat(value);
    return isNaN(parsed) ? defaultValue : parsed;
}

export default validate;
