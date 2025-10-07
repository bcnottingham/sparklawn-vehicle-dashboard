# UI Data Population - Trip Detail Modal & Daily Report

## Overview
This document explains how the "Today's Trip Detail" modal and "Daily Report" views populate their data from the trip detection API.

---

## Trip Detail Modal ("Today's Activity")

### File Location
`/src/views/trip-modal-preview.html`

### Opening the Modal
**Triggered from**: Fleet Advanced view - clicking "View Trips" button on any vehicle card

```javascript
// fleet-advanced.html - Line ~450
<button onclick="openTripModal('${vehicle.vin}', '${vehicle.name}')">
  View Trips
</button>
```

### Data Loading Flow

#### Step 1: API Call (Lines 692-697)
```javascript
async function loadTripsData() {
  const response = await fetch(`/api/trips/timeline/${currentVehicleId}`);
  const data = await response.json();

  const trips = data.timeline?.trips || [];
  const stops = data.timeline?.stops || [];

  renderTrips(trips, stops);
}
```

**API Endpoint**: `GET /api/trips/timeline/:vehicleId`
- Returns today's trips and stops
- Includes location enrichment (client names, addresses)
- Pre-calculated durations and distances

#### Step 2: Build Visit Summary (Lines 724-737)
```javascript
const visits = stops.map(stop => {
  const isHomeBase = stop.location.clientName?.includes('McRay Shop') ||
                     stop.location.clientName?.includes('🏠');
  return {
    name: stop.location.clientName || stop.location.address,
    isClient: !!stop.location.clientName && !isHomeBase,
    isHomeBase: isHomeBase,
    arrivalTime: new Date(stop.startTime),
    departureTime: new Date(stop.endTime),
    dwellMinutes: stop.duration,  // ← Uses API-calculated duration
    latitude: stop.location.latitude,
    longitude: stop.location.longitude
  };
});
```

**Key Point**: Uses `stop.duration` directly from API - does NOT calculate client-side

#### Step 3: Calculate Summary Stats (Lines 716-741)
```javascript
// Total distance from all trips
const totalDistance = trips.reduce((sum, trip) => sum + (trip.distance || 0), 0);

// Drive time - exclude stationary work (ignition cycling)
const driveTime = trips
  .filter(trip => trip.distance > 0.2 && trip.avgSpeed > 2)
  .reduce((sum, trip) => sum + (trip.duration || 0), 0);

// Client time - exclude home base
const clientTime = visits
  .filter(v => v.isClient && !v.isHomeBase)
  .reduce((sum, v) => sum + v.dwellMinutes, 0);

// Other location time - non-client, non-home
const otherTime = visits
  .filter(v => !v.isClient && !v.isHomeBase)
  .reduce((sum, v) => sum + v.dwellMinutes, 0);
```

#### Step 4: Render Summary Bar (Lines 751-773)
```html
<div class="summary-stat">
  <div class="summary-stat-value">${totalDistance.toFixed(1)}</div>
  <div class="summary-stat-label">Total Miles</div>
</div>
<div class="summary-stat">
  <div class="summary-stat-value">${trips.length}</div>
  <div class="summary-stat-label">Total Trips</div>
</div>
<div class="summary-stat">
  <div class="summary-stat-value">${formatTime(driveTime)}</div>
  <div class="summary-stat-label">Drive Time</div>
</div>
<div class="summary-stat">
  <div class="summary-stat-value">${formatTime(clientTime)}</div>
  <div class="summary-stat-label">Client Time</div>
</div>
<div class="summary-stat">
  <div class="summary-stat-value">${formatTime(otherTime)}</div>
  <div class="summary-stat-label">Other Time</div>
</div>
```

