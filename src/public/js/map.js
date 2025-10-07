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
    
    if (isCharging) return 'Charging';
    if (isOnTrip) return 'On Trip';
    return 'Parked';
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
        const response = await fetch('/api/vehicles');
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
        const response = await fetch(`/api/vehicles/${vehicleId}/location`);
        const location = await response.json();
        return { id: vehicleId, ...location };
    } catch (error) {
        console.error(`Error fetching location for vehicle ${vehicleId}:`, error);
        return null;
    }
}

// Fetch all vehicles with names and locations
async function fetchAllVehicleLocations() {
    try {
        // Add strong cache-busting timestamp and random value
        const timestamp = new Date().getTime();
        const random = Math.random().toString(36).substring(7);
        const response = await fetch(`/api/vehicles/with-names?t=${timestamp}&r=${random}`, {
            cache: 'no-cache',
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        });
        const data = await response.json();
        const vehicles = data.vehicles.filter(vehicle => vehicle.location && !vehicle.error);
        
        // Fetch active trips to determine which vehicles are "On Trip"
        try {
            const activeTripsResponse = await fetch('/api/ignition-trips/active');
            const activeTripsData = await activeTripsResponse.json();
            const activeVehicleIds = new Set(activeTripsData.trips?.map(trip => trip.vehicleId) || []);
            
            // Mark vehicles as on trip if they have active trips
            vehicles.forEach(vehicle => {
                vehicle.isOnTrip = activeVehicleIds.has(vehicle.id);
            });
        } catch (tripError) {
            console.warn('Could not fetch active trips, using default status:', tripError);
        }
        
        return vehicles;
    } catch (error) {
        console.error('Error fetching vehicles with names:', error);
        // Fallback to old method
        const vehicleIds = await fetchVehicles();
        const locationPromises = vehicleIds.map(id => fetchVehicleLocation(id));
        const locations = await Promise.all(locationPromises);
        return locations.filter(location => location !== null);
    }
}

// Update vehicle markers on map
function updateVehicleMarkers(vehicleLocations) {
    // Clear existing markers and cluster group
    if (markerClusterGroup) {
        map.removeLayer(markerClusterGroup);
    }
    
    // Create new marker cluster group with custom styling
    markerClusterGroup = L.markerClusterGroup({
        // Custom cluster icon - matches vehicle pin style
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
        // Tighter clustering - only group vehicles within ~0.1 miles  
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        maxClusterRadius: 80, // ~0.05 miles in meters - much tighter clustering
        disableClusteringAtZoom: 15 // Start showing individual pins earlier
    });
    
    vehicleMarkers = {};

    vehicleLocations.forEach(vehicle => {
        const lat = vehicle.location?.latitude || vehicle.latitude;
        const lng = vehicle.location?.longitude || vehicle.longitude;
        
        console.log(`Vehicle ${vehicle.name} (${vehicle.id.substring(0,8)}): ${lat}, ${lng} - ${vehicle.location?.address}`);
        
        if (lat && lng) {
            const marker = L.marker([lat, lng], { 
                icon: createVehicleIcon(vehicle)
            });

            const vehicleName = vehicle.name || `Vehicle ${vehicle.id.substring(0, 8)}`;
            const vehicleModel = vehicle.model || 'Unknown';
            const vehicleYear = vehicle.year || '';
            const batteryPercent = smartBatteryPercent(vehicle.battery?.percentRemaining || 0);
            const address = vehicle.location?.address || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

            // Create battery level indicator
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
            
            // Add marker to cluster group
            markerClusterGroup.addLayer(marker);
        }
    });

    // Add the cluster group to the map
    if (markerClusterGroup) {
        map.addLayer(markerClusterGroup);
    }

    // Update vehicle list in sidebar
    updateVehicleList(vehicleLocations);
    updateVehicleCount(vehicleLocations.length);
    updateDataSourceDisplay(vehicleLocations);
    updateLastUpdate();
    
    // Auto-zoom to fit all vehicles
    autoZoomToVehicles();
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
        
        // FORCE ALL VEHICLES TO SHOW PARKING STATUS - NO CONDITIONS
        console.log('🔧 REWRITE: Forcing parking status display for vehicle:', vehicleName);
        const vehicleStatus = 'Parked'; // ALWAYS PARKED TO FORCE DURATION DISPLAY
        
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
            ${isCharging ? '<div class="charging-status charging">⚡ Charging</div>' : ''}
            ${!isCharging && isPluggedIn ? '<div class="charging-status plugged-in">🔌 Plugged In</div>' : ''}
            ${vehicleStatus === 'On Trip' ? '<div class="trip-status on-trip">🚗 On Trip</div>' : ''}
            <div class="parking-status parked always-show" id="parking-status-${vehicle.id}">🅿️ Parked (<span class="parking-duration">Loading...</span>)</div>
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
        
        // FORCE PARKING DURATION FETCH FOR ALL VEHICLES - NO CONDITIONS
        console.log('🔧 REWRITE: Fetching parking duration for vehicle:', vehicleName, 'ID:', vehicle.id);
        fetchParkingDuration(vehicle.id, vehicle.vin || vehicle.id);
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
    const refreshBtn = document.getElementById('refresh-btn');
    refreshBtn.textContent = '⏳ Refreshing...';
    refreshBtn.disabled = true;

    try {
        // First fetch vehicle count
        await fetchVehicles();
        // Then fetch locations with names
        const vehicleLocations = await fetchAllVehicleLocations();
        updateVehicleMarkers(vehicleLocations);
    } catch (error) {
        console.error('Error refreshing locations:', error);
    } finally {
        refreshBtn.textContent = '🔄 Refresh Locations';
        refreshBtn.disabled = false;
    }
}

// Fetch parking duration for a specific vehicle
async function fetchParkingDuration(vehicleId, vin) {
    try {
        const response = await fetch(`/api/ignition-trips/parking-status/${vin}`);
        if (response.ok) {
            const data = await response.json();
            const parkingElement = document.querySelector(`#parking-status-${vehicleId} .parking-duration`);
            if (parkingElement && data.status) {
                parkingElement.textContent = data.status.duration || '0m';
            }
        } else {
            console.warn(`Failed to fetch parking duration for vehicle ${vehicleId}: ${response.status}`);
            const parkingElement = document.querySelector(`#parking-status-${vehicleId} .parking-duration`);
            if (parkingElement) {
                parkingElement.textContent = 'N/A';
            }
        }
    } catch (error) {
        console.error(`Error fetching parking duration for vehicle ${vehicleId}:`, error);
        const parkingElement = document.querySelector(`#parking-status-${vehicleId} .parking-duration`);
        if (parkingElement) {
            parkingElement.textContent = 'Error';
        }
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

// Make functions globally available
window.selectVehicle = selectVehicle;
window.centerOnVehicle = centerOnVehicle;

// Initial load and auto-refresh
refreshLocations();
setInterval(refreshLocations, 5000); // Refresh every 5 seconds to match 3s backend polling