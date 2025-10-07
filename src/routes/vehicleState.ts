import { Router } from 'express';
import { getAllVehicleStates, getVehicleState, getLatestSignals, getGlobalLastUpdate, getDatabase } from '../db';
import TimezoneUtils from '../utils/timezone';
import { backgroundMonitoringService } from '../services/backgroundMonitoringService';
import logger, { debugLog, perfLog } from '../utils/logger';

const router = Router();

// Helper function to calculate estimated range based on battery percentage
function calculateRange(batteryPercent: number, vin: string): number {
    // Estimated ranges for different Ford vehicles (rough estimates)
    const vehicleRanges: Record<string, number> = {
        'Lightning': 320,  // F-150 Lightning
        'Transit': 126,    // e-Transit
        'Mustang': 312     // Mustang Mach-E
    };

    // Determine vehicle type from VIN/name - this is a simplified approach
    let maxRange = 300; // Default
    for (const [type, range] of Object.entries(vehicleRanges)) {
        if (vin.includes('FTVW1') || vin.includes('FT6W1')) { // Lightning VINs
            maxRange = vehicleRanges.Lightning;
            break;
        } else if (vin.includes('FTBW1')) { // Transit VINs
            maxRange = vehicleRanges.Transit;
            break;
        }
    }

    return Math.round((batteryPercent / 100) * maxRange);
}


// Helper function to extract coordinates from address (if coordinates are stored in address string)
function extractCoordinatesFromAddress(address: string): number | null {
    // This is a placeholder - implement actual coordinate extraction if needed
    return null;
}

/**
 * GET /api/vehicle-state/all
 * Get all vehicles with their current state from MongoDB single source of truth
 * This replaces the old distributed state API calls
 */
