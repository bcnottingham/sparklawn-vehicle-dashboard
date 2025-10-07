# SparkLawn Fleet Dashboard - API Documentation

*Complete API reference for the SparkLawn fleet management system*

---

## 🚀 NEW ENDPOINT - Linear Timeline API

### GET `/api/trips/timeline/:vehicleId`

**Description**: Retrieve a chronological timeline of today's vehicle activity with linear progression from ignition to current state.

**Parameters**:
- `vehicleId` (string, required) - Vehicle VIN or identifier

**Response Structure**:
```typescript
{
    vehicleId: string;
    date: string;           // ISO date (YYYY-MM-DD)
    timeline: {
        vehicle: string;
        status: 'active' | 'parked' | 'no_activity';
        currentLocation?: string;
        currentClient?: string;
        parkedDuration?: number; // minutes
        timeline: TimelineEvent[];
    };
    timestamp: string;      // ISO timestamp of response
}
```

**Timeline Event Structure**:
```typescript
interface TimelineEvent {
    type: 'ignition_on' | 'departure' | 'arrival' | 'stop_start' | 'stop_end' | 'parked' | 'ignition_off';
    timestamp: Date;
    location: {
        latitude: number;
        longitude: number;
        address?: string;
        clientName?: string;
    };
    batteryLevel?: number;
    duration?: number;
    distance?: number;
    metadata?: {
        stopDuration?: number;      // minutes
        driveDuration?: number;     // minutes
        driveDistance?: number;     // miles
        previousLocation?: string;
    };
}
```

**Event Types**:
- `ignition_on` - Vehicle started (🔥)
- `departure` - Left a location (🚗)
- `arrival` - Reached a destination (🎯)
- `stop_start` - Beginning of a stop during trip (⏸️)
- `stop_end` - Resuming movement after stop (▶️)
- `ignition_off` - Vehicle shutdown (🔴)
- `parked` - Currently parked status (🅿️)

**Example Response**:
```json
{
    "vehicleId": "1FT6W1EV3PWG37779",
    "date": "2025-09-08",
    "timeline": {
        "vehicle": "1FT6W1EV3PWG37779",
        "status": "parked",
        "currentLocation": "StoneRidge Phase 2",
        "currentClient": "StoneRidge Phase 2",
        "parkedDuration": 45,
        "timeline": [
            {
                "type": "ignition_on",
                "timestamp": "2025-09-08T07:30:00.000Z",
                "location": {
                    "latitude": 36.183006,
                    "longitude": -94.169719,
                    "address": "McRay Shop, Rogers, AR",
                    "clientName": "McRay Shop"
                },
                "batteryLevel": 98
            },
            {
                "type": "departure",
                "timestamp": "2025-09-08T07:35:00.000Z",
                "location": {
                    "latitude": 36.183100,
                    "longitude": -94.169500,
                    "address": "McRay Shop, Rogers, AR"
                },
                "batteryLevel": 97
            },
            {
                "type": "arrival",
                "timestamp": "2025-09-08T08:15:00.000Z",
                "location": {
                    "latitude": 36.33851,
                    "longitude": -94.28062,
                    "address": "StoneRidge Phase 2, Bentonville, AR",
                    "clientName": "StoneRidge Phase 2"
                },
                "batteryLevel": 85,
                "metadata": {
                    "driveDuration": 40,
                    "driveDistance": 12.5
                }
            },
            {
                "type": "parked",
                "timestamp": "2025-09-08T08:15:00.000Z",
                "location": {
                    "latitude": 36.33851,
                    "longitude": -94.28062,
                    "address": "StoneRidge Phase 2, Bentonville, AR",
                    "clientName": "StoneRidge Phase 2"
                },
                "batteryLevel": 85,
                "metadata": {
                    "stopDuration": 45
                }
            }
        ]
    },
    "timestamp": "2025-09-08T15:00:00.000Z"
}
```

**HTTP Status Codes**:
- `200` - Success
- `404` - Vehicle not found
- `500` - Server error

---

## 📊 Existing Trip API Endpoints

### GET `/api/trips`

**Description**: Retrieve trip history for all vehicles or a specific vehicle.

**Query Parameters**:
- `vehicleId` (string, optional) - Filter by specific vehicle
- `limit` (number, optional) - Maximum number of trips to return (default: 50)

### GET `/api/trips/active`

**Description**: Get currently active trips across the fleet.

**Response**: Array of active trip objects with real-time status.

### GET `/api/trips/:tripId`

**Description**: Retrieve detailed information for a specific trip.

### GET `/api/trips/stats/:vehicleId`

**Description**: Get statistical summary for a vehicle over a specified period.

**Query Parameters**:
- `days` (number, optional) - Number of days to analyze (default: 30)

### GET `/api/trips/stats/fleet/overview`

**Description**: Fleet-wide statistics and performance metrics.

**Query Parameters**:
- `days` (number, optional) - Analysis period in days (default: 7)

---

## 🚗 Vehicle API Endpoints

### GET `/api/vehicles/with-names`

**Description**: Get all vehicles with their current status and friendly names.

### GET `/api/vehicles/:vehicleId/daily-stats`

**Description**: Daily statistics for a specific vehicle.

