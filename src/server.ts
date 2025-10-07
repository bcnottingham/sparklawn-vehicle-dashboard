import express from 'express';
import bodyParser from 'body-parser';
import compression from 'compression';
import helmet from 'helmet';
import cors from 'cors';
import passport from 'passport';
import cookieParser from 'cookie-parser';
import path from 'path';
import dotenv from 'dotenv';
import logger, { debugLog } from './utils/logger';

// Load .env from project root (works in both dev and production)
dotenv.config({ path: path.join(__dirname, '../.env') });
import mongoose from 'mongoose';
import vehiclesRouter from './routes/vehicles';
import diagnosticsRouter from './routes/diagnostics';
import geofencingRouter from './routes/geofencing';
import authRouter from './routes/auth';
import tripsRouter from './routes/trips';
import ignitionTripsRouter from './routes/ignitionTrips';
import productivityRouter from './routes/productivity';
import tripReconstructionRouter from './routes/tripReconstruction';
import parkingDetectionRouter from './routes/parkingDetection';
import configRouter from './routes/config';
import testGeocodingRouter from './routes/testGeocoding';
import chargingHistoryRouter from './routes/chargingHistory';
import vehicleStateRouter from './routes/vehicleState';
import canonicalVehicleStateRouter from './routes/canonicalVehicleState';
import fordAccurateTripsRouter from './routes/fordAccurateTrips';
import clientManagementRouter from './routes/clientManagement';
import healthRouter from './routes/health';
import pdfRouter from './routes/pdf';
import googleAuthRouter from './routes/googleAuth';
import invoicesRouter from './routes/invoices';
import gmailAuthRouter from './routes/gmailAuth';
import { requireAuth, redirectIfAuthenticated } from './middleware/auth';
import { connectToDatabase } from './db/index';
import { tokenManager } from './services/tokenManager';
import { backgroundMonitoringService } from './services/backgroundMonitoringService';
import { storageCleanupService } from './services/storageCleanupService';

const app = express();
const PORT = parseInt(process.env.PORT || '3000');

// Rate limiting middleware
const rateLimit = {
  windowMs: 60 * 1000, // 1 minute
  requests: new Map(),
  
  middleware: (req: any, res: any, next: any) => {
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const windowStart = now - rateLimit.windowMs;
    
    // Clean old entries
    for (const [ip, timestamps] of rateLimit.requests.entries()) {
      const validTimestamps = timestamps.filter((t: number) => t > windowStart);
      if (validTimestamps.length === 0) {
        rateLimit.requests.delete(ip);
      } else {
        rateLimit.requests.set(ip, validTimestamps);
      }
    }
    
    // Check current IP
    const clientRequests = rateLimit.requests.get(clientIP) || [];
    const recentRequests = clientRequests.filter((t: number) => t > windowStart);
    
    // API endpoints have reasonable limits for real-time dashboard
    const isAPIEndpoint = req.path.startsWith('/api/vehicles') || req.path.startsWith('/api/') || req.path.startsWith('/auth');
    const limit = isAPIEndpoint ? 300 : 500; // 300 API calls or 500 regular requests per minute
    
    if (recentRequests.length >= limit) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        details: `Maximum ${limit} requests per minute allowed`,
        retryAfter: Math.ceil((Math.min(...recentRequests) + rateLimit.windowMs - now) / 1000)
      });
    }
    
    // Add current request
    recentRequests.push(now);
    rateLimit.requests.set(clientIP, recentRequests);
    
    next();
  }
};

// Security Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", "https://maps.googleapis.com", "https://cdn.jsdelivr.net"],
      scriptSrcAttr: ["'unsafe-inline'", "'unsafe-hashes'"], // Allow inline event handlers (onclick, etc.)
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https://maps.googleapis.com", "https://api.fordpro.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      frameSrc: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false // Required for Google Maps
}));

// CORS Configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003'
];

app.use(cors({
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (mobile apps, curl, postman)
    if (!origin) return callback(null, true);

    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Middleware
app.use(compression()); // Enable gzip compression
app.use(cookieParser()); // Parse cookies for JWT auth
app.use(passport.initialize()); // Initialize Passport for OAuth
app.use(rateLimit.middleware);
app.use(bodyParser.json());

// Cache-busting middleware for API endpoints
app.use('/api', (req, res, next) => {
    res.set({
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Surrogate-Control': 'no-store',
        'ETag': Date.now().toString() // Simple etag based on current time
    });
    next();
});

app.use(express.static('src/public'));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/reports', express.static(path.join(__dirname, '../public/reports')));

// Authentication Pages (Mobile-First)
app.get('/login', redirectIfAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, '../src/views/login.html'));
});

