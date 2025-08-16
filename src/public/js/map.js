// Initialize the map
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

// Custom Ford vehicle icon
const fordIcon = L.divIcon({
    html: `<div class="vehicle-marker">
        <div class="vehicle-icon">🚙</div>
        <div class="vehicle-pulse"></div>
    </div>`,
    className: 'custom-vehicle-marker',
    iconSize: [40, 40],
    iconAnchor: [20, 20]
});

// Fetch vehicles list
async function fetchVehicles() {
    try {
        const response = await fetch('/vehicles');
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
        const response = await fetch(`/vehicles/${vehicleId}/location`);
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
        // Add cache-busting timestamp
        const timestamp = new Date().getTime();
        const response = await fetch(`/vehicles/with-names?t=${timestamp}`);
        const data = await response.json();
        return data.vehicles.filter(vehicle => vehicle.location && !vehicle.error);
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
    // Clear existing markers
    Object.values(vehicleMarkers).forEach(marker => map.removeLayer(marker));
    vehicleMarkers = {};

    vehicleLocations.forEach(vehicle => {
        const lat = vehicle.location?.latitude || vehicle.latitude;
        const lng = vehicle.location?.longitude || vehicle.longitude;
        
        if (lat && lng) {
            const marker = L.marker([lat, lng], { 
                icon: fordIcon 
            }).addTo(map);

            const vehicleName = vehicle.name || `Vehicle ${vehicle.id.substring(0, 8)}`;
            const vehicleModel = vehicle.model || 'Unknown';
            const vehicleYear = vehicle.year || '';
            const batteryPercent = vehicle.battery?.percentRemaining || 0;
            const address = vehicle.location?.address || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

            // Create battery level indicator
            function getBatteryClass(percent) {
                if (percent <= 25) return 'low';
                if (percent <= 60) return 'medium';
                return 'high';
            }

            marker.bindPopup(`
                <div class="vehicle-popup">
                    <h3>${vehicleName}</h3>
                    <p><strong>Model:</strong> ${vehicleYear} Ford ${vehicleModel}</p>
                    <div class="battery-display">
                        <div class="battery-icon">
                            <div class="battery-level ${getBatteryClass(batteryPercent)}" 
                                 style="width: ${batteryPercent}%"></div>
                        </div>
                        <span class="battery-text">${batteryPercent}%</span>
                    </div>
                    <p class="address-text">${address}</p>
                    <button onclick="selectVehicle('${vehicle.id}')">View Details</button>
                </div>
            `);

            marker.on('click', () => selectVehicle(vehicle.id, vehicleName));
            vehicleMarkers[vehicle.id] = marker;
        }
    });

    // Update vehicle list in sidebar
    updateVehicleList(vehicleLocations);
    updateLastUpdate();
}

// Update vehicle count display
function updateVehicleCount() {
    document.getElementById('vehicle-count').textContent = `${vehicles.length} vehicles online`;
}

// Update last update time
function updateLastUpdate() {
    const now = new Date();
    document.getElementById('last-update').textContent = 
        `Last updated: ${now.toLocaleTimeString()}`;
}

// Update vehicle list in sidebar
function updateVehicleList(vehicleLocations) {
    const vehicleList = document.getElementById('vehicle-list');
    vehicleList.innerHTML = '';

    vehicleLocations.forEach(vehicle => {
        const lat = vehicle.location?.latitude || vehicle.latitude;
        const lng = vehicle.location?.longitude || vehicle.longitude;
        const vehicleName = vehicle.name || `Vehicle ${vehicle.id.substring(0, 8)}`;
        const vehicleModel = vehicle.model || 'Unknown';
        const batteryPercent = vehicle.battery?.percentRemaining || 0;
        const address = vehicle.location?.address || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        
        function getBatteryClass(percent) {
            if (percent <= 25) return 'low';
            if (percent <= 60) return 'medium';
            return 'high';
        }
        
        const vehicleItem = document.createElement('div');
        vehicleItem.className = 'vehicle-item';
        vehicleItem.innerHTML = `
            <div class="vehicle-info">
                <h4>${vehicleName}</h4>
                <p>${vehicleModel}</p>
                <div class="battery-display">
                    <div class="battery-icon">
                        <div class="battery-level ${getBatteryClass(batteryPercent)}" 
                             style="width: ${batteryPercent}%"></div>
                    </div>
                    <span class="battery-text">${batteryPercent}%</span>
                </div>
                <p class="address-text">${address}</p>
            </div>
            <button onclick="centerOnVehicle('${vehicle.id}')">📍</button>
        `;
        vehicleList.appendChild(vehicleItem);
    });
}

// Select and show vehicle details
async function selectVehicle(vehicleId, vehicleName) {
    selectedVehicleId = vehicleId;
    const vehicleDetails = document.getElementById('vehicle-details');
    
    try {
        // Fetch vehicle location and info
        const [location, info] = await Promise.all([
            fetchVehicleLocation(vehicleId),
            fetch(`/vehicles/${vehicleId}/info`).then(r => r.json())
        ]);
        
        const displayName = vehicleName || `Vehicle ${vehicleId.substring(0, 8)}`;
        const vehicleModel = info.model || 'F-150 Lightning';
        const vehicleYear = info.year || '2024';
        
        // Get battery info (simulated for now)
        const batteryPercent = Math.floor(Math.random() * 40) + 60; // 60-100%
        function getBatteryClass(percent) {
            if (percent <= 25) return 'low';
            if (percent <= 60) return 'medium';
            return 'high';
        }
        
        vehicleDetails.innerHTML = `
            <div class="selected-vehicle">
                <h4>${displayName}</h4>
                <div class="detail-group">
                    <label>Model:</label>
                    <p>${vehicleYear} Ford ${vehicleModel}</p>
                </div>
                <div class="detail-group">
                    <label>Current Charge:</label>
                    <div class="battery-display">
                        <div class="battery-icon">
                            <div class="battery-level ${getBatteryClass(batteryPercent)}" 
                                 style="width: ${batteryPercent}%"></div>
                        </div>
                        <span class="battery-text">${batteryPercent}%</span>
                    </div>
                </div>
                <div class="detail-group">
                    <label>Location:</label>
                    <p>${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}</p>
                </div>
                <div class="detail-group">
                    <label>Status:</label>
                    <p><span class="status-online">🟢 Online</span></p>
                </div>
                <button onclick="centerOnVehicle('${vehicleId}')" class="btn-primary">📍 Center on Map</button>
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

// Center map on all vehicles
function centerAllVehicles() {
    const markers = Object.values(vehicleMarkers);
    if (markers.length > 0) {
        const group = new L.featureGroup(markers);
        map.fitBounds(group.getBounds().pad(0.1));
    }
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

// Event listeners
document.getElementById('refresh-btn').addEventListener('click', refreshLocations);
document.getElementById('center-btn').addEventListener('click', centerAllVehicles);

// Make functions globally available
window.selectVehicle = selectVehicle;
window.centerOnVehicle = centerOnVehicle;

// Initial load and auto-refresh
refreshLocations();
setInterval(refreshLocations, 45000); // Refresh every 45 seconds