#### Step 5: Render Visit Details (Lines 776-835)
```javascript
// For each visit/stop
visits.forEach((visit, index) => {
  const visitHtml = `
    <div class="visit-card ${visit.isClient ? 'client-visit' : 'other-visit'}">
      <div class="visit-header">
        <div class="visit-number">#${index + 1}</div>
        <div class="visit-location">
          ${visit.isClient ? '🏢' : '📍'} ${visit.name}
        </div>
        <div class="visit-duration">${formatTime(visit.dwellMinutes)}</div>
      </div>
      <div class="visit-times">
        <div class="visit-time">
          <span class="time-label">Arrived:</span>
          <span class="time-value">${formatDateTime(visit.arrivalTime)}</span>
        </div>
        <div class="visit-time">
          <span class="time-label">Departed:</span>
          <span class="time-value">${formatDateTime(visit.departureTime)}</span>
        </div>
      </div>
      <div class="visit-map" id="map-${index}"></div>
    </div>
  `;
  contentDiv.innerHTML += visitHtml;
});
```

**Visual Indicators**:
- **Client visits**: Blue border, 🏢 icon
- **Other locations**: Gray border, 📍 icon
- **Home base**: Excluded from list (filtered out)

#### Step 6: Render Maps (Lines 840-865)
```javascript
visits.forEach((visit, index) => {
  const map = new google.maps.Map(document.getElementById(`map-${index}`), {
    center: { lat: visit.latitude, lng: visit.longitude },
    zoom: 15,
    mapTypeId: 'satellite'
  });

  new google.maps.Marker({
    position: { lat: visit.latitude, lng: visit.longitude },
    map: map,
    title: visit.name
  });
});
```

---

## Daily Report View

### File Location
`/src/views/daily-report.html`

### Data Loading Flow

**Similar to Trip Modal** but with some differences:

#### Step 1: API Call (Lines ~250-260)
```javascript
async function loadDailyReport(vehicleId, date) {
  const response = await fetch(
    `/api/trips/timeline/${vehicleId}?date=${date}`
  );
  const data = await response.json();

  renderDailyReport(data.timeline.trips, data.timeline.stops);
}
```

**Key Difference**: Can specify custom date via `?date=` query parameter

#### Step 2: Render Report Header (Lines ~280-310)
```html
<div class="report-header">
  <h2>${vehicleName} - Daily Report</h2>
  <div class="report-date">${formatDate(date)}</div>

  <div class="report-summary">
    <div class="summary-item">
      <span class="summary-label">Total Distance:</span>
      <span class="summary-value">${totalDistance.toFixed(1)} mi</span>
    </div>
    <div class="summary-item">
      <span class="summary-label">Total Trips:</span>
      <span class="summary-value">${trips.length}</span>
    </div>
    <div class="summary-item">
      <span class="summary-label">Client Visits:</span>
      <span class="summary-value">${clientVisits}</span>
    </div>
    <div class="summary-item">
      <span class="summary-label">Client Time:</span>
      <span class="summary-value">${formatTime(clientTime)}</span>
    </div>
  </div>
</div>
```

#### Step 3: Render Trip Timeline (Lines ~320-380)
```javascript
trips.forEach((trip, index) => {
  const tripHtml = `
    <div class="trip-card">
      <div class="trip-number">Trip ${index + 1}</div>
      <div class="trip-route">
        <div class="location-marker start">📍</div>
        <div class="location-name">
          ${trip.startLocation.clientName || trip.startLocation.address}
        </div>
        <div class="trip-arrow">→</div>
        <div class="location-marker end">📍</div>
        <div class="location-name">
          ${trip.endLocation.clientName || trip.endLocation.address}
        </div>
      </div>
      <div class="trip-stats">
        <span>🕐 ${formatTime(trip.duration)}</span>
        <span>📏 ${trip.distance.toFixed(1)} mi</span>
        <span>⚡ ${trip.batteryUsed.toFixed(1)}%</span>
      </div>
      <div class="trip-times">
        ${formatDateTime(trip.startTime)} - ${formatDateTime(trip.endTime)}
      </div>
    </div>
  `;

  // If there's a stop after this trip, render it
  const stop = stops[index];
  if (stop) {
    const stopHtml = `
      <div class="stop-card ${stop.type === 'client_visit' ? 'client' : 'other'}">
        <div class="stop-icon">${stop.type === 'client_visit' ? '🏢' : '📍'}</div>
        <div class="stop-location">
          ${stop.location.clientName || stop.location.address}
        </div>
        <div class="stop-duration">${formatTime(stop.duration)}</div>
        <div class="stop-times">
          ${formatDateTime(stop.startTime)} - ${formatDateTime(stop.endTime)}
        </div>
      </div>
    `;
    contentDiv.innerHTML += tripHtml + stopHtml;
  } else {
    contentDiv.innerHTML += tripHtml;
  }
});
```

