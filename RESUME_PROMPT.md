# Resume Prompt for Claude - SparkLawn Fleet Dashboard Production Hardening

Copy and paste this entire prompt to resume work:

---

You are my production-hardening SRE + QA pair for the SparkLawn Fleet dashboard & APIs.

**Context:** We're making the SparkLawn vehicle tracking system (Ford Pro API integration, MongoDB, Express/Node backend) production-ready for deployment to Render. The system tracks 4 Lightning trucks using Ford Telematics API and calculates trip timelines with client location matching.

**What We Accomplished Last Session (Oct 1, 2025):**

1. **Trip Detection Fixes (COMPLETED & WORKING):**
   - Changed trip detection from `isMoving` flag to GPS-based distance calculation (50m threshold)
   - Lowered minimum stop duration from 45s to 90s to eliminate 0-minute noise stops
   - Fixed StoneRidge Phase 2 client location (was 2.3km off, now centered correctly with 533m radius)
   - Client names now display instead of geocoded street addresses in trip endpoints

2. **Production Hardening Started (SAFE, NOT BREAKING):**
   - Created `.env.example` - template for all required environment variables
   - Installed production dependencies: `pino`, `helmet`, `cors`, `zod`, `express-rate-limit`
   - Added health check endpoints: `GET /healthz` (lightweight) and `GET /readyz` (deep checks)
   - Created `PRODUCTION_HARDENING_CHANGELOG.md` with detailed rollback instructions
   - All changes are ADDITIVE ONLY - existing code untouched and working

**Current System State:**
- Location: `/Users/billycourtney/GodMode/ford-location-dashboard`
- Server normally runs on PORT=3003
- MongoDB Atlas connection string in `.env` (DO NOT COMMIT)
- ~13 zombie Node processes from testing (MUST KILL before starting)
- TypeScript builds successfully (some pre-existing warnings in other files, ignore them)
- Health endpoints wired into `src/server.ts` but NOT TESTED yet due to zombie processes

**Critical Files Modified:**
- `src/services/tripTimelineService.ts` - Lines 299-300, 358-359 (45s → 90s thresholds)
- `src/server.ts` - Added `import healthRouter from './routes/health'` and route registration
- `src/routes/health.ts` - NEW FILE (health check endpoints)
- `.env.example` - NEW FILE (environment variable template)
- `PRODUCTION_HARDENING_CHANGELOG.md` - NEW FILE (change log with rollbacks)
- `SESSION_STATUS.md` - NEW FILE (session status and next steps)
- `package.json` - Added production dependencies (pino, helmet, cors, zod, express-rate-limit)

**Known Issues to Fix Immediately:**
1. **13+ zombie Node processes** - Run `killall -9 node` before starting any work
2. **Dependencies installed but not wired** - pino, helmet, cors are installed but not active in code yet
3. **Health endpoints not tested** - Need to start clean server and test `/healthz` and `/readyz`

**NEXT STEPS (Priority Order):**

**Phase 1: Clean Up & Test Health Endpoints (10 minutes)**
```bash
# Kill zombie processes
killall -9 node

# Rebuild
npm run build

# Start clean server
PORT=3003 npm start

# Test health endpoints
curl http://localhost:3003/healthz
curl http://localhost:3003/readyz
```

**Phase 2: Wire Security Middleware (15 minutes - SAFE, NON-BREAKING)**
Add to `src/server.ts` (after line 30, before existing middleware):
```typescript
import helmet from 'helmet';
import cors from 'cors';

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // Allow inline scripts for dashboard
}));

// CORS configuration
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true
}));
```

**Phase 3: Add Retry Logic for Ford API (30 minutes)**
Create `src/utils/retryWithBackoff.ts`:
- Exponential backoff (1s, 2s, 4s, 8s)
- Retry on 429 (rate limit) and 5xx errors
- Max 3 retries
- Add jitter to prevent thundering herd

**Phase 4: Add Structured Logging (20 minutes)**
Create `src/utils/logger-pino.ts`:
- Replace console.log with pino structured logging
- Add correlation IDs (request ID tracking)
- Redact secrets from logs (MONGODB_URI, API keys)

**Phase 5: Add Request Validation (30 minutes)**
Create zod schemas for all route inputs to prevent malformed data corruption

**Important Constraints:**
- **DO NOT BREAK EXISTING FUNCTIONALITY** - All changes must be additive or wrapped
- **TEST AFTER EVERY CHANGE** - Verify `curl http://localhost:3003/api/trips/timeline/1FTVW1EL3NWG00285` still works
- **INCREMENTAL ONLY** - Small PRs, ≤300 LOC per change
- **ROLLBACK PLAN REQUIRED** - Document how to undo every change
- **TIMEZONE: America/Chicago** - All trip calculations use CST/CDT

**Environment Variables Required (see `.env.example`):**
- MONGODB_URI (Atlas connection string)
- FORD_TELEMATICS_CLIENT_ID, FORD_TELEMATICS_CLIENT_SECRET
- 4 VINs: LIGHTNING_VIN, LIGHTNING_PRO_VIN, LIGHTNING_XLT_VIN, LIGHTNING_2_VIN
- GOOGLE_MAPS_API_KEY
- JOBBER_CLIENT_ID, JOBBER_CLIENT_SECRET, JOBBER_ACCESS_TOKEN, JOBBER_REFRESH_TOKEN
- PORT (default 3002, testing on 3003)

**Testing Commands:**
```bash
# Check zombie processes
ps aux | grep node

# Test health
curl http://localhost:3003/healthz
curl http://localhost:3003/readyz

# Test trip timeline (Lightning 1 - VIN ending in 00285)
curl http://localhost:3003/api/trips/timeline/1FTVW1EL3NWG00285

# Check logs
tail -f logs/combined.log
```

**Files to Reference:**
- `SESSION_STATUS.md` - Complete session status and context
- `PRODUCTION_HARDENING_CHANGELOG.md` - Detailed change log with rollback commands
- `.env.example` - All required environment variables

**Your Mission:**
Continue production-hardening the SparkLawn Fleet Dashboard for Render deployment. Start with Phase 1 (clean up zombie processes and test health endpoints), then proceed systematically through Phases 2-5. Be decisive, test after every change, document rollback plans, and maintain the working trip detection logic we fixed.

**Key System Details:**
- Stack: Node 18+, Express 4.17, TypeScript 4.1, MongoDB 6.10, Mongoose 8.8
- APIs: Ford Pro Telematics API, Google Maps Geocoding API, Jobber API
- 4 Lightning trucks tracked: VINs ending in 37779, 30591, 07402, 00285
- Trip detection: GPS-based (50m threshold), 90s minimum stop duration
- Client locations: 103+ cached with match radius (55m-2500m depending on property size)
- Timezone: America/Chicago (handles DST transitions for trip calculations)

Let's make this bulletproof for production. Start with Phase 1 - kill zombies and test health endpoints.
