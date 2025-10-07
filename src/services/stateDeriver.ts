import { getDatabase } from '../db/index';
import { TelematicsSignal, VehicleState } from '../db/init';
import { clientLocationService } from './clientLocations';
import { geocodingService } from './geocoding';
import { vehicleNaming } from './vehicleNaming';

export interface CanonicalVehicleState {
    vin: string;
    state: 'TRIP' | 'PARKED' | 'CHARGING';
    stateSince: string;          // ISO UTC when this state began
    lastSignalTs: string;        // newest signal timestamp
    freshnessMs: number;         // age of last signal
    lastKnownAddress?: string;   // resolved address
    lastKnownLocation?: {        // GPS coordinates for movement detection
        latitude: number;
        longitude: number;
    };
    placeRef?: {                 // reference to cached place
        type: 'client' | 'places' | 'reverse';
        key: string;
        name: string;
    };
    isCharging?: boolean;
    metrics?: {                  // enriched metrics (not stored every tick)
        socPct?: number;
        odoMiles?: number;
        rangeMiles?: number;
        fetchedAt?: string;
        ageMs?: number;
    };
    lastUpdatedAt: string;       // server timestamp when we updated this doc
}

export class StateDeriver {
    private static instance: StateDeriver;

    static getInstance(): StateDeriver {
        if (!StateDeriver.instance) {
            StateDeriver.instance = new StateDeriver();
        }
        return StateDeriver.instance;
    }

    /**
     * Derive canonical vehicle state from latest telematics signal
     */
    async deriveState(signal: TelematicsSignal): Promise<CanonicalVehicleState> {
        const db = await getDatabase();
        const now = new Date();
        const signalTime = new Date(signal.ts);
        const freshnessMs = now.getTime() - signalTime.getTime();

        // Get current vehicle state to check for state transitions
        const currentState = await db.collection('vehicle_state').findOne({ vin: signal.vin });

        if (currentState) {
            console.log(`🔍 [StateDeriver] Current state for ${signal.vin}:`, {
                state: currentState.state,
                currentState: currentState.currentState,
                stateSince: currentState.stateSince
            });
        }

        // Derive new state from signal (checking GPS parking first)
        const newState = await this.determineVehicleState(signal, currentState);

        // Determine stateSince - only update if state actually changed
        let stateSince = signal.ts;
        if (currentState && currentState.state === newState) {
            // State hasn't changed, keep existing stateSince
            stateSince = currentState.stateSince;
            console.log(`🔒 [StateDeriver] Preserving duration for ${signal.vin}: ${newState} since ${stateSince}`);
        } else {
            console.log(`🔄 [StateDeriver] State transition for ${signal.vin}: ${currentState?.state || 'unknown'} → ${newState} at ${stateSince}`);
        }

        // Initialize canonical state
        const canonicalState: CanonicalVehicleState = {
            vin: signal.vin,
            state: newState,
            stateSince,
            lastSignalTs: signal.ts,
            freshnessMs,
            isCharging: signal.pluggedIn && newState === 'CHARGING',
            lastKnownLocation: signal.latitude && signal.longitude ? {
                latitude: signal.latitude,
                longitude: signal.longitude
            } : currentState?.lastKnownLocation,
            lastUpdatedAt: now.toISOString()
        };

        // Resolve location if we have coordinates and state changed or no cached address
        if (signal.latitude && signal.longitude &&
            (!currentState?.lastKnownAddress || currentState.state !== newState)) {

            console.log(`🌐 Resolving location for ${signal.vin} at ${signal.latitude}, ${signal.longitude}`);

            try {
                const locationResult = await this.resolveLocation(signal.latitude, signal.longitude, newState);
                canonicalState.lastKnownAddress = locationResult.address;
                canonicalState.placeRef = locationResult.placeRef;
            } catch (error) {
                console.warn(`❌ Failed to resolve location for ${signal.vin}:`, error);
                // Keep existing address if resolution fails
                canonicalState.lastKnownAddress = currentState?.lastKnownAddress ||
                    `${signal.latitude.toFixed(4)}, ${signal.longitude.toFixed(4)}`;
            }
        } else if (currentState?.lastKnownAddress) {
            // Keep existing address if no location change
            canonicalState.lastKnownAddress = currentState.lastKnownAddress;
            canonicalState.placeRef = currentState.placeRef;
        }

        // Add metrics if signal has data (don't store empty metrics)
        if (signal.socPct || signal.odoMiles || signal.batteryRangeKm) {
            canonicalState.metrics = {
                socPct: signal.socPct,
                odoMiles: signal.odoMiles,
                rangeMiles: signal.batteryRangeKm ? Math.round(signal.batteryRangeKm * 0.621371) : undefined,
                fetchedAt: signal.ts,
                ageMs: freshnessMs
            };
        }

        return canonicalState;
    }