router.get('/all', async (req, res) => {
    const startTime = perfLog('[PERF] Vehicle state /all request started');

    try {
        debugLog('Fetching all vehicle states from MongoDB');

        // Generate ETag based on last update time
        const globalLastUpdate = await getGlobalLastUpdate();
        const etag = `"${globalLastUpdate?.getTime() || Date.now()}"`;

        // Check if client has cached version
        if (req.headers['if-none-match'] === etag) {
            debugLog('Returning 304 Not Modified for vehicle states');
            return res.status(304).end();
        }

        const vehicleStates = await getAllVehicleStates();
        const latestSignals = await getLatestSignals();

        // Create a map of latest signals by VIN for quick lookup
        const signalsByVin = new Map(latestSignals.map(signal => [signal.vin, signal]));

        // Transform vehicle states into format expected by frontend
        const transformedStates = await Promise.all(vehicleStates.map(async state => {
            const now = new Date();
            const lastSignalTime = new Date(state.lastSignalTs);
            const freshnessMs = now.getTime() - lastSignalTime.getTime();
            const isStale = freshnessMs > 3000; // 3 second threshold

            // Use precise telematics-based duration calculation
            let stateDuration = 'Unknown';
            let durationSince = state.stateSince;

            if (state.state === 'PARKED' || state.state === 'CHARGING') {
                const preciseParkingInfo = await getPreciseIgnitionOffTime(state.vin);

                if (preciseParkingInfo.ignitionOffTime) {
                    // Found actual ignition OFF transition in our data - use this as the true parking start
                    const parkingDurationMs = now.getTime() - preciseParkingInfo.ignitionOffTime.getTime();
                    stateDuration = TimezoneUtils.formatDuration(parkingDurationMs);
                    durationSince = preciseParkingInfo.ignitionOffTime.toISOString();
                } else if (preciseParkingInfo.source === 'extended-parking') {
                    // Vehicle has been OFF since before we started collecting data
                    // Use the earliest telematics signal time as minimum parking duration
                    const parkingDurationMs = now.getTime() - preciseParkingInfo.ignitionOffTime!.getTime();
                    stateDuration = TimezoneUtils.formatDuration(parkingDurationMs) + '+';
                    durationSince = preciseParkingInfo.ignitionOffTime!.toISOString();

                    // Note: The '+' indicates this is a minimum duration since we didn't catch the actual parking event
                } else {
                    // Fallback: For CHARGING vehicles that just transitioned from PARKED,
                    // we need to find the ORIGINAL parking time, not the charging start time

                    // Check if this vehicle has a PARKED history in the last 24 hours
                    const db = await getDatabase();
                    const vehicleStateHistory = await db.collection('vehicle_state_history').find({
                        vin: state.vin,
                        timestamp: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
                        state: 'PARKED'
                    }).sort({ timestamp: 1 }).limit(1).toArray();

                    if (vehicleStateHistory.length > 0) {
                        // Use the earliest PARKED timestamp as the parking start
                        const originalParkingTime = new Date(vehicleStateHistory[0].timestamp);
                        const totalDurationMs = now.getTime() - originalParkingTime.getTime();
                        stateDuration = TimezoneUtils.formatDuration(totalDurationMs);
                        durationSince = originalParkingTime.toISOString();
                    } else {
                        // No history found, use current state since time
                        const stateSinceTime = new Date(state.stateSince);
                        const stateDurationMs = now.getTime() - stateSinceTime.getTime();

                        if (stateDurationMs > 24 * 60 * 60 * 1000) {
                            stateDuration = 'Parked';
                        } else {
                            stateDuration = TimezoneUtils.formatDuration(stateDurationMs);
                        }
                    }
                }
            } else if (state.state === 'TRIP') {
                const preciseTripInfo = await getPreciseIgnitionOnTime(state.vin);
                if (preciseTripInfo.ignitionOnTime) {
                    const tripDurationMs = now.getTime() - preciseTripInfo.ignitionOnTime.getTime();
                    stateDuration = TimezoneUtils.formatDuration(tripDurationMs);
                    durationSince = preciseTripInfo.ignitionOnTime.toISOString();
                } else {
                    // Fallback calculation
                    const stateSinceTime = new Date(state.stateSince);
                    const stateDurationMs = now.getTime() - stateSinceTime.getTime();
                    stateDuration = TimezoneUtils.formatDuration(stateDurationMs);
                }
            } else {
                // Fallback for any other states
                const stateSinceTime = new Date(state.stateSince);
                const stateDurationMs = now.getTime() - stateSinceTime.getTime();
                stateDuration = TimezoneUtils.formatDuration(stateDurationMs);
            }

            // Get latest signal data for this vehicle
            const latestSignal = signalsByVin.get(state.vin);

            return {
                vin: state.vin,
                name: getVehicleDisplayName(state.vin),
                state: state.state,
                stateDuration,
                stateSince: durationSince,
                location: {
                    latitude: latestSignal?.latitude || null,
                    longitude: latestSignal?.longitude || null,
                    address: state.lastKnownAddress || 'Unknown Location'
                },
                battery: {
                    percentRemaining: latestSignal?.socPct || 0,
                    isCharging: state.state === 'CHARGING',
                    pluggedIn: latestSignal?.pluggedIn || false,
                    range: calculateRange(latestSignal?.socPct || 0, state.vin) // Estimate range based on battery
                },
                odometer: {
                    miles: latestSignal?.odoMiles || null
                },
                ignition: {
                    status: latestSignal?.ignition || (state.state === 'TRIP' ? 'On' : 'Off'),
                    lastOn: state.lastIgnitionOnTs,
                    lastOff: state.lastIgnitionOffTs
                },
                lastUpdate: state.lastSignalTs,
                freshness: {
                    ms: freshnessMs,
                    isStale,
                    description: isStale ? 'Data may be stale' : 'Recent data'
                },
                movement: {
                    lastMovement: state.lastMovementTs,
                    isMoving: state.state === 'TRIP'
                }
            };
        }));

        const response = {
            success: true,
            timestamp: new Date().toISOString(),
            globalLastUpdate: globalLastUpdate?.ts,
            vehicleCount: transformedStates.length,
            vehicles: transformedStates,
            architecture: 'mongodb-single-source-of-truth',
            dataSource: 'telematics_signals + vehicle_state collections'
        };

        // Set caching headers
        res.set({
            'ETag': etag,
            'Last-Modified': globalLastUpdate?.toUTCString() || new Date().toUTCString(),
            'Cache-Control': 'private, max-age=5' // Cache for 5 seconds
        });

        perfLog('[PERF] Vehicle state /all request completed', startTime);
        debugLog(`Returned ${transformedStates.length} vehicle states from MongoDB`);
        res.json(response);

    } catch (error) {
        logger.error('Error fetching vehicle states:', error);
        perfLog('[PERF] Vehicle state /all request failed', startTime);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            architecture: 'mongodb-single-source-of-truth',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /api/vehicle-state/:vin
 * Get specific vehicle state by VIN
 */
router.get('/:vin', async (req, res) => {
    try {
        const { vin } = req.params;
        console.log(`🔍 Fetching vehicle state for VIN: ${vin}`);

        const vehicleState = await getVehicleState(vin);

        if (!vehicleState) {
            return res.status(404).json({
                success: false,
                error: 'Vehicle not found',
                vin
            });
        }

        const now = new Date();
        const lastSignalTime = new Date(vehicleState.lastSignalTs);
        const freshnessMs = now.getTime() - lastSignalTime.getTime();
        const isStale = freshnessMs > 3000;

        // Use precise telematics-based duration calculation (same logic as /all endpoint)
        let stateDuration = 'Unknown';
        let durationSince = vehicleState.stateSince;

        if (vehicleState.state === 'PARKED' || vehicleState.state === 'CHARGING') {
            const preciseParkingInfo = await getPreciseIgnitionOffTime(vehicleState.vin);

            if (preciseParkingInfo.ignitionOffTime) {
                // Found actual ignition OFF transition in our data - use this as the true parking start
                const parkingDurationMs = now.getTime() - preciseParkingInfo.ignitionOffTime.getTime();
                stateDuration = TimezoneUtils.formatDuration(parkingDurationMs);
                durationSince = preciseParkingInfo.ignitionOffTime.toISOString();
            } else if (preciseParkingInfo.source === 'extended-parking') {
                // Vehicle has been OFF since before we started collecting data
                // Use the earliest telematics signal time as minimum parking duration
                const parkingDurationMs = now.getTime() - preciseParkingInfo.ignitionOffTime!.getTime();
                stateDuration = TimezoneUtils.formatDuration(parkingDurationMs) + '+';
                durationSince = preciseParkingInfo.ignitionOffTime!.toISOString();
            } else {
                // Fallback: Check vehicle state history for original parking time
                const db = await getDatabase();
                const vehicleStateHistory = await db.collection('vehicle_state_history').find({
                    vin: vehicleState.vin,
                    timestamp: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
                    state: 'PARKED'
                }).sort({ timestamp: 1 }).limit(1).toArray();

                if (vehicleStateHistory.length > 0) {
                    const originalParkingTime = new Date(vehicleStateHistory[0].timestamp);
                    const totalDurationMs = now.getTime() - originalParkingTime.getTime();
                    stateDuration = TimezoneUtils.formatDuration(totalDurationMs);
                    durationSince = originalParkingTime.toISOString();
                } else {
                    const stateSinceTime = new Date(vehicleState.stateSince);
                    const stateDurationMs = now.getTime() - stateSinceTime.getTime();
                    stateDuration = TimezoneUtils.formatDuration(stateDurationMs);
                }
            }
        } else {
            // For TRIP state, use simple duration calculation
            const stateSinceTime = new Date(vehicleState.stateSince);
            const stateDurationMs = now.getTime() - stateSinceTime.getTime();
            stateDuration = TimezoneUtils.formatDuration(stateDurationMs);
        }

        const response = {
            success: true,
            vehicle: {
                vin: vehicleState.vin,
                name: getVehicleDisplayName(vehicleState.vin),
                state: vehicleState.state,
                stateDuration,
                stateSince: durationSince,
                location: {
                    address: vehicleState.lastKnownAddress || 'Unknown Location'
                },
                ignition: {
                    status: vehicleState.state === 'TRIP' ? 'On' : 'Off',
                    lastOn: vehicleState.lastIgnitionOnTs,
                    lastOff: vehicleState.lastIgnitionOffTs
                },
                lastUpdate: vehicleState.lastSignalTs,
                freshness: {
                    ms: freshnessMs,
                    isStale,
                    description: isStale ? 'Data may be stale' : 'Recent data'
                },
                movement: {
                    lastMovement: vehicleState.lastMovementTs,
                    isMoving: vehicleState.state === 'TRIP'
                }
            },
            timestamp: new Date().toISOString()
        };

        res.json(response);

    } catch (error) {
        console.error(`❌ Error fetching vehicle state for ${req.params.vin}:`, error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            vin: req.params.vin
        });
    }
});

/**
 * GET /api/vehicle-state/signals/latest
 * Get latest telematics signals from all vehicles
 */
router.get('/signals/latest', async (req, res) => {
    try {
        console.log('📡 Fetching latest telematics signals');

        const latestSignals = await getLatestSignals();

        const response = {
            success: true,
            timestamp: new Date().toISOString(),
            signalCount: latestSignals.length,
            signals: latestSignals.map(signal => ({
                vin: signal.vin,
                name: getVehicleDisplayName(signal.vin),
                fordTimestamp: signal.ts,
                serverTimestamp: signal.serverTs,
                ignition: signal.ignition,
                location: {
                    latitude: signal.latitude,
                    longitude: signal.longitude
                },
                odometer: signal.odoMiles,
                battery: {
                    percentage: signal.socPct,
                    pluggedIn: signal.pluggedIn
                },
                freshness: {
                    ms: new Date().getTime() - new Date(signal.ts).getTime()
                }
            })),
            dataSource: 'telematics_signals collection'
        };

        res.json(response);

    } catch (error) {
        console.error('❌ Error fetching latest signals:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * GET /api/vehicle-state/health
 * Get system health and data freshness info
 */
router.get('/health', async (req, res) => {
    try {
        const globalLastUpdate = await getGlobalLastUpdate();
        const vehicleStates = await getAllVehicleStates();
        const latestSignals = await getLatestSignals();

        const now = new Date();
        const systemHealth = {
            status: 'healthy',
            timestamp: now.toISOString(),
            architecture: 'mongodb-single-source-of-truth',

            globalLastUpdate: globalLastUpdate ? {
                timestamp: globalLastUpdate.ts,
                freshnessMs: now.getTime() - new Date(globalLastUpdate.ts).getTime(),
                vin: globalLastUpdate.vin
            } : null,

            collections: {
                vehicleStates: {
                    count: vehicleStates.length,
                    vins: vehicleStates.map(s => s.vin)
                },
                telematicsSignals: {
                    count: latestSignals.length,
                    vins: latestSignals.map(s => s.vin)
                }
            },

            dataFreshness: vehicleStates.map(state => {
                const freshnessMs = now.getTime() - new Date(state.lastSignalTs).getTime();
                return {
                    vin: state.vin,
                    name: getVehicleDisplayName(state.vin),
                    lastSignal: state.lastSignalTs,
                    freshnessMs,
                    isStale: freshnessMs > 3000,
                    state: state.state
                };
            })
        };

        // Determine overall health
        const hasStaleData = systemHealth.dataFreshness.some(d => d.isStale);
        if (hasStaleData) {
            systemHealth.status = 'degraded';
        }

        res.json(systemHealth);

    } catch (error) {
        console.error('❌ Error checking system health:', error);
        res.status(500).json({
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Get precise ignition OFF time from ALL available data sources
 * Prioritizes telematics ignition transitions for accuracy, then falls back to route_points
 */
async function getPreciseIgnitionOffTime(vin: string): Promise<{ ignitionOffTime: Date | null; source: string }> {
    try {
        const { getDatabase } = await import('../db/index');
        const db = await getDatabase();

        // FIRST: Check telematics ignition transitions for the most accurate parking start time
        const today = new Date();
        const searchStart = new Date(today.getTime() - 24 * 60 * 60 * 1000); // Last 24 hours

        const signals = await db.collection('telematics_signals').find({
            vin: vin,
            ts: { $gte: searchStart.toISOString() }
        }).sort({ ts: 1 }).toArray();

        if (signals.length > 0) {
            // Find ALL ignition transitions: On → Off (most recent one is the actual parking start)
            let lastIgnition = null;
            let mostRecentIgnitionOff: Date | null = null;

            for (const signal of signals) {
                if (lastIgnition === 'On' && signal.ignition === 'Off') {
                    mostRecentIgnitionOff = new Date(signal.ts);
                    console.log(`🎯 Found ignition OFF transition for ${vin}: ${mostRecentIgnitionOff.toISOString()} from telematics`);
                }
                lastIgnition = signal.ignition;
            }

            // If we found an ignition transition, use it (most accurate)
            if (mostRecentIgnitionOff) {
                return {
                    ignitionOffTime: mostRecentIgnitionOff,
                    source: 'telematics-transition'
                };
            }

            // If no transitions found, check if vehicle has been consistently OFF
            const firstSignal = signals[0];
            const lastSignal = signals[signals.length - 1];

            // If vehicle started OFF and is still OFF, it's been parked for extended period
            if (firstSignal.ignition === 'Off' && lastSignal.ignition === 'Off') {
                console.log(`📍 Vehicle ${vin} has been OFF since before monitoring started - extended parking`);
                // Return the earliest telematics signal time as the minimum parking duration
                const earliestParkingTime = new Date(firstSignal.ts);
                return { ignitionOffTime: earliestParkingTime, source: 'extended-parking' };
            }
        }

        // SECOND: Fallback to route_points collection for trip activity (less accurate but still useful)
        const recentRoutePoints = await db.collection('route_points').find({
            vin: vin
        }).sort({ timestamp: -1 }).limit(1).toArray();

        if (recentRoutePoints.length > 0) {
            const lastRoutePoint = recentRoutePoints[0];
            const lastTripActivity = new Date(lastRoutePoint.timestamp);
            console.log(`📍 Fallback to last trip activity for ${vin}: ${lastTripActivity.toISOString()} from route_points`);

            // Use this as the parking start time (fallback)
            return {
                ignitionOffTime: lastTripActivity,
                source: 'route-points-fallback'
            };
        }

        // No data found
        return { ignitionOffTime: null, source: 'no-data' };
    } catch (error) {
        console.error(`Error getting precise ignition OFF for ${vin}:`, error);
        return { ignitionOffTime: null, source: 'error' };
    }
}

/**
 * Get precise ignition ON time from telematics signals
 */
async function getPreciseIgnitionOnTime(vin: string): Promise<{ ignitionOnTime: Date | null; source: string }> {
    try {
        const { getDatabase } = await import('../db/index');
        const db = await getDatabase();

        // Search for recent ignition transitions (last 24 hours for active trips)
        const searchStart = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const signals = await db.collection('telematics_signals').find({
            vin: vin,
            ts: { $gte: searchStart.toISOString() }
        }).sort({ ts: 1 }).toArray();

        if (signals.length === 0) {
            return { ignitionOnTime: null, source: 'no-data' };
        }

        // Find ignition transitions: Off → On
        let lastIgnition = null;
        let mostRecentIgnitionOn: Date | null = null;

        for (const signal of signals) {
            if (lastIgnition === 'Off' && signal.ignition === 'On') {
                mostRecentIgnitionOn = new Date(signal.ts);
            }
            lastIgnition = signal.ignition;
        }

        return {
            ignitionOnTime: mostRecentIgnitionOn,
            source: mostRecentIgnitionOn ? 'telematics-transition' : 'no-transition-found'
        };
    } catch (error) {
        console.error(`Error getting precise ignition ON for ${vin}:`, error);
        return { ignitionOnTime: null, source: 'error' };
    }
}

/**
 * Helper function to get display name for vehicle VIN
 */
function getVehicleDisplayName(vin: string): string {
    const vinToNameMap: { [key: string]: string } = {
        '1FT6W1EV3PWG37779': 'Lightning 2',
        '1FTBW1XK6PKA30591': 'eTransit 1',
        '1FTVW1EV3NWG07402': 'Lightning 3',
        '1FTVW1EL3NWG00285': 'Lightning 1'
    };

    return vinToNameMap[vin] || `Vehicle ${vin.slice(-6)}`;
}

/**
 * GET /api/vehicle-state/:vin/route-points
 * Get current-day route points for trip visualization (expires at 2:00 AM CDT)
 */
router.get('/:vin/route-points', async (req, res) => {
    try {
        const { vin } = req.params;
        const { date } = req.query;

        debugLog(`Fetching route points for vehicle: ${vin}`);

        const { getDatabase } = await import('../db/index');
        const db = await getDatabase();

        // Build query for route points
        let query: any = { vehicleId: vin };

        // If date is specified, filter by that date
        if (date) {
            const queryDate = new Date(date as string);
            const startOfDay = new Date(queryDate);
            startOfDay.setHours(0, 0, 0, 0);

            const endOfDay = new Date(queryDate);
            endOfDay.setHours(23, 59, 59, 999);

            query.timestamp = {
                $gte: startOfDay,
                $lte: endOfDay
            };
        }

        // Fetch route points from 2:00 AM CDT TTL collection
        const routePoints = await db.collection('route_points')
            .find(query)
            .sort({ timestamp: 1 })
            .limit(10000) // Reasonable limit for current-day visualization
            .toArray();

        debugLog(`Found ${routePoints.length} route points for ${vin}`);

        res.json({
            success: true,
            vehicleId: vin,
            vehicleName: getVehicleDisplayName(vin),
            routePoints: routePoints.map(point => ({
                latitude: point.latitude,
                longitude: point.longitude,
                timestamp: point.timestamp,
                speed: point.speed || 0,
                heading: point.heading || 0
            })),
            totalPoints: routePoints.length,
            expiresAt: routePoints.length > 0 ? routePoints[0].expireAt : null,
            dataSource: '2am-cdt-ttl'
        });

    } catch (error) {
        logger.error('Error fetching route points:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch route points',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});


export default router;