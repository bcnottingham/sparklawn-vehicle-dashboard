# Context for Claude Code Sessions

## Quick Reference - What's Working

### System Status (Last Updated: 2025-10-02)

**MongoDB Atlas**: `mongodb+srv://bc1414:***@sparklawn-cluster.evvvpal.mongodb.net/sparklawn-command-center`
- ✅ Connection string in `.env` file
- ✅ Database: `sparklawn-command-center`
- ⚠️ Check that backgroundMonitoringService is running and populating `route_points` collection

**Core Services**:
- ✅ Ford Telematics API integrated (client credentials in `.env`)
- ✅ Google Maps API for geocoding (key in `.env`)
- ✅ Client location matching (102 clients from sparklawn-website-manager/client-coordinates-cache.json)
- ✅ Google OAuth for login (@sparklawnnwa.com emails)

**Vehicle VINs**:
- Lightning 1: `1FTVW1EL3NWG00285`
- Lightning 2: `1FT6W1EV3PWG37779`
- Lightning XLT: `1FTVW1EV3NWG07402`
- eTransit: `1FTBW1XK6PKA30591`

---

## Critical Architecture - DO NOT CHANGE

### Trip Modal Data Flow (fleet-advanced.html)

**ENDPOINT (LINE 2153)**: `/api/trips/timeline/${vehicleId}`

**DO NOT CHANGE THIS!** The modal depends on a sophisticated backend pipeline:

```
Vehicle GPS (3s intervals)
    ↓
backgroundMonitoringService (src/services/backgroundMonitoringService.ts)
    ↓
For EACH GPS point:
  ├→ clientLocationService.findClientLocationMatch() [102 cached clients]
  │  └→ 5ft/10ft/15ft proximity matching with intelligent radii
  └→ geocodingService.getAddress() [Google Places API fallback]
    ↓
Stores in MongoDB route_points collection with:
  - GPS coordinates
  - address (from geocoding)
  - clientName (if at client location)
    ↓
/api/trips/timeline aggregates route_points into trips
    ↓
displayLinearTimeline() renders in modal
```

**Key Files - Never Touch Without Understanding**:
- `src/services/clientLocations.ts` - 102 client proximity matching
- `src/services/geocoding.ts` - Google Places API
- `src/services/backgroundMonitoringService.ts` - Real-time GPS enrichment
- `src/services/tripTimelineService.ts` - Trip aggregation
- `src/views/fleet-advanced.html` lines 2148-2910 - Modal logic

---

## Known Issues from Production Hardening Session

### Issues Created (2025-10-02):
1. ❌ **Destroyed `.env` file** during OAuth setup
   - **FIXED**: Restored from sparklawn-website-manager/.env
2. ❌ **Created 21+ zombie background bash processes**
   - **NOT FIXED**: Close terminal and restart to clean up
3. ⚠️ **MongoDB connection may have stopped**
   - **CHECK**: Verify backgroundMonitoringService is running
   - **CHECK**: Verify route_points collection is being populated

### What Got Fixed:
1. ✅ Production hardening phases 1-6 complete:
   - Health checks (/healthz, /readyz)
   - Graceful shutdown
   - Security middleware (Helmet + CORS)
   - API retry logic with exponential backoff
   - Structured logging with Pino
   - Request validation with Zod
2. ✅ Google OAuth authentication (@sparklawnnwa.com)
3. ✅ Mobile-first login page (56px tap targets)

---

## Starting Fresh in New Terminal

### Kill All Processes:
```bash
killall -9 node npm
ps aux | grep node  # Verify all killed
```

### Start Server:
```bash
cd /Users/billycourtney/GodMode/ford-location-dashboard
npm start
```

### Verify System Health:
```bash
# Check server is running
curl http://localhost:3002/healthz

# Check MongoDB connection
curl http://localhost:3002/readyz

# Check trip tracking is working
curl "http://localhost:3002/api/trips/timeline/1FTVW1EL3NWG00285" | jq '.timeline.trips[0]'
```

---

## Environment Variables (.env)

**NEVER DELETE THESE**:
- `MONGODB_URI` - MongoDB Atlas connection (trip tracking breaks without this)
- `FORD_TELEMATICS_CLIENT_ID` / `FORD_TELEMATICS_CLIENT_SECRET` - Ford API
- `GOOGLE_MAPS_API_KEY` - Geocoding (addresses won't appear without this)
- `LIGHTNING_VIN` / `LIGHTNING_2_VIN` / `LIGHTNING_XLT_VIN` / `ETRANSIT_VIN` - Vehicle tracking

**ADDED DURING PRODUCTION HARDENING**:
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` - OAuth login
- `JWT_SECRET` - Session management

---

## Common Commands

### Check MongoDB Collections:
```bash
# Check if trips are being captured
mongosh "mongodb+srv://bc1414:***@sparklawn-cluster.evvvpal.mongodb.net/sparklawn-command-center" --eval "db.route_points.countDocuments()"

# Check recent route points
mongosh "mongodb+srv://bc1414:***@sparklawn-cluster.evvvpal.mongodb.net/sparklawn-command-center" --eval "db.route_points.find().sort({timestamp:-1}).limit(5)"
```

### Check Server Logs:
```bash
# Watch logs in real-time
npm start | grep -E "(MongoDB|backgroundMonitoring|route_points|trip)"
```

### Test Endpoints:
```bash
# Health check
curl http://localhost:3002/healthz

# Get vehicle state
curl http://localhost:3002/api/vehicle-state | jq

# Get trip timeline
curl "http://localhost:3002/api/trips/timeline/1FTVW1EL3NWG00285" | jq '.timeline.trips | length'
```

---

## What to Tell Claude in New Session

Paste this into your first message:

```
Context: Working on SparkLawn Fleet Dashboard at /Users/billycourtney/GodMode/ford-location-dashboard

System uses:
- MongoDB Atlas for trip tracking (see CONTEXT_FOR_CLAUDE.md)
- Ford Telematics API for GPS data
- Google Maps API for geocoding
- backgroundMonitoringService enriches GPS with addresses/client names in real-time

Critical: Trip modal uses /api/trips/timeline endpoint - DO NOT CHANGE
See CONTEXT_FOR_CLAUDE.md for full architecture

Recent work: Production hardening phases 1-6 complete, OAuth authentication added
Known issues: See CONTEXT_FOR_CLAUDE.md
```

---

## Production Deployment Checklist

Before deploying to Render:

1. ✅ All `.env` variables configured
2. ✅ MongoDB Atlas connection tested
3. ✅ Health checks working (`/healthz`, `/readyz`)
4. ✅ OAuth redirect URLs updated for production domain
5. ✅ CORS `ALLOWED_ORIGINS` includes production URL
6. ⚠️ Test trip tracking is working (route_points being populated)
7. ⚠️ Test trip modal shows addresses and CLIENT badges
8. ⚠️ Test on mobile device (login, fleet view, trip modal)

---

Last Updated: 2025-10-02
