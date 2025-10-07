// Initialize the map - will auto-zoom to vehicles when loaded
const map = L.map('map').setView([36.3, -94.2], 10);

// Add high-quality tile layer
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 18
}).addTo(map);

// Vehicle data storage
let vehicles = [];
let vehicleMarkers = {};
let selectedVehicleId = null;
let markerClusterGroup = null;
let locationHistory = new Map(); // Track location history for staleness detection

// Performance tracking and caching
let lastUpdateTime = 0;
let updateThrottleTimeout = null;
let lastETag = null;
let vehicleDataCache = new Map(); // Cache for change detection
let pendingDOMUpdates = []; // Batch DOM updates

// Development performance logging
function perfLog(message, startTime) {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        if (startTime) {
            console.log(`[PERF] ${message}: ${Date.now() - startTime}ms`);
        } else {
            console.time(`[PERF] ${message}`);
            return Date.now();
        }
    }
}

// Vehicle change detection for efficient re-rendering
function getVehicleKey(vehicle) {
    return `${vehicle.id}-${vehicle.location?.latitude}-${vehicle.location?.longitude}-${vehicle.state || vehicle.isOnTrip}-${vehicle.battery?.isCharging}-${vehicle.lastUpdate}`;
}

function hasVehicleChanged(vehicle) {
    const newKey = getVehicleKey(vehicle);
    const oldKey = vehicleDataCache.get(vehicle.id);
    return newKey !== oldKey;
}

function updateVehicleCache(vehicle) {
    vehicleDataCache.set(vehicle.id, getVehicleKey(vehicle));
}

// Batch DOM updates with requestAnimationFrame
function batchDOMUpdate(updateFunction) {
    pendingDOMUpdates.push(updateFunction);

    if (pendingDOMUpdates.length === 1) {
        requestAnimationFrame(() => {
            const perfStart = perfLog('batchDOMUpdate');
            const updates = [...pendingDOMUpdates];
            pendingDOMUpdates.length = 0;

            updates.forEach(update => update());
            perfLog('batchDOMUpdate', perfStart);
        });
    }
}

// Cache-busting utility function
function addCacheBuster(url) {
    const separator = url.includes('?') ? '&' : '?';
    return url + separator + '_t=' + Date.now();
}

// Smart battery percentage conversion - handles both formats from Smartcar
function smartBatteryPercent(percentRemaining) {
    return percentRemaining > 1 
        ? Math.round(percentRemaining) // Already a percentage (89.5 -> 90)
        : Math.round(percentRemaining * 100); // Decimal format (0.895 -> 90)
}

// Determine vehicle status based on available data
function getVehicleStatus(vehicle) {
    const isCharging = vehicle.battery?.isCharging || false;
    const isOnTrip = vehicle.isOnTrip || vehicle.ignition?.status === 'Run' || vehicle.isMoving || false;

    if (isOnTrip) return 'On Trip';
    if (isCharging) return 'Charging';
    return 'Parked';
}

// Check if vehicle is parked (can be charging AND parked)
function isVehicleParked(vehicle) {
    const isOnTrip = vehicle.isOnTrip || vehicle.ignition?.status === 'Run' || vehicle.isMoving || false;
    return !isOnTrip; // Parked if not on trip, regardless of charging status
}