**Query Parameters**:
- `date` (string, optional) - Date in YYYY-MM-DD format (default: today)

---

## 🗄️ Database Integration

**MongoDB Atlas Connection**:
- **Cluster**: `sparklawn-cluster.evvvpal.mongodb.net`
- **Database**: `sparklawn_fleet`
- **Collections**: `trips`, `trip_points`, `movement_events`

**Authentication**:
- Connection secured with username/password authentication
- TLS encryption for all data transmission
- Automatic connection pooling and retry logic

**Performance Features**:
- Optimized indexes for timeline queries
- 3-second background monitoring intervals
- Client location correlation with 96+ addresses
- Real-time status tracking with persistence

---

## 🔧 Technical Implementation

**Backend Architecture**:
- **Node.js/Express** with TypeScript
- **MongoDB Atlas** for persistent storage
- **Ford Telematics API** for real-time vehicle data
- **Background monitoring** at 3-second intervals

**Smart Geocoding System**:
- **Google Places API** for intelligent business detection
- **Major Business Priority** (Casey's, Lowe's, Whataburger, etc.)
- **Minor Service Filtering** (ATMs, propane exchanges, kiosks)
- **4-Pass Detection Algorithm** with distance validation

**Frontend Integration**:
- Real-time dashboard updates
- Interactive timeline modal
- Color-coded event visualization
- Intelligent location names with business context

**Error Handling**:
- Graceful API fallbacks
- Comprehensive logging
- User-friendly error messages
- Automatic retry mechanisms

**Security**:
- Environment-based configuration
- Secure credential storage
- API rate limiting
- Input validation and sanitization

---

## 📈 Usage Examples

### JavaScript/Frontend Usage

```javascript
// Fetch today's timeline for a vehicle
async function loadVehicleTimeline(vehicleId) {
    try {
        const response = await fetch(`/api/trips/timeline/${vehicleId}`);
        const data = await response.json();
        
        // Display timeline
        displayTimeline(data.timeline);
        
    } catch (error) {
        console.error('Failed to load timeline:', error);
    }
}

// Process timeline events
function displayTimeline(timelineData) {
    const { status, currentLocation, timeline } = timelineData;
    
    timeline.forEach(event => {
        const time = new Date(event.timestamp).toLocaleTimeString();
        const location = event.location.address;
        const client = event.location.clientName;
        
        console.log(`${time}: ${event.type} at ${location}${client ? ` (${client})` : ''}`);
    });
}
```

### cURL Examples

```bash
# Get timeline for specific vehicle
curl -X GET "http://localhost:8080/api/trips/timeline/1FT6W1EV3PWG37779"

# Get active trips
curl -X GET "http://localhost:8080/api/trips/active"

# Get fleet overview
curl -X GET "http://localhost:8080/api/trips/stats/fleet/overview?days=7"
```

---

## 🎯 Intelligent Business Detection System

**Smart Geocoding Priority:**
1. **Custom Locations** - Hardcoded business mappings (McRay Shop, etc.)
2. **Major Businesses** - Casey's, Lowe's, Whataburger, Maverik, McDonald's, Walmart, etc.  
3. **Minor Service Filtering** - Skips ATMs, Bitcoin machines, propane exchanges, kiosks
4. **Client Locations** - SparkLawn customer addresses (only if no business detected)
5. **Geofencing Zones** - Supplier locations (Home Depot, Lowe's, etc.)
6. **Street Addresses** - Final fallback via Google Geocoding/OpenStreetMap

**Major Chain Detection:**
```typescript
const majorChains = [
    'casey\'s', 'lowe\'s', 'home depot', 'walmart', 'target', 'maverik',
    'mcdonald\'s', 'whataburger', 'burger king', 'sonic', 'dairy queen',
    'starbucks', 'cvs', 'walgreens', 'autozone', 'o\'reilly'
    // 50+ major business chains
];
```

**Distance Validation:**
- Residential client locations: Max 300m radius
- Commercial properties: Up to 1200m radius  
- Major businesses: Up to 200m detection range
- Minor services: Only if <30m and no alternatives

**Example Results:**
- `36.341662, -94.152880` → **"Casey's"** (not "Buy Bitcoin ATM")
- `36.174266, -94.177197` → **"Lowe's Home Improvement"** (not "Blue Rhino Propane")
- `36.287621, -94.189368` → **"Maverik"** (not "Blue Rhino Propane")

---

## 🎯 Client Location Integration

**Radius-Based Matching**:
- 96+ client locations with custom radius zones
- Automatic detection when vehicles arrive at client sites
- Self-healing validation to prevent false positives

**Client Data Structure**:
```typescript
interface ClientLocation {
    client: string;     // "StoneRidge Phase 2"
    address: string;    // "123 Main St, Bentonville, AR"
    lat: number;        // 36.33851
    lng: number;        // -94.28062
    radius: number;     // 250 (meters)
}
```

**Integration Points**:
- Timeline events show client names when detected
- Real-time dashboard displays current client locations
- Historical trip data includes client visit correlation

This API provides comprehensive fleet tracking capabilities with real-time monitoring, persistent storage, and intelligent client location detection for complete operational visibility.