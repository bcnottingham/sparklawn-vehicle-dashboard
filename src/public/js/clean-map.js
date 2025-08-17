/**
 * Clean Location-Focused Fleet Tracking
 * SparkLawn Vehicle Dashboard
 */

class FleetDashboard {
    constructor() {
        this.map = null;
        this.vehicles = [];
        this.vehicleMarkers = {};
        this.selectedVehicleId = null;
        this.isLoading = false;
        this.refreshInterval = null;
        
        this.config = {
            mapCenter: [36.3, -94.2],
            mapZoom: 10,
            refreshInterval: 45000, // 45 seconds
            apiEndpoints: {
                vehicles: '/api/vehicles/with-names',
                debug: '/api/vehicles/debug'
            }
        };
        
        this.init();
    }
    
    // Initialize the dashboard
    init() {
        this.initializeMap();
        this.setupEventListeners();
        this.loadVehicleData();
        this.startAutoRefresh();
        
        console.log('✅ FleetDashboard initialized');
    }
    
    // Initialize Leaflet map
    initializeMap() {
        this.map = L.map('map', {
            center: this.config.mapCenter,
            zoom: this.config.mapZoom,
            zoomControl: false
        });
        
        // Add OpenStreetMap tiles
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 18
        }).addTo(this.map);
        
        console.log('✅ Map initialized');
    }
    
    // Set up event listeners
    setupEventListeners() {
        document.getElementById('refresh-btn')?.addEventListener('click', () => this.loadVehicleData());
        document.getElementById('center-btn')?.addEventListener('click', () => this.centerAllVehicles());
        document.getElementById('layers-btn')?.addEventListener('click', () => this.toggleMapLayers());
    }
    
    // Load vehicle data from API
    async loadVehicleData() {
        if (this.isLoading) return;
        
        this.setLoadingState(true);
        
        try {
            const timestamp = new Date().getTime();
            const response = await fetch(`${this.config.apiEndpoints.vehicles}?t=${timestamp}`);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            this.vehicles = data.vehicles || [];
            
            this.updateVehicleMarkers();
            this.updateVehicleList();
            this.updateStatusIndicators();
            
            console.log(`✅ Loaded ${this.vehicles.length} vehicles`);
            
        } catch (error) {
            console.error('❌ Failed to load vehicles:', error);
            this.showErrorState(error.message);
        } finally {
            this.setLoadingState(false);
        }
    }
    
    // Update vehicle markers on map
    updateVehicleMarkers() {
        // Clear existing markers
        Object.values(this.vehicleMarkers).forEach(marker => this.map.removeLayer(marker));
        this.vehicleMarkers = {};
        
        if (this.vehicles.length === 0) return;
        
        this.vehicles.forEach(vehicle => {
            if (!vehicle.location?.latitude || !vehicle.location?.longitude) return;
            
            const marker = L.marker(
                [vehicle.location.latitude, vehicle.location.longitude],
                { icon: this.createVehicleIcon(vehicle) }
            ).addTo(this.map);
            
            marker.bindPopup(this.createPopupContent(vehicle));
            marker.on('click', () => this.selectVehicle(vehicle.id));
            
            this.vehicleMarkers[vehicle.id] = marker;
        });
        
        // Auto-fit map if vehicles are loaded
        this.autoFitMap();
    }
    
    // Create custom vehicle icon
    createVehicleIcon(vehicle) {
        const batteryLevel = vehicle.battery?.percentRemaining || 0;
        const isCharging = vehicle.battery?.isCharging || false;
        
        let iconClass = 'vehicle-icon-enhanced';
        if (batteryLevel <= 35) iconClass += ' low-battery';
        if (isCharging) iconClass += ' charging';
        
        return L.divIcon({
            html: `
                <div class="vehicle-marker-enhanced">
                    <div class="${iconClass}">🚙</div>
                    <div class="vehicle-pulse-enhanced"></div>
                </div>
            `,
            className: 'custom-vehicle-marker',
            iconSize: [40, 40],
            iconAnchor: [20, 20]
        });
    }
    
    // Create popup content for vehicle markers
    createPopupContent(vehicle) {
        const batteryPercent = vehicle.battery?.percentRemaining || 0;
        const batteryClass = this.getBatteryClass(batteryPercent);
        const isCharging = vehicle.battery?.isCharging || false;
        const isPluggedIn = vehicle.battery?.isPluggedIn || false;
        const address = vehicle.location?.address || 'Location unavailable';
        const dataSource = vehicle.battery?._dataSource || 'unknown';
        
        let chargingStatus = '';
        if (isCharging) {
            chargingStatus = '<div class="charging-status">⚡ Charging</div>';
        } else if (isPluggedIn) {
            chargingStatus = '<div class="charging-status">🔌 Plugged In</div>';
        }
        
        return `
            <div class="vehicle-popup-enhanced">
                <h3>${vehicle.name}</h3>
                <div class="vehicle-model">${vehicle.year || ''} ${vehicle.model || 'Vehicle'}</div>
                
                <div class="battery-info">
                    <div class="battery-visual">
                        <div class="battery-fill ${batteryClass}" style="width: ${batteryPercent}%"></div>
                    </div>
                    <span class="battery-text">${batteryPercent}%</span>
                    ${chargingStatus}
                </div>
                
                <div class="location-info">${address}</div>
                <div class="data-source-info">Data: ${dataSource}</div>
                
                <button class="popup-button" onclick="fleetDashboard.selectVehicle('${vehicle.id}')">
                    View Details
                </button>
            </div>
        `;
    }
    
    // Update vehicle list in sidebar
    updateVehicleList() {
        const vehicleList = document.getElementById('vehicle-list');
        
        if (this.vehicles.length === 0) {
            vehicleList.innerHTML = `
                <div class="loading-state">
                    <span>No vehicles available</span>
                    <button onclick="fleetDashboard.loadVehicleData()" style="margin-top: 1rem; padding: 0.5rem 1rem; border: 1px solid var(--primary-green); background: transparent; border-radius: 0.5rem; cursor: pointer;">
                        Try Again
                    </button>
                </div>
            `;
            return;
        }
        
        vehicleList.innerHTML = '';
        
        this.vehicles.forEach(vehicle => {
            const vehicleCard = this.createVehicleCard(vehicle);
            vehicleList.appendChild(vehicleCard);
        });
    }
    
    // Create vehicle card for sidebar
    createVehicleCard(vehicle) {
        const card = document.createElement('div');
        card.className = 'vehicle-card';
        card.dataset.vehicleId = vehicle.id;
        
        const batteryPercent = vehicle.battery?.percentRemaining || 0;
        const batteryClass = this.getBatteryClass(batteryPercent);
        const isCharging = vehicle.battery?.isCharging || false;
        const isPluggedIn = vehicle.battery?.isPluggedIn || false;
        const address = vehicle.location?.address || 'Location unavailable';
        const dataSource = vehicle.battery?._dataSource || 'unknown';
        
        let chargingStatus = '';
        if (isCharging) {
            chargingStatus = '<div class="charging-status">⚡ Charging</div>';
        } else if (isPluggedIn) {
            chargingStatus = '<div class="charging-status">🔌 Plugged In</div>';
        }
        
        let dataSourceBadge = '';
        if (dataSource === 'fordpass') {
            dataSourceBadge = '<span class="data-badge fordpass">FordPass</span>';
        } else if (dataSource === 'smartcar') {
            dataSourceBadge = '<span class="data-badge smartcar">Smartcar</span>';
        } else {
            dataSourceBadge = '<span class="data-badge unknown">Unknown</span>';
        }
        
        card.innerHTML = `
            <div class="vehicle-header">
                <div>
                    <div class="vehicle-name">${vehicle.name}</div>
                    <div class="vehicle-model">${vehicle.year || ''} ${vehicle.model || 'Vehicle'}</div>
                </div>
                <button class="locate-button" onclick="fleetDashboard.centerOnVehicle('${vehicle.id}')" title="Locate on map">
                    📍
                </button>
            </div>
            
            <div class="battery-info">
                <div class="battery-visual">
                    <div class="battery-fill ${batteryClass}" style="width: ${batteryPercent}%"></div>
                </div>
                <span class="battery-text">${batteryPercent}%</span>
                ${chargingStatus}
            </div>
            
            <div class="location-info">${address}</div>
            
            <div class="card-footer">
                ${dataSourceBadge}
                <span class="last-updated">${new Date(vehicle.lastUpdated || Date.now()).toLocaleTimeString()}</span>
            </div>
        `;
        
        // Add click handler for card selection
        card.addEventListener('click', (e) => {
            if (!e.target.closest('.locate-button')) {
                this.selectVehicle(vehicle.id);
            }
        });
        
        return card;
    }
    
    // Get battery class for styling
    getBatteryClass(percent) {
        if (percent <= 35) return 'low';
        if (percent <= 70) return 'medium';
        return 'high';
    }
    
    // Select a vehicle
    selectVehicle(vehicleId) {
        this.selectedVehicleId = vehicleId;
        
        // Update UI
        document.querySelectorAll('.vehicle-card').forEach(card => {
            card.classList.remove('active');
        });
        
        const selectedCard = document.querySelector(`[data-vehicle-id="${vehicleId}"]`);
        if (selectedCard) {
            selectedCard.classList.add('active');
            selectedCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        
        // Center map on vehicle
        this.centerOnVehicle(vehicleId);
    }
    
    // Center map on specific vehicle
    centerOnVehicle(vehicleId) {
        const marker = this.vehicleMarkers[vehicleId];
        if (marker) {
            this.map.setView(marker.getLatLng(), 15);
            marker.openPopup();
        }
    }
    
    // Center map on all vehicles
    centerAllVehicles() {
        if (Object.keys(this.vehicleMarkers).length === 0) return;
        
        const group = new L.featureGroup(Object.values(this.vehicleMarkers));
        this.map.fitBounds(group.getBounds().pad(0.1));
    }
    
    // Auto-fit map to show all vehicles
    autoFitMap() {
        if (Object.keys(this.vehicleMarkers).length === 0) return;
        
        // Only auto-fit if we haven't manually selected a vehicle
        if (!this.selectedVehicleId) {
            this.centerAllVehicles();
        }
    }
    
    // Toggle map layers (future functionality)
    toggleMapLayers() {
        console.log('🗺️ Map layers toggle - future functionality');
        // Future: satellite view, traffic, etc.
    }
    
    // Update status indicators
    updateStatusIndicators() {
        const onlineCount = this.vehicles.length;
        const chargingCount = this.vehicles.filter(v => v.battery?.isCharging).length;
        
        document.getElementById('vehicle-count').textContent = `${onlineCount} vehicles`;
        document.getElementById('online-count').textContent = `${onlineCount} Online`;
        document.getElementById('last-update').textContent = new Date().toLocaleTimeString();
        document.getElementById('last-refresh').textContent = 'Updated now';
        
        // Update connection status
        document.getElementById('connection-status').textContent = 'Live';
    }
    
    // Set loading state
    setLoadingState(loading) {
        this.isLoading = loading;
        const refreshBtn = document.getElementById('refresh-btn');
        
        if (loading) {
            refreshBtn.innerHTML = '⏳';
            refreshBtn.disabled = true;
            document.getElementById('connection-status').textContent = 'Loading...';
        } else {
            refreshBtn.innerHTML = '🔄';
            refreshBtn.disabled = false;
        }
    }
    
    // Show error state
    showErrorState(message) {
        const vehicleList = document.getElementById('vehicle-list');
        vehicleList.innerHTML = `
            <div class="loading-state">
                <span style="color: var(--status-error);">⚠️ Connection Error</span>
                <div style="font-size: 0.75rem; color: var(--gray-500); margin: 0.5rem 0;">${message}</div>
                <button onclick="fleetDashboard.loadVehicleData()" style="margin-top: 1rem; padding: 0.5rem 1rem; border: 1px solid var(--status-error); background: transparent; border-radius: 0.5rem; cursor: pointer; color: var(--status-error);">
                    Retry Connection
                </button>
            </div>
        `;
        
        document.getElementById('connection-status').textContent = 'Error';
        document.getElementById('vehicle-count').textContent = '-- vehicles';
    }
    
    // Start auto-refresh
    startAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        
        this.refreshInterval = setInterval(() => {
            this.loadVehicleData();
        }, this.config.refreshInterval);
        
        console.log(`✅ Auto-refresh started (${this.config.refreshInterval / 1000}s interval)`);
    }
    
    // Stop auto-refresh
    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }
    
    // Cleanup
    destroy() {
        this.stopAutoRefresh();
        if (this.map) {
            this.map.remove();
        }
    }
}

// Initialize when DOM is ready
let fleetDashboard;

document.addEventListener('DOMContentLoaded', function() {
    console.log('🌱 SparkLawn Fleet Tracking - Clean Dashboard');
    fleetDashboard = new FleetDashboard();
});

// Handle page visibility changes (pause/resume auto-refresh)
document.addEventListener('visibilitychange', function() {
    if (fleetDashboard) {
        if (document.hidden) {
            fleetDashboard.stopAutoRefresh();
            console.log('⏸️ Auto-refresh paused (page hidden)');
        } else {
            fleetDashboard.startAutoRefresh();
            fleetDashboard.loadVehicleData(); // Refresh immediately when page becomes visible
            console.log('▶️ Auto-refresh resumed (page visible)');
        }
    }
});

// Clean up on page unload
window.addEventListener('beforeunload', function() {
    if (fleetDashboard) {
        fleetDashboard.destroy();
    }
});