    /**
     * Determine vehicle state from telematics signal
     * Now checks GPS parking detection to override unreliable Ford ignition status
     */
    private async determineVehicleState(signal: TelematicsSignal, currentState?: any): Promise<'TRIP' | 'PARKED' | 'CHARGING'> {
        console.log(`🔍 [StateDeriver] determineVehicleState for ${signal.vin}: ignition=${signal.ignition}, pluggedIn=${signal.pluggedIn}, lat=${signal.latitude}, lng=${signal.longitude}`);

        // Priority 1: If plugged in, it's charging (even if also parked)
        if (signal.pluggedIn) {
            return 'CHARGING';
        }

        // Priority 2: Check GPS-based parking detection (more reliable than Ford's ignition)
        // This prevents false "On Trip" status when vehicle is actually parked
        if (signal.latitude && signal.longitude) {
            try {
                // Import backgroundMonitoringService to check GPS parking
                const { backgroundMonitoringService } = await import('./backgroundMonitoringService');

                // Check if we have a client name from the current location
                const { clientLocationService } = await import('./clientLocations');
                const clientName = await clientLocationService.findClientLocationMatch(signal.latitude, signal.longitude);

                console.log(`🔍 [StateDeriver] Checking GPS parking for ${signal.vin} at ${signal.latitude}, ${signal.longitude}, client: ${clientName || 'none'}`);

                const isGpsParked = await backgroundMonitoringService.detectGpsBasedParking(
                    signal.vin,
                    { latitude: signal.latitude, longitude: signal.longitude },
                    clientName || undefined
                );

                console.log(`🔍 [StateDeriver] GPS parking result for ${signal.vin}: ${isGpsParked}`);

                if (isGpsParked) {
                    const locationContext = clientName ? `at ${clientName}` : 'general location';
                    console.log(`🅿️ [StateDeriver] GPS Override: ${signal.vin} detected as PARKED ${locationContext} (ignoring Ford ignition: ${signal.ignition})`);
                    return 'PARKED';
                }

                // GPS parking check returned false - check if vehicle hasn't moved from last location
                // This handles the case where server restart = not enough route points yet
                if (!isGpsParked && currentState) {
                    const lastLat = currentState.lastKnownLocation?.latitude;
                    const lastLon = currentState.lastKnownLocation?.longitude;

                    if (lastLat && lastLon) {
                        // We have a previous location - check if vehicle has moved
                        const distanceMoved = this.calculateDistance(
                            lastLat, lastLon,
                            signal.latitude, signal.longitude
                        );

                        console.log(`📏 [StateDeriver] ${signal.vin} distance from last location: ${distanceMoved.toFixed(1)}m (${(distanceMoved * 3.28084).toFixed(0)}ft), currentState: ${currentState.state}`);

                        // TIGHT: If vehicle moved > 20m (66ft), it's on a trip
                        if (distanceMoved > 20) {
                            console.log(`🚗 [StateDeriver] ${signal.vin} moved ${distanceMoved.toFixed(1)}m (${(distanceMoved * 3.28084).toFixed(0)}ft) - confirming TRIP state`);
                            return 'TRIP';
                        }

                        // Still at same location (< 20m movement)
                        // If at a client location, should be PARKED regardless of Ford ignition status
                        if (clientName && distanceMoved < 20) {
                            console.log(`🅿️ [StateDeriver] ${signal.vin} stationary at ${clientName} (${distanceMoved.toFixed(1)}m movement) - overriding to PARKED (Ford ignition: ${signal.ignition})`);
                            return 'PARKED';
                        }
                    } else if (clientName) {
                        // No previous location data BUT vehicle is at a client location
                        // This handles fresh server start or legacy data without lastKnownLocation
                        console.log(`🅿️ [StateDeriver] ${signal.vin} at client ${clientName} (no previous location data) - overriding to PARKED (Ford ignition: ${signal.ignition})`);
                        return 'PARKED';
                    }
                }
            } catch (error) {
                console.warn(`⚠️ [StateDeriver] Failed to check GPS parking for ${signal.vin}:`, error);
                // Continue to fallback logic if GPS check fails
            }
        }

        // Priority 3: If ignition is on/run AND GPS didn't detect parking, it's on a trip
        // This prevents false positives from Ford's unreliable ignition status
        if (['On', 'Run'].includes(signal.ignition)) {
            return 'TRIP';
        }

        // Default: Parked
        return 'PARKED';
    }

    /**
     * Calculate distance between two GPS coordinates in meters using Haversine formula
     */
    private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const R = 6371e3; // Earth's radius in meters
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;

        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
                  Math.cos(φ1) * Math.cos(φ2) *
                  Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c; // Distance in meters
    }

    /**
     * Resolve location using priority: client geofences → cache → Google Places → reverse geocode
     */
    private async resolveLocation(lat: number, lon: number, vehicleState?: string): Promise<{
        address: string;
        placeRef?: {
            type: 'client' | 'places' | 'reverse';
            key: string;
            name: string;
        };
    }> {
        // Try client location match first
        try {
            const clientName = await clientLocationService.findClientLocationMatch(lat, lon);
            if (clientName) {
                console.log(`🎯 Matched client location: ${clientName}`);
                return {
                    address: clientName,
                    placeRef: {
                        type: 'client',
                        key: `${lat.toFixed(6)},${lon.toFixed(6)}`,
                        name: clientName
                    }
                };
            }
        } catch (error) {
            console.warn('Client location matching failed:', error);
        }

        // Fallback to Google Places geocoding (ONLY if PARKED)
        try {
            const address = await geocodingService.getAddress(lat, lon, vehicleState);
            console.log(`🌐 Geocoded address: ${address}`);
            return {
                address,
                placeRef: {
                    type: 'places',
                    key: `${lat.toFixed(6)},${lon.toFixed(6)}`,
                    name: address
                }
            };
        } catch (error) {
            console.warn('Google Places geocoding failed:', error);
        }

        // Final fallback: coordinates
        const coordString = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
        return {
            address: coordString,
            placeRef: {
                type: 'reverse',
                key: coordString,
                name: coordString
            }
        };
    }

    /**
     * Upsert canonical vehicle state to MongoDB
     */
    async upsertCanonicalState(state: CanonicalVehicleState): Promise<void> {
        const db = await getDatabase();

        await db.collection('vehicle_state').replaceOne(
            { vin: state.vin },
            state,
            { upsert: true }
        );

        console.log(`✅ Updated canonical state for ${vehicleNaming.getVehicleName(state.vin)}: ${state.state} (${state.freshnessMs}ms fresh)`);
    }
}

export const stateDeriver = StateDeriver.getInstance();