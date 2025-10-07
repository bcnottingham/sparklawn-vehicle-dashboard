// Battery Status Component
function createBatteryIcon(batteryData) {
    const { percentRemaining, isPluggedIn, isCharging, range, _isMockData } = batteryData;
    
    // Smart percentage conversion - handle both decimal (0.895) and whole number (1) formats
    const batteryPercent = percentRemaining > 1 
        ? Math.round(percentRemaining) // Already a percentage (89.5 -> 90)
        : Math.round(percentRemaining * 100); // Decimal format (0.895 -> 90)
    
    // Determine battery level category
    let levelClass = 'battery-low';
    let statusClass = 'low';
    if (batteryPercent >= 70) {
        levelClass = 'battery-high';
        statusClass = 'high';
    } else if (batteryPercent >= 35) {
        levelClass = 'battery-medium';
        statusClass = 'medium';
    }
    
    // Calculate fill width (max 28px for the battery interior)
    const fillWidth = Math.max(2, (batteryPercent / 100) * 28);
    
    // Estimate time to full charge (rough calculation)
    const timeToFull = isCharging && batteryPercent < 100 
        ? Math.round((100 - batteryPercent) / 2) // Assume ~2% per minute
        : null;
    
    // Build the component HTML
    const chargingClass = isCharging ? 'battery-charging' : '';
    const mockWarning = _isMockData ? '<span class="mock-data-warning">MOCK DATA</span>' : '';
    
    return `
        <div class="battery-container">
            <div class="battery-icon ${levelClass} ${chargingClass}">
                <div class="battery-fill" style="width: ${fillWidth}px;"></div>
            </div>
            <span class="battery-status ${statusClass}">
                ${batteryPercent}%
            </span>
            ${isPluggedIn ? '<span class="plug-indicator">🔌</span>' : ''}
            ${isCharging ? `
                <span class="charging-indicator">⚡</span>
                ${timeToFull ? `<span class="charging-time">${timeToFull}min to full</span>` : ''}
            ` : ''}
            <span class="battery-range">(${range}mi)</span>
            ${mockWarning}
        </div>
    `;
}

// Battery status summary for fleet overview
function createFleetBatteryStatus(vehicles) {
    const batteryStats = {
        total: vehicles.length,
        charging: 0,
        pluggedIn: 0,
        low: 0,
        medium: 0,
        high: 0,
        avgPercent: 0
    };
    
    let totalPercent = 0;
    
    vehicles.forEach(vehicle => {
        const battery = vehicle.battery;
        const batteryPercent = battery.percentRemaining > 1 
            ? Math.round(battery.percentRemaining) 
            : Math.round(battery.percentRemaining * 100);
        totalPercent += batteryPercent;
        
        if (battery.isCharging) batteryStats.charging++;
        if (battery.isPluggedIn) batteryStats.pluggedIn++;
        
        if (batteryPercent < 35) batteryStats.low++;
        else if (batteryPercent < 70) batteryStats.medium++;
        else batteryStats.high++;
    });
    
    batteryStats.avgPercent = Math.round(totalPercent / vehicles.length);
    
    return `
        <div class="fleet-battery-overview">
            <h3>🔋 Fleet Battery Status</h3>
            <div class="battery-stats">
                <div class="stat-item">
                    <span class="stat-label">Average:</span>
                    <span class="stat-value">${batteryStats.avgPercent}%</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Charging:</span>
                    <span class="stat-value">${batteryStats.charging}/${batteryStats.total}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Plugged In:</span>
                    <span class="stat-value">${batteryStats.pluggedIn}/${batteryStats.total}</span>
                </div>
                <div class="battery-levels">
                    <span class="level-indicator high">🟢 ${batteryStats.high}</span>
                    <span class="level-indicator medium">🟡 ${batteryStats.medium}</span>
                    <span class="level-indicator low">🔴 ${batteryStats.low}</span>
                </div>
            </div>
        </div>
    `;
}

// Function to update battery display
function updateBatteryDisplay() {
    fetch('/vehicles/with-names')
        .then(response => response.json())
        .then(data => {
            const vehicleList = document.getElementById('vehicle-list');
            if (!vehicleList) return;
            
            vehicleList.innerHTML = '';
            
            data.vehicles.forEach(vehicle => {
                const vehicleCard = document.createElement('div');
                vehicleCard.className = 'vehicle-card';
                vehicleCard.innerHTML = `
                    <div class="vehicle-header">
                        <h4>${vehicle.name} (${vehicle.make} ${vehicle.model})</h4>
                        <span class="vehicle-year">${vehicle.year}</span>
                    </div>
                    <div class="vehicle-location">
                        📍 ${vehicle.location.address}
                    </div>
                    <div class="vehicle-battery">
                        ${createBatteryIcon(vehicle.battery)}
                    </div>
                `;
                vehicleList.appendChild(vehicleCard);
            });
            
            // Add fleet overview
            const fleetOverview = document.getElementById('fleet-overview');
            if (fleetOverview) {
                fleetOverview.innerHTML = createFleetBatteryStatus(data.vehicles);
            }
        })
        .catch(error => {
            console.error('Error fetching vehicle data:', error);
        });
}

// Auto-refresh every 30 seconds
setInterval(updateBatteryDisplay, 30000);

// Initial load
document.addEventListener('DOMContentLoaded', updateBatteryDisplay);