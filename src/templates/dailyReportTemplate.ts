import moment from 'moment-timezone';

export interface DailyReportData {
    date: string;
    vehicles: Array<{
        name: string;
        trips: Array<any>;
        stats: {
            totalTrips: number;
            totalDistance: number;
            totalDuration: number;
            totalBatteryUsed: number;
        };
    }>;
    summary: {
        totalTrips: number;
        totalDistance: number;
        totalDuration: number;
        totalClientTime: number;
        activeVehicles: number;
    };
}

export function generateDailyReportHTML(data: DailyReportData): string {
    const formatTime = (isoString: string) => {
        return moment(isoString).tz('America/Chicago').format('h:mm A');
    };

    const formatDuration = (minutes: number) => {
        const hours = Math.floor(minutes / 60);
        const mins = Math.round(minutes % 60);
        if (hours > 0) {
            return `${hours}h ${mins}m`;
        }
        return `${mins}m`;
    };

    // Calculate client visits for each vehicle (only between trips, not including last trip)
    const vehiclesWithVisits = data.vehicles.map(vehicle => {
        const visits: any[] = [];

        vehicle.trips.forEach((trip: any, idx: number) => {
            const nextTrip = vehicle.trips[idx + 1];

            // Only calculate visits if there's a next trip (don't include the final stop)
            if (nextTrip && trip.endLocation && trip.endLocation.address) {
                const arrivalTime = new Date(trip.endTime);
                const departureTime = new Date(nextTrip.startTime);

                const dwellMinutes = Math.round((departureTime.getTime() - arrivalTime.getTime()) / (1000 * 60));

                // Only include visits longer than 5 minutes
                if (dwellMinutes > 5) {
                    const isHomeBase = trip.endLocation.clientName?.includes('🏠') ||
                                     trip.endLocation.clientName?.includes('McRay Shop') ||
                                     trip.endLocation.address?.includes('McRay Shop');
                    const isClient = trip.endLocation.clientName && !isHomeBase;

                    visits.push({
                        name: trip.endLocation.address,
                        isClient: isClient,
                        arrivalTime: arrivalTime,
                        departureTime: departureTime,
                        totalMinutes: dwellMinutes,
                        latitude: trip.endLocation.latitude,
                        longitude: trip.endLocation.longitude
                    });
                }
            }
        });

        return { ...vehicle, visits };
    });

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SparkLawn Daily Fleet Report - ${data.date}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: #f5f5f5;
            padding: 20px;
            font-size: 13px;
        }

        .pdf-container {
            max-width: 850px;
            margin: 0 auto;
            background: white;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }

        /* Header */
        .header {
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            color: white;
            padding: 15px 25px;
            border-bottom: 3px solid #047857;
        }

        .header-top {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }

        .logo {
            font-size: 18px;
            font-weight: 700;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .date-info {
            text-align: right;
        }

        .report-date {
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 2px;
        }

        .generated-time {
            font-size: 10px;
            opacity: 0.85;
        }

        /* Summary Stats Bar - Compact */
        .summary-bar {
            display: flex;
            justify-content: space-between;
            gap: 8px;
            margin-top: 10px;
        }

        .summary-stat {
            background: rgba(255,255,255,0.2);
            padding: 6px 10px;
            border-radius: 4px;
            text-align: center;
            flex: 1;
        }

        .summary-stat-value {
            font-size: 14px;
            font-weight: 700;
            margin-bottom: 2px;
        }

        .summary-stat-label {
            font-size: 8px;
            opacity: 0.9;
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }

        /* Content */
        .content {
            padding: 20px 25px;
        }

        /* Vehicle Section */
        .vehicle-section {
            margin-bottom: 20px;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            overflow: hidden;
            page-break-inside: avoid;
        }

        .vehicle-header {
            background: #f9fafb;
            border-bottom: 2px solid #10b981;
            padding: 14px 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .vehicle-name {
            font-size: 17px;
            font-weight: 700;
            color: #1f2937;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .vehicle-stats {
            display: flex;
            gap: 18px;
            font-size: 12px;
            color: #6b7280;
        }

        .vehicle-stat {
            display: flex;
            flex-direction: column;
            align-items: flex-end;
        }

        .vehicle-stat-label {
            font-size: 10px;
            text-transform: uppercase;
            margin-bottom: 2px;
        }

        .vehicle-stat-value {
            font-size: 14px;
            font-weight: 600;
            color: #1f2937;
        }

        /* Client Visits Section */
        .client-visits-section {
            background: #fffbeb;
            border: 1px solid #fde68a;
            border-radius: 6px;
            padding: 12px 15px;
            margin: 15px 20px;
        }

        .client-visits-title {
            font-size: 12px;
            font-weight: 600;
            color: #92400e;
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .client-visit-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 6px 10px;
            margin-bottom: 4px;
            background: white;
            border-radius: 4px;
            font-size: 12px;
        }

        .client-visit-item:last-child {
            margin-bottom: 0;
        }

        .client-visit-name {
            font-weight: 600;
            color: #1f2937;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .visit-type-badge {
            font-size: 9px;
            font-weight: 600;
            padding: 2px 6px;
            border-radius: 8px;
            text-transform: uppercase;
        }

        .visit-type-client {
            background: #10b981;
            color: white;
        }

        .visit-type-other {
            background: #f59e0b;
            color: white;
        }

        .client-visit-time {
            color: #78716c;
            font-weight: 400;
            font-size: 11px;
        }

        .client-visit-time .duration {
            font-weight: 700;
            color: #059669;
            font-size: 13px;
            margin-left: 6px;
        }

        .trips-section-title {
            font-size: 12px;
            font-weight: 600;
            color: #1f2937;
            margin: 0 20px 10px 20px;
            padding-bottom: 8px;
            border-bottom: 1px solid #e5e7eb;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        /* Trips List */
        .trips-list {
            padding: 15px 20px;
        }

        .trip-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            margin-bottom: 3px;
            border-radius: 4px;
            background: #fafafa;
            border-left: 3px solid #10b981;
            font-size: 12px;
        }

        .trip-time-span {
            font-weight: 600;
            color: #1f2937;
            min-width: 140px;
        }

        .trip-route {
            flex: 1;
            color: #4b5563;
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 0 12px;
        }

        .trip-arrow {
            color: #10b981;
            font-weight: 700;
        }

        .client-badge-inline {
            display: inline;
            background: #10b981;
            color: white;
            font-size: 9px;
            font-weight: 600;
            padding: 1px 6px;
            border-radius: 8px;
            text-transform: uppercase;
            margin-left: 4px;
        }

        .trip-metrics-inline {
            display: flex;
            gap: 15px;
            font-size: 11px;
            color: #6b7280;
            min-width: 220px;
            justify-content: flex-end;
        }

        .trip-metric-inline {
            white-space: nowrap;
        }

        /* Vehicle Daily Summary */
        .vehicle-summary {
            background: #f0fdf4;
            border-top: 1px solid #bbf7d0;
            padding: 14px 20px;
        }

        .vehicle-summary-title {
            font-size: 12px;
            font-weight: 600;
            color: #065f46;
            margin-bottom: 10px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .vehicle-summary-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 12px;
        }

        .vehicle-summary-item {
            display: flex;
            flex-direction: column;
        }

        .vehicle-summary-label {
            font-size: 10px;
            color: #047857;
            margin-bottom: 3px;
            text-transform: uppercase;
        }

        .vehicle-summary-value {
            font-size: 16px;
            font-weight: 700;
            color: #065f46;
        }

        /* Footer */
        .footer {
            background: #f9fafb;
            border-top: 1px solid #e5e7eb;
            padding: 16px 35px;
            text-align: center;
            color: #6b7280;
            font-size: 11px;
        }

        .footer-logo {
            font-weight: 600;
            color: #10b981;
        }

        @media print {
            body {
                padding: 0;
            }
            .pdf-container {
                box-shadow: none;
            }
        }
    </style>
</head>
<body>
    <div class="pdf-container">
        <!-- Header -->
        <div class="header">
            <div class="header-top">
                <div class="logo">
                    🌱 SparkLawn Fleet Report
                </div>
                <div class="date-info">
                    <div class="report-date">Daily Trip Summary</div>
                    <div class="generated-time">${data.date}</div>
                </div>
            </div>

            <!-- Fleet Summary Stats -->
            <div class="summary-bar">
                <div class="summary-stat">
                    <div class="summary-stat-value">${data.summary.totalDistance.toFixed(1)}</div>
                    <div class="summary-stat-label">Total Miles</div>
                </div>
                <div class="summary-stat">
                    <div class="summary-stat-value">${data.summary.totalTrips}</div>
                    <div class="summary-stat-label">Total Trips</div>
                </div>
                <div class="summary-stat">
                    <div class="summary-stat-value">${formatDuration(data.summary.totalDuration)}</div>
                    <div class="summary-stat-label">Drive Time</div>
                </div>
                <div class="summary-stat">
                    <div class="summary-stat-value">${formatDuration(data.summary.totalClientTime || 0)}</div>
                    <div class="summary-stat-label">Client Time</div>
                </div>
                <div class="summary-stat">
                    <div class="summary-stat-value">${data.summary.activeVehicles}</div>
                    <div class="summary-stat-label">Active Vehicles</div>
                </div>
            </div>
        </div>

        <!-- Content -->
        <div class="content">
            ${vehiclesWithVisits.map(vehicle => {
                // Calculate client time for this vehicle
                let vehicleClientMinutes = 0;
                vehicle.visits.forEach((visit: any) => {
                    if (visit.isClient) {
                        vehicleClientMinutes += visit.totalMinutes;
                    }
                });

                return `
            <div class="vehicle-section">
                <div class="vehicle-header">
                    <div class="vehicle-name">
                        ⚡ ${vehicle.name}
                    </div>
                    <div class="vehicle-stats">
                        <div class="vehicle-stat">
                            <div class="vehicle-stat-label">Miles</div>
                            <div class="vehicle-stat-value">${vehicle.stats.totalDistance.toFixed(1)}</div>
                        </div>
                    </div>
                </div>

                ${vehicle.visits.length > 0 ? `
                <div class="client-visits-section">
                    <div class="client-visits-title">⏱️ Visit Summary</div>
                    ${vehicle.visits.map((visit: any) => {
                        const badgeClass = visit.isClient ? 'visit-type-client' : 'visit-type-other';
                        const badgeText = visit.isClient ? 'Client' : 'Other';
                        const arrivalTimeStr = formatTime(visit.arrivalTime.toISOString());
                        const departureTimeStr = formatTime(visit.departureTime.toISOString());

                        return `
                    <div class="client-visit-item">
                        <div class="client-visit-name">
                            ${visit.name}
                            <span class="visit-type-badge ${badgeClass}">${badgeText}</span>
                        </div>
                        <div class="client-visit-time">${arrivalTimeStr} - ${departureTimeStr}<span class="duration">(${formatDuration(visit.totalMinutes)})</span></div>
                    </div>
                        `;
                    }).join('')}
                </div>
                ` : ''}

                <div class="trips-section-title">🚗 Trip Summary</div>
                <div class="trips-list">
                    ${vehicle.trips.map((trip: any) => {
                        const startTime = formatTime(trip.startTime);
                        const endTime = formatTime(trip.endTime);
                        const startLocation = trip.startLocation?.address || 'Unknown';
                        const endLocation = trip.endLocation?.address || 'Unknown';

                        const isEndHomeBase = trip.endLocation?.clientName?.includes('🏠') ||
                                            trip.endLocation?.clientName?.includes('McRay Shop') ||
                                            trip.endLocation?.address?.includes('McRay Shop');
                        const isEndClient = trip.endLocation?.clientName && !isEndHomeBase;
                        const clientBadge = isEndClient ? '<span class="client-badge-inline">Client</span>' : '';

                        // Note: trip.duration is ALREADY in MINUTES from tripTimelineService
                        const durationMinutes = Math.round(trip.duration || 0);

                        return `
                    <div class="trip-item">
                        <div class="trip-time-span">${startTime} - ${endTime}</div>
                        <div class="trip-route">
                            ${startLocation}
                            <span class="trip-arrow">→</span>
                            ${endLocation}${clientBadge}
                        </div>
                        <div class="trip-metrics-inline">
                            <span class="trip-metric-inline">${formatDuration(durationMinutes)}</span>
                            <span class="trip-metric-inline">${(trip.distance || 0).toFixed(1)} mi</span>
                        </div>
                    </div>
                        `;
                    }).join('')}
                </div>

                <div class="vehicle-summary">
                    <div class="vehicle-summary-title">Daily Summary - ${vehicle.name}</div>
                    <div class="vehicle-summary-grid">
                        <div class="vehicle-summary-item">
                            <div class="vehicle-summary-label">Total Trips</div>
                            <div class="vehicle-summary-value">${vehicle.stats.totalTrips}</div>
                        </div>
                        <div class="vehicle-summary-item">
                            <div class="vehicle-summary-label">Total Miles</div>
                            <div class="vehicle-summary-value">${vehicle.stats.totalDistance.toFixed(1)}</div>
                        </div>
                        <div class="vehicle-summary-item">
                            <div class="vehicle-summary-label">Drive Time</div>
                            <div class="vehicle-summary-value">${formatDuration(vehicle.stats.totalDuration)}</div>
                        </div>
                        <div class="vehicle-summary-item">
                            <div class="vehicle-summary-label">Client Time</div>
                            <div class="vehicle-summary-value">${formatDuration(vehicleClientMinutes)}</div>
                        </div>
                    </div>
                </div>
            </div>
                `;
            }).join('')}
        </div>

        <!-- Footer -->
        <div class="footer">
            <div style="margin-bottom: 6px;">
                <span class="footer-logo">SparkLawn Fleet Dashboard</span> • Powered by Ford Telematics API
            </div>
            <div>
                Report generated ${moment().tz('America/Chicago').format('MMMM DD, YYYY [at] h:mm A z')}
            </div>
        </div>
    </div>
</body>
</html>
    `;
}