app.get('/unauthorized', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/views/unauthorized.html'));
});

// Redirect main dashboard to fleet-advanced (no more leaflet maps)
app.get('/', requireAuth, (req, res) => {
    res.redirect('/fleet-advanced');
});

// Serve the fleet-advanced dashboard with corrected calculations
app.get('/fleet-advanced', requireAuth, (req, res) => {
    // Add ultra-aggressive cache-busting headers to force reload
    const timestamp = Date.now().toString();
    res.set({
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Surrogate-Control': 'no-store',
        'ETag': `"pure-logic-${timestamp}"`,
        'Last-Modified': new Date().toUTCString(),
        'Vary': 'Accept-Encoding, User-Agent'
    });
    res.sendFile(path.join(__dirname, '../src/views/fleet-advanced.html'));
});

// New cache-bypass route with timestamp
app.get('/fleet-v4', (req, res) => {
    const timestamp = Date.now().toString();
    res.set({
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Surrogate-Control': 'no-store',
        'ETag': `"cache-bypass-${timestamp}"`,
        'Last-Modified': new Date().toUTCString(),
        'Vary': '*'
    });
    res.sendFile(path.join(__dirname, '../src/views/fleet-advanced.html'));
});

// Serve the fleet-advanced dashboard as the ONLY UI
app.get('/fleet-advanced-fixed', (req, res) => {
    // Add cache-busting headers to force reload
    res.set({
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Surrogate-Control': 'no-store'
    });
    res.sendFile(path.join(__dirname, '../src/views/fleet-advanced.html'));
});

// Serve the trip analytics dashboard (real data version)
app.get('/trips', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '../src/views/trips-real.html'));
});

// Client management interface
app.get('/client-management', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '../src/views/client-management.html'));
});

// Invoice management interface
app.get('/invoices', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '../src/views/invoices.html'));
});

// Daily report preview
app.get('/daily-report-preview', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '../src/views/daily-report-preview.html'));
});

// Trip modal preview (for design experimentation)
app.get('/trip-modal-preview', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '../src/views/trip-modal-preview.html'));
});

// Legacy trip analytics (mock data version)
app.get('/trips-legacy', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/views/trips.html'));
});

// Test route for new trips page
app.get('/trips-new', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/views/trips-new.html'));
});

// Serve the detailed trip timeline visualization
app.get('/trip-timeline', (req, res) => {
    res.sendFile(path.join(__dirname, '../src/views/trip-timeline.html'));
});

// Health check endpoint for monitoring
app.get('/health', async (req, res) => {
    const healthStatus = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        services: {
            tokenManager: 'unknown',
            backgroundMonitoring: 'unknown',
            database: 'unknown'
        }
    };

    try {
        // Check token manager - simplified check
        healthStatus.services.tokenManager = tokenManager ? 'healthy' : 'error';
    } catch (error) {
        healthStatus.services.tokenManager = 'error';
    }

    try {
        // Check background monitoring service - simplified check
        healthStatus.services.backgroundMonitoring = backgroundMonitoringService ? 'healthy' : 'error';
    } catch (error) {
        healthStatus.services.backgroundMonitoring = 'error';
    }

    try {
        // Check database connection
        const { getDatabase } = await import('./db/index');
        const db = await getDatabase();
        await db.admin().ping();
        healthStatus.services.database = 'healthy';
    } catch (error) {
        healthStatus.services.database = 'error';
        healthStatus.status = 'degraded';
    }

    // Determine overall health
    const servicesHealthy = Object.values(healthStatus.services).every(status => status === 'healthy' || status === 'unknown');
    if (!servicesHealthy) {
        healthStatus.status = 'degraded';
    }

    // Return appropriate HTTP status
    const httpStatus = healthStatus.status === 'healthy' ? 200 : 503;
    res.status(httpStatus).json(healthStatus);
});

// Authentication Routes (Before API to avoid middleware conflicts)
app.use('/auth', googleAuthRouter);