**Display Pattern**:
```
Trip 1: McRay Shop → Coler Crossing
  ↓
Stop 1: 🏢 Coler Crossing (2h 15m)
  ↓
Trip 2: Coler Crossing → McRay Shop
```

---

## Data Transformation Examples

### API Response
```json
{
  "timeline": {
    "trips": [
      {
        "startTime": "2025-10-03T13:28:43.749Z",
        "endTime": "2025-10-03T14:38:46.233Z",
        "startLocation": {
          "clientName": "🏠 McRay Shop",
          "latitude": 36.183151,
          "longitude": -94.169547
        },
        "endLocation": {
          "clientName": "Coler Crossing",
          "latitude": 36.374270,
          "longitude": -94.220826
        },
        "duration": 70,
        "distance": 33.51
      }
    ],
    "stops": [
      {
        "startTime": "2025-10-03T14:38:46.233Z",
        "endTime": "2025-10-03T17:53:22.105Z",
        "location": {
          "clientName": "Coler Crossing",
          "latitude": 36.374270,
          "longitude": -94.220826
        },
        "duration": 195,
        "type": "client_visit"
      }
    ]
  }
}
```

### UI Display (Trip Modal)

**Summary Bar**:
```
Total Miles: 33.5    Total Trips: 1    Drive Time: 1h 10m    Client Time: 3h 15m
```

**Visit Card**:
```
┌────────────────────────────────────────┐
│ #1  🏢 Coler Crossing        3h 15m    │
├────────────────────────────────────────┤
│ Arrived:  2:38 PM                      │
│ Departed: 5:53 PM                      │
├────────────────────────────────────────┤
│ [Google Maps Satellite View]           │
└────────────────────────────────────────┘
```

---

## Key Differences: Trip Modal vs Daily Report

| Feature | Trip Modal | Daily Report |
|---------|-----------|--------------|
| **Date** | Today only | Any date via query param |
| **Layout** | Vertical visit cards | Timeline (trip → stop → trip) |
| **Maps** | Embedded in each card | Optional/separate view |
| **Summary** | 5 stats (miles, trips, drive, client, other) | 4 stats (miles, trips, visits, client time) |
| **Home Base** | Excluded from visit list | May appear in trip endpoints |
| **Export** | None | PDF/CSV export options |

---

## Time Formatting

### formatTime() Function
```javascript
function formatTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
```

**Examples**:
- `65 minutes` → `1h 5m`
- `45 minutes` → `45m`
- `135 minutes` → `2h 15m`

### formatDateTime() Function
```javascript
function formatDateTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Chicago'
  });
}
```

**Examples**:
- `"2025-10-03T14:38:46.233Z"` → `2:38 PM`
- `"2025-10-03T08:13:14.824Z"` → `8:13 AM`

---

## Client vs Non-Client Detection

### In UI Code (Lines 726-730)
```javascript
const isHomeBase = stop.location.clientName?.includes('McRay Shop') ||
                   stop.location.clientName?.includes('🏠');

const isClient = !!stop.location.clientName && !isHomeBase;
```

### Visual Indicators

**Client Visit**:
- Border: Blue (`#3b82f6`)
- Icon: 🏢
- Label: Shows client name from database
- Type: `client_visit`

**Other Location**:
- Border: Gray (`#64748b`)
- Icon: 📍
- Label: Shows Google Places business name or address
- Type: `unknown_stop`

**Home Base**:
- Not displayed in visit list
- May appear in trip start/end locations with 🏠 prefix

---

## Error Handling

