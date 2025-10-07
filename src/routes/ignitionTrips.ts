import { Router } from 'express';
import { backgroundMonitoringService } from '../services/backgroundMonitoringService';

const router = Router();

// Get ignition-based trips (enhanced trip logs)
router.get('/', async (req, res) => {
    try {
        const { vehicleId, limit } = req.query;
        const trips = await backgroundMonitoringService.getIgnitionTrips(
            vehicleId as string,
            parseInt(limit as string) || 50
        );

        // Convert km to miles for existing database trips
        const convertedTrips = trips.map(trip => ({
            ...trip,
            distanceTraveled: trip.distanceTraveled ? trip.distanceTraveled / 1.609344 : 0
        }));

        res.json({
            trips: convertedTrips,
            count: convertedTrips.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching ignition trips:', error);
        res.status(500).json({
            error: 'Failed to fetch ignition trips',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Get currently active trips (vehicles that are running)
router.get('/active', async (req, res) => {
    try {
        const activeTrips = await backgroundMonitoringService.getActiveTrips();
        
        res.json({
            activeTrips,
            count: activeTrips.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching active ignition trips:', error);
        res.status(500).json({
            error: 'Failed to fetch active trips',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Get vehicle statistics from ignition data
router.get('/stats/:vehicleId', async (req, res) => {
    try {
        const { vehicleId } = req.params;
        const { days } = req.query;
        
        const stats = await backgroundMonitoringService.getVehicleStats(
            vehicleId,
            parseInt(days as string) || 30
        );
        
        res.json({
            vehicleId,
            period: `${days || 30} days`,
            stats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching vehicle ignition stats:', error);
        res.status(500).json({
            error: 'Failed to fetch vehicle statistics',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Get detailed trip with full route data
router.get('/:tripId/route', async (req, res) => {
    try {
        const { tripId } = req.params;
        
        // Get the trip with all route points
        const trips = await backgroundMonitoringService.getIgnitionTrips();
        const trip = trips.find(t => t._id?.toString() === tripId);
        
        if (!trip) {
            return res.status(404).json({
                error: 'Trip not found'
            });
        }
        
        // Return trip with full route data for mapping
        res.json({
            trip,
            routePoints: trip.routePoints,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching trip route:', error);
        res.status(500).json({
            error: 'Failed to fetch trip route',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Get trip summary for reporting
router.get('/summary/daily', async (req, res) => {
    try {
        const { vehicleId, date } = req.query;
        
        // Parse date or use today
        const targetDate = date ? new Date(date as string) : new Date();
        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);
        
        // Get all trips (we'll filter in memory for now - can optimize with MongoDB query later)
        const allTrips = await backgroundMonitoringService.getIgnitionTrips(vehicleId as string, 1000);
        
        const dailyTrips = allTrips.filter(trip => 
            trip.ignitionOnTime >= startOfDay && 
            trip.ignitionOnTime <= endOfDay &&
            !trip.isActive
        );
        
        // Calculate daily summary with km→miles conversion
        const summary = {
            date: targetDate.toISOString().split('T')[0],
            vehicleId,
            totalTrips: dailyTrips.length,
            totalRunTime: dailyTrips.reduce((sum, trip) => sum + (trip.totalRunTime || 0), 0),
            totalDistance: dailyTrips.reduce((sum, trip) => sum + ((trip.distanceTraveled || 0) / 1.609344), 0), // Convert km to miles
            totalBatteryUsed: dailyTrips.reduce((sum, trip) => sum + (trip.batteryUsed || 0), 0),
            trips: dailyTrips.map(trip => ({
                id: trip._id,
                startTime: trip.ignitionOnTime,
                endTime: trip.ignitionOffTime,
                duration: trip.totalRunTime,
                distance: (trip.distanceTraveled || 0) / 1.609344, // Convert km to miles
                startAddress: trip.startLocation.address,
                endAddress: trip.endLocation?.address,
                clientName: trip.startLocation.clientName || trip.endLocation?.clientName,
                batteryUsed: trip.batteryUsed
            }))
        };
        
        res.json({
            summary,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching daily trip summary:', error);
        res.status(500).json({
            error: 'Failed to fetch daily summary',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Get monitoring service status
router.get('/monitoring/status', async (req, res) => {
    try {
        const activeTrips = await backgroundMonitoringService.getActiveTrips();
        
        res.json({
            isMonitoring: true, // Service should always be running
            activeTrips: activeTrips.length,
            monitoringInterval: '30 seconds',
            lastUpdate: new Date().toISOString(),
            status: 'operational'
        });
    } catch (error) {
        console.error('Error getting monitoring status:', error);
        res.status(500).json({
            error: 'Failed to get monitoring status',
            details: error instanceof Error ? error.message : 'Unknown error',
            status: 'error'
        });
    }
});

// Get real-time parking status (replaces stale parking-detection API)
router.get('/parking-status/:vehicleId', async (req, res) => {
    try {
        const { vehicleId } = req.params;
        const parkingStatus = await backgroundMonitoringService.getResilientParkingStatus(vehicleId);
        
        res.json({
            success: true,
            status: parkingStatus,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching real-time parking status:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch real-time parking status',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Get real-time trip status (duration for ON TRIP vehicles)
router.get('/trip-status/:vehicleId', async (req, res) => {
    try {
        const { vehicleId } = req.params;
        const tripStatus = await backgroundMonitoringService.getResilientTripStatus(vehicleId);

        res.json({
            success: true,
            status: tripStatus,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching real-time trip status:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch real-time trip status',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Debug endpoint to directly query MongoDB collections
router.get('/debug-collections/:vehicleId', async (req, res) => {
    try {
        const { vehicleId } = req.params;
        const { getDatabase } = await import('../db/index');
        const db = await getDatabase();

        // Get today's date range
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        // Query all relevant collections
        const collections = {
            movement_events: await db.collection('movement_events')
                .find({
                    vehicleId: vehicleId,
                    timestamp: { $gte: startOfDay, $lte: endOfDay }
                })
                .sort({ timestamp: 1 })
                .limit(10)
                .toArray(),

            trips: await db.collection('trips')
                .find({
                    vehicleId: vehicleId,
                    timestamp: { $gte: startOfDay, $lte: endOfDay }
                })
                .sort({ timestamp: 1 })
                .limit(10)
                .toArray(),

            ignition_trips: await db.collection('ignition_trips')
                .find({
                    vehicleId: vehicleId,
                    ignitionOnTime: { $gte: startOfDay, $lte: endOfDay }
                })
                .sort({ ignitionOnTime: 1 })
                .limit(10)
                .toArray(),

            route_points: await db.collection('route_points')
                .find({
                    vehicleId: vehicleId,
                    timestamp: { $gte: startOfDay, $lte: endOfDay }
                })
                .sort({ timestamp: 1 })
                .limit(10)
                .toArray()
        };

        // Get collection counts
        const counts = {
            movement_events: await db.collection('movement_events').countDocuments({
                vehicleId: vehicleId,
                timestamp: { $gte: startOfDay, $lte: endOfDay }
            }),
            trips: await db.collection('trips').countDocuments({
                vehicleId: vehicleId,
                timestamp: { $gte: startOfDay, $lte: endOfDay }
            }),
            ignition_trips: await db.collection('ignition_trips').countDocuments({
                vehicleId: vehicleId,
                ignitionOnTime: { $gte: startOfDay, $lte: endOfDay }
            }),
            route_points: await db.collection('route_points').countDocuments({
                vehicleId: vehicleId,
                timestamp: { $gte: startOfDay, $lte: endOfDay }
            })
        };

        res.json({
            success: true,
            vehicleId,
            dateRange: {
                start: startOfDay.toISOString(),
                end: endOfDay.toISOString()
            },
            counts,
            sampleData: collections,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error querying MongoDB collections directly:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to query MongoDB collections',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Timeline endpoint from route_points for Today's Trip Modal
router.get('/timeline-from-route-points/:vehicleId', async (req, res) => {
    try {
        const { vehicleId } = req.params;
        const { getDatabase } = await import('../db/index');
        const db = await getDatabase();

        // Get today's date range
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        // Get all route points for today
        const routePoints = await db.collection('route_points')
            .find({
                vehicleId: vehicleId,
                timestamp: { $gte: startOfDay, $lte: endOfDay }
            })
            .sort({ timestamp: 1 })
            .toArray();

        if (routePoints.length === 0) {
            return res.json({
                success: true,
                timeline: {
                    vehicleId,
                    vehicleName: getVehicleName(vehicleId),
                    date: startOfDay.toISOString().split('T')[0],
                    trips: [],
                    events: [],
                    summary: {
                        totalTrips: 0,
                        totalDistance: 0,
                        totalDuration: 0,
                        batteryUsed: 0
                    }
                },
                timestamp: new Date().toISOString()
            });
        }

        // Process route points into trips and events
        const trips: any[] = [];
        const events: any[] = [];
        let currentTrip: any = null;
        let tripCounter = 1;

        // Helper function to format time
        const formatTime = (date: Date) => {
            return date.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
        };

        for (let i = 0; i < routePoints.length; i++) {
            const point = routePoints[i];
            const prevPoint = i > 0 ? routePoints[i - 1] : null;
            const nextPoint = i < routePoints.length - 1 ? routePoints[i + 1] : null;

            // Detect trip start (ignition Off → On or first moving point)
            if (point.ignitionStatus === 'On' && (!prevPoint || prevPoint.ignitionStatus === 'Off')) {
                // Start new trip
                currentTrip = {
                    id: tripCounter++,
                    ignitionOnTime: new Date(point.timestamp),
                    startLocation: {
                        address: point.address || 'Unknown Location',
                        latitude: point.latitude,
                        longitude: point.longitude
                    },
                    ignitionOffTime: undefined,
                    endLocation: undefined,
                    duration: undefined,
                    distance: 0,
                    batteryStart: point.batteryLevel,
                    batteryEnd: undefined,
                    batteryUsed: 0,
                    vehicleId: point.vehicleId,
                    isActive: true
                };

                events.push({
                    time: formatTime(new Date(point.timestamp)),
                    type: 'Trip Start',
                    location: point.address || 'Unknown Location',
                    icon: '🚗',
                    battery: `${point.batteryLevel}%`
                });
            }

            // Detect trip end (ignition On → Off or last point in trip)
            if (currentTrip && (point.ignitionStatus === 'Off' && prevPoint && prevPoint.ignitionStatus === 'On')) {
                // End current trip
                currentTrip.ignitionOffTime = new Date(point.timestamp);
                currentTrip.endLocation = {
                    address: point.address || 'Unknown Location',
                    latitude: point.latitude,
                    longitude: point.longitude
                };
                currentTrip.batteryEnd = point.batteryLevel;
                currentTrip.batteryUsed = currentTrip.batteryStart - point.batteryLevel;
                currentTrip.isActive = false;

                // Calculate duration
                const startTimestamp = routePoints.find(p => p.ignitionStatus === 'On')?.timestamp;
                if (startTimestamp) {
                    const startTime = new Date(startTimestamp);
                    const endTime = new Date(point.timestamp);
                    const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / (1000 * 60));
                    currentTrip.duration = durationMinutes > 60
                        ? `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m`
                        : `${durationMinutes}m`;
                } else {
                    currentTrip.duration = '0m';
                }

                trips.push(currentTrip);

                events.push({
                    time: formatTime(new Date(point.timestamp)),
                    type: 'Trip End',
                    location: point.address || 'Unknown Location',
                    icon: '🅿️',
                    battery: `${point.batteryLevel}%`
                });

                currentTrip = null;
            }

            // Add significant location events
            if (point.address && point.address !== 'Unknown Location' && point.address !== prevPoint?.address) {
                events.push({
                    time: formatTime(new Date(point.timestamp)),
                    type: point.ignitionStatus === 'On' ? 'Location Update' : 'Arrived',
                    location: point.address,
                    icon: point.address.includes('McRay') || point.address.includes('Shop') ? '🏠' : '📍',
                    battery: `${point.batteryLevel}%`
                });
            }
        }

        // Calculate summary
        const firstPoint = routePoints[0];
        const lastPoint = routePoints[routePoints.length - 1];
        const totalBatteryUsed = firstPoint.batteryLevel - lastPoint.batteryLevel;

        const timeline = {
            vehicleId,
            vehicleName: getVehicleName(vehicleId),
            date: startOfDay.toISOString().split('T')[0],
            trips,
            events: events.slice(0, 20), // Limit to 20 most recent events
            summary: {
                totalTrips: trips.length,
                totalDistance: 0, // Would need calculation
                totalDuration: trips.reduce((acc, trip) => acc + (parseInt(trip.duration || '0') || 0), 0),
                batteryUsed: Math.max(0, totalBatteryUsed),
                dataPoints: routePoints.length,
                timeRange: `${formatTime(new Date(firstPoint.timestamp))} - ${formatTime(new Date(lastPoint.timestamp))}`
            }
        };

        res.json({
            success: true,
            timeline,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error creating timeline from route points:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create timeline from route points',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Helper function to get vehicle name
function getVehicleName(vehicleId: string) {
    switch (vehicleId) {
        case '1FT6W1EV3PWG37779': return 'Lightning 2';
        case '1FTVW1EL3NWG00285': return 'Lightning 1';
        case '1FTBW1XK6PKA30591': return 'eTransit 1';
        case '1FTVW1EV3NWG07402': return 'Lightning 3';
        default: return `Vehicle ${vehicleId.slice(-4)}`;
    }
}

export default router;