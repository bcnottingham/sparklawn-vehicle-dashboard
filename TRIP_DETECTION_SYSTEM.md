# Trip Detection System - Technical Documentation

## Overview
Enterprise fleet management system that tracks vehicle movements, identifies client visits, and calculates accurate trip durations using movement-based detection.

**North Star**: Track where vehicles go and how long they stay there - accurately.

---

## Architecture Overview

```
Ford Telematics API (every 2-3 seconds)
    ↓
Background Monitoring Service (collects GPS data)
    ↓
MongoDB (stores route_points with isMoving flag)
    ↓
Trip Timeline Service (aggregates into trips & stops)
    ↓
Client Location Matching → Google Places API → Reverse Geocoding
    ↓
Frontend Dashboard (displays trips/stops with client names)
```

---

## Core Components

### 1. Background Monitoring Service
**File**: `/src/services/backgroundMonitoringService.ts`

**Purpose**: Continuously polls Ford Telematics API and stores GPS data

**Key Functions**:
- `monitorVehicle(vehicleId)` - Main polling loop (runs every 2-3 seconds)
- `detectMovement(vehicleId, currentLocation)` - Sets `isMoving` flag
  - Compares current GPS to previous GPS
  - Returns `true` if moved > 15m (GPS_ACCURACY_BUFFER)
  - Returns `false` if stationary
- `detectGpsBasedParking()` - Overrides Ford ignition status if vehicle stationary

**Database Collection**: `route_points`
```typescript
{
  vehicleId: string,
  timestamp: Date,
  latitude: number,
  longitude: number,
  batteryLevel: number,
  ignitionStatus: 'On' | 'Off',
  address: string,
  isMoving: boolean,  // ← CRITICAL for trip detection
  dataSource: 'ford-telematics' | 'geofence-departure'
}
```

**Important Constants**:
- `GPS_ACCURACY_BUFFER = 15` meters - minimum movement to consider "moving"
- `MIN_MOVEMENT_THRESHOLD = 10` meters

---

### 2. Trip Timeline Service
**File**: `/src/services/tripTimelineService.ts`

**Purpose**: Aggregates raw GPS points into discrete trips and stops

#### Core Algorithm: `aggregateEventsIntoTrips()` (Lines 288-399)

**Movement-Based Detection Logic**:

```typescript
// TRIP START: When vehicle starts moving
if (point.isMoving) {
  currentTripStart = point;
  // Begin collecting points for this trip
}

// TRIP END: When vehicle stops and STAYS stopped
if (!point.isMoving) {
  // Scan forward to confirm vehicle stays within 100m for 2+ minutes
  // If confirmed stationary → END TRIP
  // Jump ahead past all stationary points
  // Reset for next trip
}
```

**Key Constants**:
- `STATIONARY_RADIUS = 0.1` km (100 meters) - defines a "location"
- `MIN_STOP_DURATION = 2` minutes - distinguishes real stops from traffic lights

**Trip Continuity Logic** (Lines 381-396):
```typescript
// Make Trip 2 start where Trip 1 ended
// Eliminates GPS drift gaps between consecutive trips
currentTrip.startLocation = previousTrip.endLocation;
```

#### Stop Generation: `generateStopsBetweenTrips()` (Lines 545-594)

**Logic**: Stops are the gaps BETWEEN trips
```typescript
// For each trip:
stopStart = currentTrip.endTime;
stopEnd = nextTrip.startTime;  // or last GPS point if final stop
duration = (stopEnd - stopStart) / 60000;  // milliseconds to minutes

// Skip mid-day returns to home base
if (isHomeBase && nextTrip) continue;
```

#### Location Enrichment: `createTripFromPoints()` (Lines 406-470)

**Location Intelligence Chain** (executed in parallel):
1. **Client Location Match** via `getCachedLocationMatch(lat, lng)`
   - Checks if coordinates within 100m of known client
   - Returns client name if matched
2. **Google Places API Fallback** via `geocodingService.getAddress(lat, lng)`
   - Returns business name from Google
3. **Reverse Geocoding**
   - Returns street address as last resort