// Create custom vehicle pin icon with tooltip
function createVehicleIcon(vehicle) {
    const batteryPercent = smartBatteryPercent(vehicle.battery?.percentRemaining || 0);
    const status = getVehicleStatus(vehicle);
    const range = vehicle.battery?.range || 0;
    const makeModel = `${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim() || 'Vehicle';
    const shortVin = vehicle.vin ? vehicle.vin.slice(-6) : 'N/A';
    
    return L.divIcon({
        html: `<div class="vehicle-pin">
            <div class="vehicle-pulse"></div>
            <div class="vehicle-hover-tooltip">
                <div class="tooltip-header">${vehicle.name}</div>
                <div class="tooltip-details">
                    <div class="tooltip-row">
                        <span class="tooltip-label">Vehicle:</span>
                        <span class="tooltip-value">${makeModel}</span>
                    </div>
                    <div class="tooltip-row">
                        <span class="tooltip-label">VIN:</span>
                        <span class="tooltip-value">***${shortVin}</span>
                    </div>
                    <div class="tooltip-row">
                        <span class="tooltip-label">Battery:</span>
                        <span class="tooltip-value">${batteryPercent}% • ${range} mi</span>
                    </div>
                    <div class="tooltip-row">
                        <span class="tooltip-label">Status:</span>
                        <span class="tooltip-value">${status}</span>
                    </div>
                    ${vehicle.location?.address ? `
                    <div class="tooltip-row">
                        <span class="tooltip-label">Location:</span>
                        <span class="tooltip-value">${vehicle.location.address}</span>
                    </div>
                    ` : ''}
                </div>
            </div>
        </div>`,
        className: 'custom-vehicle-marker',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });
}

// Fetch vehicles list
async function fetchVehicles() {
    try {
        const response = await fetch(addCacheBuster('/api/vehicles'));
        const data = await response.json();
        vehicles = data.vehicles || [];
        updateVehicleCount();
        return vehicles;
    } catch (error) {
        console.error('Error fetching vehicles:', error);
        return [];
    }
}

// Fetch individual vehicle location
async function fetchVehicleLocation(vehicleId) {
    try {
        const response = await fetch(addCacheBuster(`/api/vehicles/${vehicleId}/location`));
        const location = await response.json();
        return { id: vehicleId, ...location };
    } catch (error) {
        console.error(`Error fetching location for vehicle ${vehicleId}:`, error);
        return null;
    }
}

// Optimized fetch with ETag caching and smart updating
async function fetchAllVehicleLocations() {
    const perfStart = perfLog('fetchAllVehicleLocations');

    try {
        // Throttle updates to max once per second
        const now = Date.now();
        if (now - lastUpdateTime < 1000) {
            perfLog('fetchAllVehicleLocations - throttled', perfStart);
            return vehicles; // Return cached vehicles if called too soon
        }

        const headers = {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        };

        // Add ETag for conditional requests
        if (lastETag) {
            headers['If-None-Match'] = lastETag;
        }

        const response = await fetch('/api/vehicle-state/all', {
            cache: 'no-cache',
            headers
        });

        // Handle 304 Not Modified - no changes
        if (response.status === 304) {
            perfLog('fetchAllVehicleLocations - not modified', perfStart);
            lastUpdateTime = now;
            return vehicles; // Return cached data
        }

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Update ETag for next request
        lastETag = response.headers.get('ETag');
        lastUpdateTime = now;

        const data = await response.json();

        if (!data.success) {
            throw new Error(`API Error: ${data.error || 'Unknown error'}`);
        }

        // Transform new API format to match existing frontend expectations
        const newVehicles = data.vehicles.map(vehicle => {
            const isOnTrip = vehicle.state === 'TRIP';
            const isCharging = vehicle.state === 'CHARGING';

            return {
                id: vehicle.vin,
                vin: vehicle.vin,
                name: vehicle.name,
                location: {
                    latitude: parseFloat(vehicle.location.latitude) || null,
                    longitude: parseFloat(vehicle.location.longitude) || null,
                    address: vehicle.location.address
                },
                battery: {
                    percentRemaining: null,
                    isCharging: isCharging,
                    range: null
                },
                ignition: {
                    status: vehicle.ignition.status
                },
                isOnTrip: isOnTrip,
                isMoving: vehicle.movement.isMoving,
                lastUpdate: vehicle.lastUpdate,
                stateDuration: vehicle.stateDuration,
                freshness: vehicle.freshness,
                newArchitecture: true,
                state: vehicle.state,
                stateSince: vehicle.stateSince
            };
        });

        // Update cached vehicles
        vehicles = newVehicles;
        perfLog('fetchAllVehicleLocations - success', perfStart);
        return vehicles;

    } catch (error) {
        console.error('❌ NEW ARCHITECTURE: Error fetching from MongoDB API:', error);

        // Fallback to legacy method if new architecture fails
        try {
            const response = await fetch('/api/vehicles/with-names', {
                cache: 'no-cache',
                headers: {
                    'Cache-Control': 'no-cache, no-store, must-revalidate'
                }
            });
            const data = await response.json();
            const fallbackVehicles = data.vehicles.filter(vehicle => vehicle.location && !vehicle.error);

            // Apply legacy trip detection logic
            for (const vehicle of fallbackVehicles) {
                const ignitionOn = vehicle.ignition?.status === 'ON' || vehicle.ignition?.status === 'Run';
                const isMoving = vehicle.isMoving || false;
                vehicle.isOnTrip = ignitionOn && isMoving;
                vehicle.newArchitecture = false;
            }

            vehicles = fallbackVehicles;
            perfLog('fetchAllVehicleLocations - fallback', perfStart);
            return vehicles;

        } catch (fallbackError) {
            console.error('❌ LEGACY FALLBACK: Also failed:', fallbackError);
            perfLog('fetchAllVehicleLocations - error', perfStart);
            return vehicles; // Return existing cached data
        }
    }
}

// Efficient marker update with change detection
function updateVehicleMarkers(vehicleLocations) {
    const perfStart = perfLog('updateVehicleMarkers');

    // Initialize cluster group if needed
    if (!markerClusterGroup) {
        markerClusterGroup = L.markerClusterGroup({
            iconCreateFunction: function(cluster) {
                const count = cluster.getChildCount();
                return L.divIcon({
                    html: `<div class="vehicle-cluster-pin">
                        <div class="vehicle-cluster-pulse"></div>
                        <span>${count}</span>
                        <div class="vehicle-cluster-tooltip">${count} vehicles</div>
                    </div>`,
                    className: 'custom-cluster-marker',
                    iconSize: L.point(30, 30),
                    iconAnchor: [15, 15]
                });
            },
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            maxClusterRadius: 80,
            disableClusteringAtZoom: 15
        });
        map.addLayer(markerClusterGroup);
    }

    const currentVehicleIds = new Set(vehicleLocations.map(v => v.id));
    const existingVehicleIds = new Set(Object.keys(vehicleMarkers));

    // Remove markers for vehicles that no longer exist
    existingVehicleIds.forEach(id => {
        if (!currentVehicleIds.has(id)) {
            if (vehicleMarkers[id]) {
                markerClusterGroup.removeLayer(vehicleMarkers[id]);
                delete vehicleMarkers[id];
                vehicleDataCache.delete(id);
            }
        }
    });

    // Track changes for efficient updates
    const changedVehicles = [];
    const newVehicles = [];

    vehicleLocations.forEach(vehicle => {
        const lat = vehicle.location?.latitude || vehicle.latitude;
        const lng = vehicle.location?.longitude || vehicle.longitude;

        if (!lat || !lng) return;

        const hasChanged = hasVehicleChanged(vehicle);
        const isNew = !vehicleMarkers[vehicle.id];

        if (isNew || hasChanged) {
            if (isNew) {
                newVehicles.push(vehicle);
            } else {
                changedVehicles.push(vehicle);
            }
            updateVehicleCache(vehicle);
        }
    });

    // Batch marker updates
    if (changedVehicles.length > 0 || newVehicles.length > 0) {
        batchDOMUpdate(() => {
            // Update changed markers
            changedVehicles.forEach(vehicle => {
                if (vehicleMarkers[vehicle.id]) {
                    markerClusterGroup.removeLayer(vehicleMarkers[vehicle.id]);
                }
                createAndAddMarker(vehicle);
            });

            // Add new markers
            newVehicles.forEach(vehicle => {
                createAndAddMarker(vehicle);
            });

            perfLog(`updateVehicleMarkers - updated ${changedVehicles.length} changed, ${newVehicles.length} new`);
        });
    }

    // Batch sidebar updates
    batchDOMUpdate(() => {
        updateVehicleList(vehicleLocations);
        updateVehicleCount(vehicleLocations.length);
        updateDataSourceDisplay(vehicleLocations);
        updateLastUpdate();
    });

    perfLog('updateVehicleMarkers', perfStart);
}

// Helper function to create and add markers
function createAndAddMarker(vehicle) {
    const lat = vehicle.location?.latitude || vehicle.latitude;
    const lng = vehicle.location?.longitude || vehicle.longitude;

    if (!lat || !lng) return;

    const marker = L.marker([lat, lng], {
        icon: createVehicleIcon(vehicle)
    });

    const vehicleName = vehicle.name || `Vehicle ${vehicle.id.substring(0, 8)}`;
    const vehicleModel = vehicle.model || 'Unknown';
    const vehicleYear = vehicle.year || '';
    const batteryPercent = smartBatteryPercent(vehicle.battery?.percentRemaining || 0);
    const address = vehicle.location?.address || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

    function getBatteryClass(percent) {
        if (percent <= 35) return 'low';
        if (percent <= 70) return 'medium';
        return 'high';
    }

    const isCharging = vehicle.battery?.isCharging || false;
    const chargingClass = isCharging ? 'charging' : '';

    marker.bindPopup(`
        <div class="vehicle-popup">
            <h3>${vehicleName}</h3>
            <p><strong>Model:</strong> ${vehicleYear} Ford ${vehicleModel}</p>
            <div class="battery-indicator">
                <div class="battery-icon">
                    <div class="battery-fill ${getBatteryClass(batteryPercent)} ${chargingClass}"
                         style="width: ${batteryPercent}%"></div>
                </div>
                <span class="battery-percentage">${batteryPercent}%</span>
                ${isCharging ? '<span style="margin-left: 4px;">⚡</span>' : ''}
            </div>
            <p class="address-text">${address}</p>
            <button onclick="selectVehicle('${vehicle.id}')">View Details</button>
        </div>
    `);

    marker.on('click', () => selectVehicle(vehicle.id, vehicleName));
    vehicleMarkers[vehicle.id] = marker;
    markerClusterGroup.addLayer(marker);
}

// Update vehicle count display
function updateVehicleCount(count) {
    const online = count || vehicles.length;
    document.getElementById('vehicle-count').textContent = `${online} vehicles online`;
}

// Update data source display in header
function updateDataSourceDisplay(vehicleLocations) {
    const sourceElement = document.getElementById('data-source-badge');
    if (!sourceElement || !vehicleLocations || vehicleLocations.length === 0) return;
    
    // Count data sources
    const sourceCounts = {};
    vehicleLocations.forEach(vehicle => {
        const source = vehicle.battery?._dataSource || 'unknown';
        sourceCounts[source] = (sourceCounts[source] || 0) + 1;
    });
    
    // Determine primary source
    const sources = Object.keys(sourceCounts);
    let displayText = 'Hybrid';
    
    if (sources.length === 1) {
        // All from same source
        const singleSource = sources[0];
        displayText = singleSource.charAt(0).toUpperCase() + singleSource.slice(1);
    } else if (sources.length > 1) {
        // Mixed sources
        const smartcarCount = sourceCounts['smartcar'] || 0;
        const fordpassCount = sourceCounts['fordpass'] || 0;
        displayText = `Hybrid (${smartcarCount}S/${fordpassCount}F)`;
    }
    
    sourceElement.textContent = displayText;
}

// Update data source indicators (now handled in vehicle cards)

// Update last update time
function updateLastUpdate() {
    const now = new Date();
    document.getElementById('last-update').textContent = 
        `Last updated: ${now.toLocaleTimeString()}`;
}

// Update vehicle list in sidebar - COMPLETELY REWRITTEN TO FORCE PARKING DURATION
function updateVehicleList(vehicleLocations) {
    console.log('🔥 REWRITE CONFIRMED: New vehicle status logic loaded - All vehicles will show parking duration!');
    console.log('🔥 Vehicle count:', vehicleLocations.length);
    const vehicleList = document.getElementById('vehicle-list');
    
    if (vehicleLocations.length === 0) {
        vehicleList.innerHTML = `
            <div class="loading">
                <div class="loading-spinner"></div>
                <span>No vehicles available</span>
            </div>
        `;
        return;
    }

    vehicleList.innerHTML = '';

    vehicleLocations.forEach(vehicle => {
        const lat = vehicle.location?.latitude || vehicle.latitude;
        const lng = vehicle.location?.longitude || vehicle.longitude;
        const vehicleName = vehicle.name || `Vehicle ${vehicle.id.substring(0, 8)}`;
        const vehicleModel = vehicle.model || 'Unknown';
        const vehicleYear = vehicle.year || '';
        const batteryPercent = smartBatteryPercent(vehicle.battery?.percentRemaining || 0);
        const isCharging = vehicle.battery?.isCharging || false;
        const isPluggedIn = vehicle.battery?.isPluggedIn || false;
        const dataSource = vehicle.battery?._dataSource || 'unknown';
        const address = (vehicle.location?.address || (lat && lng ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : 'Location unavailable')).replace(/, Arkansas/g, ', AR');
        
        // Get battery color class
        function getBatteryClass(percent) {
            if (percent <= 35) return 'low';
            if (percent <= 70) return 'medium';
            return 'high';
        }
        
        // Create charging status
        const chargingStatus = isCharging ? 'Charging' : (isPluggedIn ? 'Plugged In' : '');
        const chargingClass = isCharging ? 'charging' : 'not-charging';
        
        // Simulate client name (you can add this to vehicle data later)
        const clientName = getClientName(vehicleName, address);
        
        // Determine actual vehicle status using proper logic
        const vehicleStatus = getVehicleStatus(vehicle);
        
        // Store parking duration (will be populated after card creation)
        let parkingDurationText = '';
        
        const vehicleCard = document.createElement('div');
        vehicleCard.className = 'vehicle-card';
        vehicleCard.onclick = () => centerOnVehicle(vehicle.id);
        
        // Check for stale GPS data with detailed staleness levels
        const staleness = getLocationStaleness(vehicle.id, vehicle.location);
        
        let locationWarning = '';
        if (staleness.level === 'warning') {
            locationWarning = `<div class="location-warning warning">⚠️ ${staleness.message}</div>`;
        } else if (staleness.level === 'stale') {
            locationWarning = `<div class="location-warning stale">🕒 ${staleness.message}</div>`;
        } else if (staleness.level === 'fresh' && staleness.age === 0) {
            locationWarning = `<div class="location-fresh">✅ ${staleness.message}</div>`;
        }
        
        // Special check for known problematic locations
        const isRamseyStale = vehicle.location?.address?.includes('Ramsey Lane');
        if (isRamseyStale) {
            locationWarning = '<div class="location-warning stale">🚫 Known stale location - Ramsey Lane</div>';
        }
        
        vehicleCard.innerHTML = `
            <div class="vehicle-header">
                <div>
                    <h3 class="vehicle-name">${vehicleName}</h3>
                    <p class="vehicle-model">${vehicleYear} ${vehicleModel}</p>
                </div>
                <div class="battery-indicator">
                    <div class="battery-icon ${getBatteryClass(batteryPercent)} ${isCharging ? 'charging' : ''}">
                        <div class="battery-fill ${getBatteryClass(batteryPercent)} ${isCharging ? 'charging' : ''}" 
                             style="width: ${batteryPercent}%"></div>
                    </div>
                    <span class="battery-percentage">${batteryPercent}%</span>
                </div>
            </div>
            ${vehicleStatus === 'Charging' ? '<div class="charging-status charging">⚡ Charging (' + (vehicle.stateDuration || 'Unknown') + ')</div>' : ''}
            ${vehicleStatus === 'On Trip' ? '<div class="trip-status on-trip" id="trip-status-' + vehicle.id + '">🚗 On Trip (' + (vehicle.stateDuration || 'Unknown') + ')</div>' : ''}
            ${isVehicleParked(vehicle) ? '<div class="parking-status parked" id="parking-status-' + vehicle.id + '">🅿️ Parked (' + (vehicle.stateDuration || 'Unknown') + ')</div>' : ''}
            ${locationWarning}
            <div class="vehicle-details">
                <div class="detail-item">
                    <span class="detail-label">Location</span>
                    <span class="detail-value">${address}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Client</span>
                    <span class="detail-value client-name">${clientName}</span>
                </div>
            </div>
        `;

        vehicleList.appendChild(vehicleCard);

        // NEW ARCHITECTURE: Duration already included from MongoDB API
        // No need to fetch separately - stateDuration is provided directly
        if (vehicle.newArchitecture) {
            console.log(`🚀 NEW ARCHITECTURE: ${vehicle.name} ${vehicle.state} duration: ${vehicle.stateDuration}`);
        } else {
            // Legacy fallback: Fetch duration from separate APIs
            if (isVehicleParked(vehicle)) {
                fetchParkingDuration(vehicle.id, vehicle.vin || vehicle.id);
            }
            if (vehicleStatus === 'On Trip') {
                fetchTripDuration(vehicle.id, vehicle.vin || vehicle.id);
            }
        }
    });
}

// Helper function to get client name - will be populated via Jobber integration
function getClientName(vehicleName, address) {
    // Placeholder until Jobber integration is complete
    return 'Pending Jobber';
}

// Check if location data is stale (hasn't updated in reasonable time)
function checkLocationFreshness(vehicleId, location) {
    const now = Date.now();
    const locationKey = `${location.latitude.toFixed(6)},${location.longitude.toFixed(6)}`;
    
    if (!locationHistory.has(vehicleId)) {
        locationHistory.set(vehicleId, { locationKey, firstSeen: now, lastUpdate: now });
        return false; // New location, not stale
    }
    
    const history = locationHistory.get(vehicleId);
    
    // If location changed, update history
    if (history.locationKey !== locationKey) {
        locationHistory.set(vehicleId, { locationKey, firstSeen: now, lastUpdate: now });
        return false; // Location changed, definitely fresh
    }
    
    // Same location - check how long it's been the same
    const timeSinceFirstSeen = now - history.firstSeen;
    const STALE_THRESHOLD = 2 * 60 * 60 * 1000; // 2 hours (reduced from 4)
    
    return timeSinceFirstSeen > STALE_THRESHOLD;
}

// Get staleness level for more detailed warnings
function getLocationStaleness(vehicleId, location) {
    const now = Date.now();
    const locationKey = `${location.latitude.toFixed(6)},${location.longitude.toFixed(6)}`;
    
    if (!locationHistory.has(vehicleId)) {
        locationHistory.set(vehicleId, { locationKey, firstSeen: now, lastUpdate: now });
        return { level: 'fresh', age: 0, message: 'Current location' };
    }
    
    const history = locationHistory.get(vehicleId);
    
    // If location changed, update history
    if (history.locationKey !== locationKey) {
        locationHistory.set(vehicleId, { locationKey, firstSeen: now, lastUpdate: now });
        return { level: 'fresh', age: 0, message: 'Location just updated' };
    }
    
    // Same location - calculate age
    const ageMinutes = Math.floor((now - history.firstSeen) / (60 * 1000));
    
    if (ageMinutes < 30) {
        return { level: 'fresh', age: ageMinutes, message: `${ageMinutes}m ago` };
    } else if (ageMinutes < 120) {
        return { level: 'warning', age: ageMinutes, message: `${ageMinutes}m ago - may be stale` };
    } else {
        const ageHours = Math.floor(ageMinutes / 60);
        return { level: 'stale', age: ageMinutes, message: `${ageHours}h ago - likely outdated` };
    }
}

// Fetch real parking duration from parking detection service
async function getParkingDuration(vehicleId) {
    try {
        const response = await fetch(`/api/parking-detection/status/${vehicleId}`);
        const data = await response.json();
        
        if (data.success && data.status.isParked) {
            return data.status.duration + (data.status.cycles > 0 ? ` (${data.status.cycles} cycles)` : '');
        } else {
            return '0m'; // Not parked
        }
    } catch (error) {
        console.warn('Could not fetch parking duration:', error);
        return 'Unknown';
    }
}

// Helper function to simulate trip duration (placeholder)
function getTripDuration() {
    const durations = ['12m', '8m', '25m', '35m', '3m'];
    return durations[Math.floor(Math.random() * durations.length)];
}

// Helper function to get vehicle status text for detailed view
function getVehicleStatusText(vehicleId) {
    // Find the vehicle in the current data
    const vehicleData = vehicles.find(v => v.id === vehicleId);
    if (vehicleData) {
        const status = getVehicleStatus(vehicleData);
        return `Online - ${status}`;
    }
    return 'Online - Unknown';
}

// Select and show vehicle details
async function selectVehicle(vehicleId, vehicleName) {
    selectedVehicleId = vehicleId;
    const vehicleDetails = document.getElementById('vehicle-details');
    
    try {
        // Fetch vehicle location and info
        const [location, info] = await Promise.all([
            fetchVehicleLocation(vehicleId),
            fetch(`/api/vehicles/${vehicleId}/info`).then(r => r.json())
        ]);
        
        const displayName = vehicleName || `Vehicle ${vehicleId.substring(0, 8)}`;
        const vehicleModel = info.model || 'F-150 Lightning';
        const vehicleYear = info.year || '2024';
        
        // Get battery info from API
        const batteryResponse = await fetch(`/api/vehicles/${vehicleId}/battery`);
        const batteryData = await batteryResponse.json();
        const batteryPercent = smartBatteryPercent(batteryData.battery?.percentRemaining || 0);
        const isCharging = batteryData.battery?.isCharging || false;
        function getBatteryClass(percent) {
            if (percent <= 35) return 'low';
            if (percent <= 70) return 'medium';
            return 'high';
        }
        
        vehicleDetails.innerHTML = `
            <div class="selected-vehicle">
                <h4>${displayName}</h4>
                <div class="detail-group">
                    <label>Model</label>
                    <p>${vehicleYear} Ford ${vehicleModel}</p>
                </div>
                <div class="detail-group">
                    <label>Current Charge</label>
                    <div class="battery-indicator">
                        <div class="battery-icon">
                            <div class="battery-fill ${getBatteryClass(batteryPercent)} ${isCharging ? 'charging' : ''}" 
                                 style="width: ${batteryPercent}%"></div>
                        </div>
                        <span class="battery-percentage">${batteryPercent}%</span>
                        ${isCharging ? '<span style="margin-left: 4px;">⚡</span>' : ''}
                    </div>
                </div>
                <div class="detail-group">
                    <label>Location</label>
                    <p>${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}</p>
                </div>
                <div class="detail-group">
                    <label>Status</label>
                    <p><span class="status-online">🟢 ${getVehicleStatusText(vehicleId)}</span></p>
                </div>
                <button onclick="centerOnVehicle('${vehicleId}')" class="btn btn-primary">📍 Center on Map</button>
            </div>
        `;
    } catch (error) {
        vehicleDetails.innerHTML = '<p>Error loading vehicle details</p>';
    }
}

// Center map on specific vehicle
function centerOnVehicle(vehicleId) {
    const marker = vehicleMarkers[vehicleId];
    if (marker) {
        map.setView(marker.getLatLng(), 15);
        marker.openPopup();
    }
}

// Auto-zoom to fit all vehicles with appropriate zoom level
function autoZoomToVehicles() {
    const markers = Object.values(vehicleMarkers);
    if (markers.length > 0) {
        const group = new L.featureGroup(markers);
        const bounds = group.getBounds();
        
        // Set minimum zoom level to ensure good detail
        const minZoom = 11;
        const maxZoom = 16;
        
        map.fitBounds(bounds, {
            padding: [20, 20],
            minZoom: minZoom,
            maxZoom: maxZoom
        });
    }
}

// Center map on all vehicles (same as auto-zoom but can be called manually)
function centerAllVehicles() {
    autoZoomToVehicles();
}

// Refresh locations
async function refreshLocations() {
    const perfStart = perfLog('refreshLocations');
    const refreshBtn = document.getElementById('refresh-btn');

    // Throttling is handled in fetchAllVehicleLocations
    if (refreshBtn) {
        refreshBtn.textContent = '⏳ Refreshing...';
        refreshBtn.disabled = true;
    }

    try {
        const vehicleLocations = await fetchAllVehicleLocations();
        if (vehicleLocations && vehicleLocations.length > 0) {
            vehicles = vehicleLocations;
            updateVehicleMarkers(vehicleLocations);
        }
        perfLog('refreshLocations', perfStart);
    } catch (error) {
        console.error('Error refreshing locations:', error);
        perfLog('refreshLocations - error', perfStart);
    } finally {
        if (refreshBtn) {
            refreshBtn.textContent = '🔄 Refresh Locations';
            refreshBtn.disabled = false;
        }
    }
}

// Fetch parking duration for a specific vehicle using enhanced parking API
async function fetchParkingDuration(vehicleId, vin) {
    console.log('🅿️ fetchParkingDuration called for:', vehicleId, 'VIN:', vin);
    
    const parkingElement = document.querySelector(`#parking-status-${vehicleId} .parking-duration`);
    
    if (!parkingElement) {
        console.warn('🅿️ No parking element found for vehicle:', vehicleId);
        return;
    }
    
    try {
        // Use VIN if available, otherwise use vehicleId
        const identifier = vin || vehicleId;
        
        // Call the resilient parking API that uses backgroundMonitoringService
        const response = await fetch(addCacheBuster(`/api/ignition-trips/parking-status/${identifier}`));
        const data = await response.json();
        
        console.log('🅿️ Resilient parking API response for', identifier, ':', data);

        if (data.success && data.status) {
            if (data.status.isParked && data.status.duration) {
                parkingElement.textContent = data.status.duration;
                console.log('🅿️ Updated parking duration to:', data.status.duration);
            } else {
                parkingElement.textContent = 'Not parked';
                console.log('🅿️ Vehicle not currently parked');
            }
            console.log('✅ Using resilient parking API data - duration:', data.status.duration);
            return; // Exit early - don't fall back to old API
        } else {
            console.warn('🅿️ Invalid API response:', data);
            parkingElement.textContent = 'Unknown';
        }
        
    } catch (error) {
        console.error('🅿️ Error fetching parking duration from enhanced API:', error);
        
        // Fallback to old API if enhanced fails
        try {
            const fallbackResponse = await fetch(addCacheBuster(`/api/parking-detection/status/${vehicleId}`));
            const fallbackData = await fallbackResponse.json();
            
            if (fallbackData.success && fallbackData.status.isParked) {
                parkingElement.textContent = fallbackData.status.duration;
                console.log('🅿️ Fallback API provided duration:', fallbackData.status.duration);
            } else {
                parkingElement.textContent = 'N/A';
            }
        } catch (fallbackError) {
            console.error('🅿️ Fallback API also failed:', fallbackError);
            parkingElement.textContent = 'Error';
        }
    }
}