// API Routes (Protected by requireAuth in individual routes as needed)
app.use('/api/vehicles', vehiclesRouter);
app.use('/api/vehicles', chargingHistoryRouter); // Charging history endpoints
app.use('/api/diagnostics', diagnosticsRouter);
app.use('/api/geofencing', geofencingRouter);
app.use('/api/trips', tripsRouter);
app.use('/api/ignition-trips', ignitionTripsRouter); // Enhanced trip tracking
app.use('/api/productivity', productivityRouter); // Productivity analysis & reporting
app.use('/api/trip-reconstruction', tripReconstructionRouter); // Missed trip recovery
app.use('/api/parking-detection', parkingDetectionRouter); // Parking status & analysis
app.use('/api/config', configRouter); // Configuration endpoints
app.use('/api/test', testGeocodingRouter); // Test endpoints
app.use('/api/vehicle-state', canonicalVehicleStateRouter); // Canonical vehicle state from MongoDB
app.use('/api/vehicle-state-legacy', vehicleStateRouter); // Legacy vehicle state API
app.use('/api/ford-accurate-trips', fordAccurateTripsRouter); // Ford API accurate trip distances
app.use('/api/clients', clientManagementRouter); // Client location management
app.use('/api/pdf', pdfRouter); // PDF generation and Slack integration
app.use('/api/invoices', invoicesRouter); // Subcontractor invoice management
app.use('/gmail-auth', gmailAuthRouter); // Gmail OAuth for invoice extraction
app.use('/', healthRouter); // Health check endpoints (no /api prefix for load balancers)
app.use('/auth', authRouter); // Keep auth at root for OAuth callbacks