```typescript
const [startLocationMatch, endLocationMatch, startAddress, endAddress] = await Promise.all([
  this.getCachedLocationMatch(startPoint.latitude, startPoint.longitude),
  this.getCachedLocationMatch(endPoint.latitude, endPoint.longitude),
  geocodingService.getAddress(startPoint.latitude, startPoint.longitude),
  geocodingService.getAddress(endPoint.latitude, endPoint.longitude)
]);

// Priority: Client Name > Business Name > Street Address
const clientName = locationMatch?.type === 'client' ? locationMatch.name :
                   locationMatch?.type === 'home_base' ? `🏠 ${locationMatch.name}` : undefined;
```

---

### 3. Client Location Service
**File**: `/src/services/clientLocations.ts`

**Purpose**: Match GPS coordinates to client locations

**Data Source**: `/sparklawn-website-manager/client-coordinates-cache.json`

**Structure**:
```json
{
  "123 Main St, City, State": {
    "clientName": "Coler Crossing",
    "lat": 36.37427,
    "lng": -94.220826,
    "radius": 100
  }
}
```

**Key Function**: `findLocationMatch(latitude, longitude)`
- Calculates distance to all known clients
- Returns match if within radius (default 100m)
- Returns `{ type: 'client', name: 'Coler Crossing' }` or `{ type: 'home_base', name: 'McRay Shop' }` or `null`

**Home Base Definition** (Lines 32-40):
```typescript
{
  name: 'McRay Shop',
  lat: 36.183115,
  lng: -94.169488,
  radius: 200  // 200m for home base
}
```

---

### 4. Geocoding Service
**File**: `/src/services/geocoding.ts`

**Purpose**: Reverse geocode coordinates to addresses/business names

**Function**: `getAddress(latitude, longitude)`
- Calls Google Maps Geocoding API
- Caches results in `/geocoding-cache.json` (6,775+ entries)
- Returns business name or street address

**Cache Structure**:
```json
[
  ["36.374270,-94.220826", "ACCO Brands Corporation"],
  ["36.183115,-94.169488", "McRay Shop"]
]
```

---

## API Endpoints

### Primary Timeline Endpoint
**GET** `/api/trips/timeline/:vehicleId`

**File**: `/src/routes/ignitionTrips.ts` (Lines ~200-250)

**Query Parameters**:
- `date` (optional) - defaults to today

**Response Structure**:
```json
{
  "success": true,
  "timeline": {
    "vehicleId": "1FTVW1EV3NWG07402",
    "vehicleName": "Lightning 3",
    "date": "2025-10-03",
    "trips": [
      {
        "id": "trip_...",
        "startTime": "2025-10-03T13:28:43.749Z",
        "endTime": "2025-10-03T14:38:46.233Z",
        "startLocation": {
          "latitude": 36.183151,
          "longitude": -94.169547,
          "address": "🏠 McRay Shop",
          "clientName": "🏠 McRay Shop",
          "batteryLevel": 88.5
        },
        "endLocation": {
          "latitude": 36.374270,
          "longitude": -94.220826,
          "address": "Coler Crossing",
          "clientName": "Coler Crossing",
          "batteryLevel": 74
        },
        "distance": 33.51,  // km
        "duration": 70,     // minutes
        "batteryUsed": 14.5,
        "avgSpeed": 46.2,   // km/h
        "route": [ /* array of route_points */ ]
      }
    ],
    "stops": [
      {
        "id": "stop_...",
        "startTime": "2025-10-03T14:38:46.233Z",
        "endTime": "2025-10-03T15:07:17.425Z",
        "location": {
          "latitude": 36.374270,
          "longitude": -94.220826,
          "address": "Coler Crossing",
          "clientName": "Coler Crossing",
          "batteryLevel": 68.5
        },
        "duration": 305,  // minutes
        "type": "client_visit" | "service_stop" | "unknown_stop"
      }
    ],
    "summary": {
      "totalDistance": 50.2,
      "totalDuration": 375,
      "clientVisits": 1,
      "routePoints": [ /* all GPS points for the day */ ]
    }
  }
}
```

---

## Data Flow: From GPS to Trip

### Step 1: Data Collection (Every 2-3 Seconds)
```
Ford API → backgroundMonitoringService.monitorVehicle()
         → detectMovement() sets isMoving flag
         → route_points collection
```