// Fetch trip duration for a specific vehicle using trip status API
async function fetchTripDuration(vehicleId, vin) {
    console.log('🚗 fetchTripDuration called for:', vehicleId, 'VIN:', vin);

    const tripElement = document.querySelector(`#trip-status-${vehicleId} .trip-duration`);

    if (!tripElement) {
        console.warn('🚗 No trip element found for vehicle:', vehicleId);
        return;
    }

    try {
        // Use VIN if available, otherwise use vehicleId
        const identifier = vin || vehicleId;

        // Call the trip status API that uses backgroundMonitoringService
        const response = await fetch(addCacheBuster(`/api/ignition-trips/trip-status/${identifier}`));
        const data = await response.json();

        console.log('🚗 Trip status API response for', identifier, ':', data);

        if (data.success && data.status) {
            if (data.status.isOnTrip && data.status.duration && data.status.duration !== '0m') {
                tripElement.textContent = data.status.duration;
                console.log('🚗 Updated trip duration to:', data.status.duration);
            } else {
                tripElement.textContent = 'Starting...';
                console.log('🚗 Vehicle trip just started or no duration yet');
            }
        } else {
            console.warn('🚗 Invalid trip API response:', data);
            tripElement.textContent = 'Unknown';
        }

    } catch (error) {
        console.error('🚗 Error fetching trip duration:', error);
        tripElement.textContent = 'Error';
    }
}