### No Data Available
```javascript
if (trips.length === 0) {
  summaryBar.innerHTML = `
    <div style="text-align: center; padding: 20px; color: #94a3b8;">
      No trips recorded today
    </div>
  `;
  return;
}
```

### API Error
```javascript
try {
  const response = await fetch(`/api/trips/timeline/${vehicleId}`);
  if (!response.ok) throw new Error(`Failed: ${response.status}`);
  // ... process data
} catch (error) {
  summaryBar.innerHTML = `
    <div style="text-align: center; color: #ef4444;">
      ${error.message}
    </div>
  `;
}
```

---

## Data Flow Diagram

```
User Action (Click "View Trips")
    ↓
openTripModal(vehicleId, vehicleName)
    ↓
loadTripsData()
    ↓
GET /api/trips/timeline/:vehicleId
    ↓
tripTimelineService.getTimelineForPeriod()
    ↓
[Movement-based trip detection algorithm]
    ↓
[Client location matching]
    ↓
API Response: { trips: [...], stops: [...] }
    ↓
renderTrips(trips, stops)
    ↓
Transform stops → visits
    ↓
Calculate summary stats
    ↓
Render summary bar (5 metrics)
    ↓
Render visit cards (with maps)
    ↓
User sees complete trip detail modal
```

---

## Important UI Implementation Details

### 1. Duration Calculation
**CRITICAL**: UI uses `stop.duration` from API, does NOT calculate client-side
```javascript
// CORRECT (current implementation)
dwellMinutes: stop.duration

// WRONG (old implementation - DO NOT USE)
dwellMinutes: (stop.endTime - stop.startTime) / 60000
```

### 2. Home Base Filtering
```javascript
// Exclude home base from client time calculation
const clientTime = visits
  .filter(v => v.isClient && !v.isHomeBase)
  .reduce((sum, v) => sum + v.dwellMinutes, 0);
```

### 3. Drive Time Filtering
```javascript
// Exclude stationary work (ignition cycling at same location)
const driveTime = trips
  .filter(trip => trip.distance > 0.2 && trip.avgSpeed > 2)
  .reduce((sum, trip) => sum + (trip.duration || 0), 0);
```

**Rationale**: Trips with distance < 0.2mi and speed < 2mph are ignition cycling, not actual driving

---

## Testing UI Data Population

### Test in Browser Console
```javascript
// Fetch data for specific vehicle
fetch('/api/trips/timeline/1FTVW1EV3NWG07402')
  .then(r => r.json())
  .then(d => {
    console.log('Trips:', d.timeline.trips.length);
    console.log('Stops:', d.timeline.stops.length);
    console.log('Client visits:',
      d.timeline.stops.filter(s => s.type === 'client_visit').length
    );
  });
```

### Verify Client Matching
```javascript
// Check which stops are detected as client visits
d.timeline.stops.forEach(stop => {
  console.log(
    stop.location.clientName || stop.location.address,
    '→',
    stop.type
  );
});
```

### Verify Duration Calculations
```javascript
// Check that durations match API (not recalculated)
d.timeline.stops.forEach(stop => {
  const apiDuration = stop.duration;
  const manualCalc = (new Date(stop.endTime) - new Date(stop.startTime)) / 60000;
  console.log('API:', apiDuration, 'Calculated:', manualCalc,
              'Match:', Math.abs(apiDuration - manualCalc) < 1);
});
```

---

## Common UI Issues & Solutions

### Issue: Visit shows "(0m)" duration
**Cause**: Frontend calculating duration instead of using API value
**Solution**: Use `stop.duration` from API response

### Issue: Client location showing business name
**Cause**: Client not in database or coordinates don't match
**Solution**: Add/update client in `client-coordinates-cache.json`

### Issue: Home base appearing in visit list
**Cause**: isHomeBase filter not working
**Solution**: Verify `McRay Shop` or `🏠` in clientName

### Issue: Wrong timezone on visit times
**Cause**: Not specifying America/Chicago timezone
**Solution**: Use `toLocaleTimeString` with `timeZone: 'America/Chicago'`

---

**Last Updated**: October 3, 2025