### Step 2: Trip Aggregation (On API Request)
```
GET /api/trips/timeline/:vehicleId
  ↓
tripTimelineService.getTimelineForPeriod()
  ↓
Query route_points for date range
  ↓
aggregateEventsIntoTrips()
  - Scan through points
  - Start trip when isMoving = true
  - End trip when stationary for 2+ min
  - Apply continuity logic
  ↓
createTripFromPoints()
  - Calculate distance, duration, battery
  - Parallel location enrichment:
    * Client location match
    * Google Places API
    * Reverse geocoding
  ↓
Returns Trip objects with enriched locations
```

### Step 3: Stop Generation
```
generateStopsBetweenTrips()
  ↓
For each gap between trips:
  - stopStart = trip[i].endTime
  - stopEnd = trip[i+1].startTime
  - Check if client location
  - Skip mid-day home base returns
  ↓
Returns Stop objects
```

---

## Frontend Integration

### Trip Modal Preview
**File**: `/src/views/trip-modal-preview.html`

**Key Code** (Lines 692-729):
```javascript
const response = await fetch(`/api/trips/timeline/${vehicleId}`);
const data = await response.json();
const trips = data.timeline?.trips || [];
const stops = data.timeline?.stops || [];

// Use stop.duration from API (not calculated)
const clientTime = stops
  .filter(v => v.isClient && !v.isHomeBase)
  .reduce((sum, v) => sum + v.dwellMinutes, 0);
```

### Fleet Advanced View
**File**: `/src/views/fleet-advanced.html`

Similar implementation - extracts trips and stops from API response

---

## MongoDB Collections

### route_points
**Purpose**: Raw GPS data from Ford API
**TTL**: 7 days
**Indexes**:
- `{ vehicleId: 1, timestamp: -1 }`
- `{ timestamp: 1 }` with TTL expiration

### vehicle_state
**Purpose**: Current canonical state of each vehicle
**Fields**:
- `state`: 'TRIP' | 'PARKED' | 'CHARGING'
- `stateSince`: timestamp when state began
- `lastSignalTs`: most recent GPS point

### trips (Legacy/Deprecated)
**Note**: The old `trips` collection from `ignitionTrips` is no longer used. Trip data is now generated on-demand from `route_points`.

---

## Configuration Files

### Client Locations Database
**Path**: `/sparklawn-website-manager/client-coordinates-cache.json`
**Updates**: Add new clients here with coordinates and radius
**Format**:
```json
{
  "Address String": {
    "clientName": "Client Name",
    "lat": 36.xxxxx,
    "lng": -94.xxxxx,
    "radius": 100
  }
}
```

### Environment Variables
**File**: `.env`
```bash
GOOGLE_MAPS_API_KEY=AIzaSy...
MONGODB_URI=mongodb://localhost:27017/ford-telematics
TZ=America/Chicago  # Important for timezone handling
```

---

## Key Algorithms Explained

### Movement Detection
```typescript
// backgroundMonitoringService.ts:434-453
private detectMovement(vehicleId, currentLocation): boolean {
  const previousLocation = this.vehicleStates.get(vehicleId);
  if (!previousLocation) return false;

  const distance = calculateDistance(
    previousLocation.latitude, previousLocation.longitude,
    currentLocation.latitude, currentLocation.longitude
  );

  // Must exceed GPS accuracy buffer (15m)
  return distance > GPS_ACCURACY_BUFFER;
}
```

### Stationary Detection (Forward Scanning)
```typescript
// tripTimelineService.ts:327-350
if (!point.isMoving) {
  // Look ahead to confirm vehicle STAYS stopped
  let totalStoppedTime = 0;
  let scanIndex = i + 1;

  while (scanIndex < routePoints.length) {
    const futurePoint = routePoints[scanIndex];
    const distance = calculateDistance(point, futurePoint);

    // Vehicle moved away - not a real stop
    if (distance > STATIONARY_RADIUS) break;

    totalStoppedTime = (futurePoint.timestamp - point.timestamp) / 60000;

    // Confirmed: stopped for 2+ minutes
    if (totalStoppedTime >= MIN_STOP_DURATION) break;

    scanIndex++;
  }

  if (totalStoppedTime >= 2) {
    // END THE TRIP
    // JUMP ahead past all stationary points
  }
}
```

### Distance Calculation (Haversine Formula)
```typescript
// tripTimelineService.ts:~650-670
private calculateDistance(lat1, lon1, lat2, lon2): number {
  const R = 6371; // Earth radius in km
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
            Math.sin(dLon/2) * Math.sin(dLon/2);

  const c = 2 * Math.asin(Math.sqrt(a));
  return R * c; // Returns kilometers
}
```

