import { mongoConnection } from './index';

export async function initializeCollections(): Promise<void> {
    console.log('🔧 Initializing vehicle state collections and indexes...');

    try {
        const db = await mongoConnection.getDatabase();

        // Create indexes for telematics_signals collection
        const telematicsCollection = db.collection('telematics_signals');
        await telematicsCollection.createIndex(
            { vin: 1, ts: -1 },
            { name: 'vin_ts_idx', background: true }
        );

        // Optional: TTL index to auto-expire old signals (keep 7 days)
        await telematicsCollection.createIndex(
            { serverTs: 1 },
            {
                name: 'ttl_idx',
                expireAfterSeconds: 7 * 24 * 60 * 60, // 7 days
                background: true
            }
        );

        // Create index for vehicle_state collection
        const vehicleStateCollection = db.collection('vehicle_state');
        await vehicleStateCollection.createIndex(
            { vin: 1 },
            { name: 'vin_unique_idx', unique: true, background: true }
        );

        console.log('✅ Database indexes created successfully');
        console.log('   - telematics_signals: { vin: 1, ts: -1 }, TTL: 7 days');
        console.log('   - vehicle_state: { vin: 1 } (unique)');

    } catch (error: any) {
        // Don't fail if indexes already exist
        if (error.message?.includes('already exists')) {
            console.log('✅ Database indexes already exist, skipping creation');
        } else {
            console.error('❌ Failed to create database indexes:', error.message);
            throw error;
        }
    }
}

// Types for the new collections
export interface TelematicsSignal {
    vin: string;
    ts: string;           // ISO UTC from Ford
    serverTs: string;     // when we stored it
    ignition: 'Off' | 'Run' | 'On' | 'Unknown';
    latitude: number;
    longitude: number;
    odoMiles: number;
    socPct: number;
    pluggedIn: boolean;
    batteryRangeKm?: number;  // Battery range in kilometers from Ford xev_battery_range signal
}

export interface VehicleState {
    vin: string;
    lastSignalTs: string;          // ISO UTC from latest signal
    freshnessMs: number;
    state: 'PARKED' | 'TRIP' | 'CHARGING';
    stateSince: string;            // ISO UTC when this state began
    lastMovementTs?: string;       // last time coords changed
    lastIgnitionOnTs?: string;
    lastIgnitionOffTs?: string;
    lastKnownAddress?: string;     // reverse geocode cache
    lastUpdatedAt: string;         // server now when we persisted
}

export type VehicleStateEnum = 'PARKED' | 'TRIP' | 'CHARGING';