// Start server with automatic token management
async function startServer() {
  // CRITICAL: Start HTTP server FIRST before any MongoDB operations
  // This ensures health checks work even if MongoDB is down
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌱 SparkLawn Vehicle Dashboard running on:`);
    console.log(`   Local:    http://localhost:${PORT}`);
    console.log(`   Network:  http://0.0.0.0:${PORT}`);
    console.log(`   Share this URL with your business partner!`);
    console.log(`\n🔄 Initializing background services...`);
  });

  // Now initialize MongoDB-dependent services in the background
  // Server is already listening and can respond to health checks
  let tokenManagerEnabled = false;

  try {
    // Initialize Mongoose connection for Invoice schema
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI not configured');
    }
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 30000
    });
    console.log('✅ Mongoose connected for Invoice management');
  } catch (error) {
    console.error('⚠️ Mongoose connection failed:', error);
  }

  try {
    // Try to initialize automatic token management with MongoDB
    await tokenManager.initialize();
    tokenManagerEnabled = true;
    console.log('✅ MongoDB token manager initialized successfully');
  } catch (error) {
    console.error('⚠️ MongoDB token manager failed to initialize:', error);
    console.log('🔄 Continuing with environment variable fallback...');
  }

  try {
    // Initialize background monitoring service with MongoDB
    await backgroundMonitoringService.initialize();
    console.log('✅ Background monitoring service initialized successfully');
  } catch (error) {
    console.error('⚠️ Background monitoring service failed to initialize:', error);
  }

  try {
    // Initialize automatic storage cleanup service
    await storageCleanupService.startAutomaticCleanup();
    console.log('✅ Automatic storage cleanup service initialized successfully');
  } catch (error) {
    console.error('⚠️ Storage cleanup service failed to initialize:', error);
  }

  // Log final status after all background services attempted
  if (tokenManagerEnabled) {
    console.log(`✅ Automatic token refresh: ENABLED`);
    console.log(`🔄 Refreshes every 90 minutes automatically`);
  } else {
    console.log(`⚠️ Automatic token refresh: DISABLED (using env vars)`);
    console.log(`📝 Check MongoDB connection and environment variables`);
  }

  try {
    // One-time fix for address capitalization on startup
    const fs = await import('fs');
    const path = await import('path');
    const CACHE_FILE_PATH = path.join(__dirname, '../../../sparklawn-website-manager/client-coordinates-cache.json');

    if (fs.existsSync(CACHE_FILE_PATH)) {
      const cacheData = JSON.parse(fs.readFileSync(CACHE_FILE_PATH, 'utf8'));
      let fixedCount = 0;

      // Function to properly capitalize addresses
      function formatAddress(address: string): string {
        if (!address || typeof address !== 'string') return address;

        const lowerCaseWords = ['and', 'or', 'the', 'a', 'an', 'in', 'on', 'at', 'by', 'for', 'of', 'to', 'up', 'as', 'but', 'is', 'are', 'was', 'were'];
        const upperCaseWords = ['st', 'ave', 'dr', 'rd', 'blvd', 'ln', 'ct', 'pl', 'way', 'pkwy', 'hwy', 'apt', 'suite', 'ste', 'unit', 'bldg', 'fl', 'po', 'box', 'ar', 'usa', 'us'];

        return address.toLowerCase().split(' ').map((word, index) => {
          const cleanWord = word.replace(/[^\w]/g, '');

          if (index === 0) {
            return word.charAt(0).toUpperCase() + word.slice(1);
          }

          if (upperCaseWords.includes(cleanWord.toLowerCase())) {
            return word.replace(cleanWord, cleanWord.toUpperCase());
          }

          // Convert "arkansas" to "AR"
          if (cleanWord.toLowerCase() === 'arkansas') {
            return word.replace(cleanWord, 'AR');
          }

          if (lowerCaseWords.includes(cleanWord.toLowerCase())) {
            return word;
          }

          if (/^\d+(st|nd|rd|th)$/i.test(cleanWord)) {
            return word.toLowerCase();
          }

          return word.charAt(0).toUpperCase() + word.slice(1);
        }).join(' ');
      }

      // Fix all addresses
      const newCacheData: any = {};
      for (const [address, client] of Object.entries(cacheData)) {
        const formattedAddress = formatAddress(address);

        if (formattedAddress !== address) {
          newCacheData[formattedAddress.toLowerCase().trim()] = {
            ...(client as any),
            lastUpdated: new Date().toISOString()
          };
          fixedCount++;
          console.log(`🔧 Fixed address: "${address}" → "${formattedAddress}"`);
        } else {
          newCacheData[address] = client;
        }
      }

      if (fixedCount > 0) {
        fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(newCacheData, null, 2));
        console.log(`✅ Fixed ${fixedCount} client addresses with proper capitalization on startup`);
      } else {
        console.log('✅ All client addresses already properly formatted');
      }
    }
  } catch (error) {
    console.error('⚠️ Failed to fix address capitalization:', error);
  }

  // Start background vehicle monitoring after all services initialized
  console.log(`🔄 Background vehicle monitoring: RESTARTING (Basic mode)`);
  console.log(`📊 Will collect current vehicle state for dashboard accuracy`);
  console.log(`💡 Route collection will be verified after restart`);
  try {
    backgroundMonitoringService.startMonitoring();
    console.log(`✅ Background vehicle monitoring: ENABLED`);
    console.log(`⏰ Smart monitoring: 5 seconds during business hours (6am-9pm CST), 10 minutes off-hours`);
    console.log(`📊 Tracks detailed trip logs with client correlation`);
  } catch (error) {
    console.error(`❌ Background monitoring failed to start:`, error);
  }

  // Start scheduled invoice extraction
  try {
    const { scheduledInvoiceExtraction } = await import('./services/scheduledInvoiceExtraction');
    scheduledInvoiceExtraction.startDailyExtraction();
    console.log(`✅ Scheduled invoice extraction: ENABLED`);
    console.log(`📅 Daily extraction at 2:00 AM for new invoices/receipts`);
  } catch (error) {
    console.error(`❌ Scheduled invoice extraction failed to start:`, error);
  }

  // Start daily Slack report scheduler
  try {
    const { dailySlackReportScheduler } = await import('./services/dailySlackReportScheduler');
    const { dailyReportsService } = await import('./services/dailyReportsService');

    // Initialize daily reports service first
    await dailyReportsService.initialize();

    // Start scheduler
    dailySlackReportScheduler.start();

    // Test endpoint to manually trigger a Slack report
    app.post('/api/slack/test-report', async (req, res) => {
      try {
        const date = req.body.date || undefined; // Optional date parameter
        await dailySlackReportScheduler.sendDailyReport(date);
        res.json({ success: true, message: 'Daily report sent to Slack' });
      } catch (error) {
        console.error('Error sending test Slack report:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to send Slack report',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });
  } catch (error) {
    console.error(`❌ Daily Slack report scheduler failed to start:`, error);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await backgroundMonitoringService.close();
  await storageCleanupService.stopAutomaticCleanup();
  await tokenManager.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await backgroundMonitoringService.close();
  await storageCleanupService.stopAutomaticCleanup();
  await tokenManager.close();
  process.exit(0);
});

startServer();

// Database connection (disabled for testing)
// connectToDatabase()
//   .then(() => {
//     app.listen(PORT, () => {
//       console.log(`Server is running on http://localhost:${PORT}`);
//     });
//   })
//   .catch(err => {
//     console.error('Database connection failed:', err);
//   });