---

## Troubleshooting Common Issues

### Issue: Missing trips in the morning
**Cause**: Background monitoring service wasn't running
**Solution**: Ensure service runs 24/7, check logs for service interruptions

### Issue: Client location not detected
**Cause**: Location not in client database or radius too small
**Solution**:
1. Check `/sparklawn-website-manager/client-coordinates-cache.json`
2. Add client with correct coordinates
3. Restart server to reload cache

### Issue: Trips showing wrong duration (too long)
**Cause**: Trip includes parked time (old location-based algorithm)
**Solution**: Verify using movement-based algorithm (check `isMoving` flag usage)

### Issue: "ACCO Brands" instead of "Coler Crossing"
**Cause**: Google reverse geocode returned business name before client match
**Solution**: Client matching happens FIRST in `createTripFromPoints()`, verify client in database

### Issue: Trip continuity not working (gaps between trips)
**Cause**: Continuity logic not applied
**Solution**: Check lines 381-396 in tripTimelineService.ts

### Issue: Too many short trips (ignition cycling creating false trips)
**Cause**: MIN_STOP_DURATION too short or STATIONARY_RADIUS too large
**Solution**: Current values (2 min, 100m) are tuned - verify forward scanning logic

---

## Testing & Validation

### Test Movement Detection
```bash
curl http://localhost:3002/api/trips/timeline/1FTVW1EV3NWG07402 | \
  jq '.timeline.summary.routePoints[] | select(.isMoving == true) |
      {time: .timestamp, address: .address, moving: .isMoving}'
```

### Test Client Location Matching
```bash
curl http://localhost:3002/api/trips/timeline/1FTVW1EV3NWG07402 | \
  jq '.timeline.stops[] | {location: .location.clientName, type: .type}'
```

### Test Trip Continuity
```bash
curl http://localhost:3002/api/trips/timeline/1FTVW1EV3NWG07402 | \
  jq '.timeline.trips | to_entries | map({
    trip: .key + 1,
    from: .value.startLocation.clientName,
    to: .value.endLocation.clientName
  })'
```

### Verify Data Collection
```bash
# Check MongoDB for recent route points
mongosh mongodb://localhost:27017/ford-telematics
> db.route_points.find({vehicleId: "1FTVW1EV3NWG07402"})
  .sort({timestamp: -1}).limit(10)
```

---

## Performance Characteristics

- **GPS Collection**: Every 2-3 seconds per vehicle
- **Data Retention**: 7 days (TTL on route_points)
- **API Response Time**: ~200-500ms for daily timeline
- **Database Size**: ~50-100k route points per vehicle per week
- **Geocoding Cache**: 6,775+ entries, eliminates API calls

---

## Future Prompt Context

When debugging trip detection issues, provide:
1. **Vehicle ID** being tested
2. **Date range** in question
3. **Expected behavior** vs actual (e.g., "Should show 4 trips but only shows 2")
4. **Specific locations** involved (client names, addresses)
5. **Raw API response** if possible: `curl http://localhost:3002/api/trips/timeline/VIN`

Example prompt:
> "Lightning 3 (VIN 1FTVW1EV3NWG07402) on Oct 3rd should show a stop at Coler Crossing
> from 3:07 PM to 8:12 PM, but the API is showing 'ACCO Brands Corporation' instead.
> Client location is in the database at (36.374270, -94.220826) with 100m radius."

---

## Critical Files Reference

| File | Purpose | Key Lines |
|------|---------|-----------|
| `backgroundMonitoringService.ts` | GPS collection, isMoving detection | 299-453 |
| `tripTimelineService.ts` | Trip aggregation algorithm | 288-399 |
| `tripTimelineService.ts` | Stop generation | 545-594 |
| `tripTimelineService.ts` | Location enrichment | 406-470 |
| `clientLocations.ts` | Client matching | 120-180 |
| `geocoding.ts` | Google API fallback | 50-120 |
| `trip-modal-preview.html` | Frontend display | 692-729 |
| `client-coordinates-cache.json` | Client database | (data file) |

---

## Version History

- **v2.0** (Oct 2025): Movement-based trip detection with forward scanning
- **v1.0** (Previous): Location-based trip detection (deprecated)

**Last Updated**: October 3, 2025
