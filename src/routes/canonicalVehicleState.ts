import { Router, Request, Response } from 'express';
import { getDatabase } from '../db/index';
import { vehicleNaming } from '../services/vehicleNaming';
import TimezoneUtils from '../utils/timezone';

const router = Router();

/**
 * GET /api/vehicle-state - Single source of truth for dashboard
 * Returns canonical vehicle state from MongoDB
 */
router.get('/', async (req: Request, res: Response) => {
    try {
        const db = await getDatabase();
        const now = new Date();

        // Get all canonical vehicle states
        const vehicleStates = await db.collection('vehicle_state')
            .find({})
            .toArray();

        if (vehicleStates.length === 0) {
            return res.json({
                success: true,
                vehicles: [],
                message: 'No vehicle states found'
            });
        }

        // Transform to dashboard format
        const vehicles = vehicleStates.map(state => {
            const freshnessMs = now.getTime() - new Date(state.lastSignalTs).getTime();
            const isStale = freshnessMs > 3000; // 3 seconds threshold

            // Calculate duration since state began
            const stateDuration = TimezoneUtils.formatDuration(
                now.getTime() - new Date(state.stateSince).getTime()
            );

            return {
                vin: state.vin,
                name: vehicleNaming.getVehicleName(state.vin),
                state: state.state,
                stateSince: state.stateSince,
                duration: stateDuration,
                lastSignalTs: state.lastSignalTs,
                freshnessMs: freshnessMs,
                isStale: isStale,
                lastKnownAddress: state.lastKnownAddress || 'Unknown Location',
                placeRef: state.placeRef,
                isCharging: state.isCharging || false,
                metrics: state.metrics || {
                    socPct: 0,
                    odoMiles: 0,
                    rangeMiles: 0,
                    ageMs: freshnessMs
                }
            };
        });

        // Sort by vehicle name for consistent ordering
        vehicles.sort((a, b) => a.name.localeCompare(b.name));

        res.json({
            success: true,
            vehicles,
            timestamp: now.toISOString(),
            totalVehicles: vehicles.length
        });

    } catch (error) {
        console.error('❌ Error fetching canonical vehicle states:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch vehicle states',
            vehicles: []
        });
    }
});

/**
 * GET /api/vehicle-state/all - Explicit alias for getting all vehicles
 */
router.get('/all', async (req: Request, res: Response) => {
    try {
        const db = await getDatabase();
        const now = new Date();

        // Get all canonical vehicle states
        const vehicleStates = await db.collection('vehicle_state')
            .find({})
            .toArray();

        if (vehicleStates.length === 0) {
            return res.json({
                success: true,
                vehicles: [],
                message: 'No vehicle states found'
            });
        }

        // Transform to dashboard format
        const vehicles = vehicleStates.map(state => {
            const freshnessMs = now.getTime() - new Date(state.lastSignalTs).getTime();
            const isStale = freshnessMs > 3000; // 3 seconds threshold

            // Calculate duration since state began
            const stateDuration = TimezoneUtils.formatDuration(
                now.getTime() - new Date(state.stateSince).getTime()
            );

            return {
                vin: state.vin,
                name: vehicleNaming.getVehicleName(state.vin),
                state: state.state,
                stateSince: state.stateSince,
                duration: stateDuration,
                lastSignalTs: state.lastSignalTs,
                freshnessMs: freshnessMs,
                isStale: isStale,
                lastKnownAddress: state.lastKnownAddress || 'Unknown Location',
                placeRef: state.placeRef,
                isCharging: state.isCharging || false,
                metrics: state.metrics || {
                    socPct: 0,
                    odoMiles: 0,
                    rangeMiles: 0,
                    ageMs: freshnessMs
                }
            };
        });

        // Sort by vehicle name for consistent ordering
        vehicles.sort((a, b) => a.name.localeCompare(b.name));

        res.json({
            success: true,
            vehicles,
            timestamp: now.toISOString(),
            totalVehicles: vehicles.length
        });

    } catch (error) {
        console.error('❌ Error fetching canonical vehicle states (all endpoint):', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch vehicle states',
            vehicles: []
        });
    }
});

/**
 * GET /api/vehicle-state/:vin - Single vehicle state
 */
router.get('/:vin', async (req: Request, res: Response) => {
    try {
        const { vin } = req.params;
        const db = await getDatabase();
        const now = new Date();

        const state = await db.collection('vehicle_state').findOne({ vin });

        if (!state) {
            return res.status(404).json({
                success: false,
                error: `Vehicle state not found for VIN: ${vin}`,
                vehicles: []
            });
        }

        const freshnessMs = now.getTime() - new Date(state.lastSignalTs).getTime();
        const isStale = freshnessMs > 3000;

        const stateDuration = TimezoneUtils.formatDuration(
            now.getTime() - new Date(state.stateSince).getTime()
        );

        const vehicle = {
            vin: state.vin,
            name: vehicleNaming.getVehicleName(state.vin),
            state: state.state,
            stateSince: state.stateSince,
            duration: stateDuration,
            lastSignalTs: state.lastSignalTs,
            freshnessMs: freshnessMs,
            isStale: isStale,
            lastKnownAddress: state.lastKnownAddress || 'Unknown Location',
            placeRef: state.placeRef,
            isCharging: state.isCharging || false,
            metrics: state.metrics || {
                socPct: 0,
                odoMiles: 0,
                rangeMiles: 0,
                ageMs: freshnessMs
            }
        };

        res.json({
            success: true,
            vehicles: [vehicle],
            timestamp: now.toISOString()
        });

    } catch (error) {
        console.error(`❌ Error fetching vehicle state for ${req.params.vin}:`, error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch vehicle state',
            vehicles: []
        });
    }
});

export default router;