// Event listeners
document.getElementById('refresh-btn').addEventListener('click', refreshLocations);
document.getElementById('center-btn').addEventListener('click', centerAllVehicles);
document.getElementById('connect-vehicles-btn').addEventListener('click', () => {
    // Redirect to Smartcar OAuth flow
    window.location.href = '/auth/smartcar';
});

// Navigation dropdown functionality
document.addEventListener('DOMContentLoaded', () => {
    const dropdownBtn = document.getElementById('nav-dropdown-btn');
    const dropdownMenu = document.getElementById('nav-dropdown-menu');
    const dropdown = document.querySelector('.nav-dropdown');
    
    if (dropdownBtn && dropdownMenu && dropdown) {
        dropdownBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('active');
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!dropdown.contains(e.target)) {
                dropdown.classList.remove('active');
            }
        });
        
        // Close dropdown when pressing Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                dropdown.classList.remove('active');
            }
        });
    }
});

// Update global last-update banner
async function updateGlobalBanner() {
    try {
        const response = await fetch(addCacheBuster('/api/vehicle-state/all'));
        const data = await response.json();

        const banner = document.getElementById('global-last-update');
        if (banner && data.success && data.globalLastUpdate) {
            const lastUpdateTime = new Date(data.globalLastUpdate);
            const now = new Date();
            const freshnessMs = now.getTime() - lastUpdateTime.getTime();
            const freshnessSeconds = Math.floor(freshnessMs / 1000);

            let freshnessText;
            if (freshnessSeconds < 60) {
                freshnessText = `${freshnessSeconds}s ago`;
            } else if (freshnessSeconds < 3600) {
                freshnessText = `${Math.floor(freshnessSeconds / 60)}m ago`;
            } else {
                freshnessText = `${Math.floor(freshnessSeconds / 3600)}h ago`;
            }

            const isStale = freshnessMs > 10000; // 10 second threshold for banner

            banner.innerHTML = `
                <div class="banner-content">
                    <span class="banner-icon">${isStale ? '⚠️' : '🔄'}</span>
                    <span class="banner-text">
                        Global Last Update: ${lastUpdateTime.toLocaleTimeString()} (${freshnessText})
                        ${isStale ? ' - Data may be stale' : ' - Live data'}
                    </span>
                    <span class="banner-architecture">MongoDB Single Source</span>
                </div>
            `;

            // Update banner styling based on freshness
            banner.className = isStale ? 'warning' : 'info';
        }
    } catch (error) {
        console.error('Error updating global banner:', error);
        const banner = document.getElementById('global-last-update');
        if (banner) {
            banner.innerHTML = `
                <div class="banner-content">
                    <span class="banner-icon">❌</span>
                    <span class="banner-text">Error updating banner</span>
                </div>
            `;
            banner.className = 'error';
        }
    }
}

// Make functions globally available
window.selectVehicle = selectVehicle;
window.centerOnVehicle = centerOnVehicle;

// Optimized auto-refresh with performance tracking
let refreshIntervalId = null;

function startOptimizedRefresh() {
    // Initial load
    refreshLocations();
    updateGlobalBanner();

    // Intelligent refresh scheduling
    refreshIntervalId = setInterval(() => {
        const perfStart = perfLog('scheduled refresh');

        // Only refresh if we're not already refreshing (handled by throttling)
        Promise.all([
            refreshLocations(),
            updateGlobalBanner()
        ]).finally(() => {
            perfLog('scheduled refresh', perfStart);
        });
    }, 45000); // Refresh every 45 seconds

    perfLog('Optimized refresh system started');
}

// Start the optimized refresh system
startOptimizedRefresh();