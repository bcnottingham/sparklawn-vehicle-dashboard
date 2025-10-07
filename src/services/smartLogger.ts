import { getDatabase } from '../db/index';
import { TelematicsSignal } from '../db/init';

export interface SignalChangeDetection {
    hasSignificantChange: boolean;
    changeReasons: string[];
    shouldStore: boolean;
    storageCategory: 'critical' | 'important' | 'routine' | 'skip';
}

export class SmartLogger {
    private static instance: SmartLogger;

    static getInstance(): SmartLogger {
        if (!SmartLogger.instance) {
            SmartLogger.instance = new SmartLogger();
        }
        return SmartLogger.instance;
    }

    /**
     * Intelligent signal filtering for 3-second polling
     * Only stores signals with meaningful changes to prevent database bloat
     */
    async shouldStoreSignal(newSignal: TelematicsSignal): Promise<SignalChangeDetection> {
        try {
            const db = await getDatabase();

            // Get the most recent signal for this vehicle
            const lastSignal = await db.collection('telematics_signals')
                .findOne(
                    { vin: newSignal.vin },
                    { sort: { ts: -1 } }
                ) as TelematicsSignal | null;

            if (!lastSignal) {
                return {
                    hasSignificantChange: true,
                    changeReasons: ['first_signal'],
                    shouldStore: true,
                    storageCategory: 'critical'
                };
            }

            const changes: string[] = [];
            let category: 'critical' | 'important' | 'routine' | 'skip' = 'skip';

            // CRITICAL CHANGES - Always store these
            if (this.hasIgnitionStateChange(lastSignal as TelematicsSignal, newSignal)) {
                changes.push('ignition_state_change');
                category = 'critical';
            }

            if (this.hasPlugStateChange(lastSignal as TelematicsSignal, newSignal)) {
                changes.push('plug_state_change');
                category = 'critical';
            }

            // IMPORTANT CHANGES - Store if significant
            if (this.hasSignificantLocationChange(lastSignal as TelematicsSignal, newSignal)) {
                changes.push('location_change');
                if (category === 'skip') category = 'important';
            }

            if (this.hasSignificantBatteryChange(lastSignal as TelematicsSignal, newSignal)) {
                changes.push('battery_change');
                if (category === 'skip') category = 'important';
            }

            if (this.hasSignificantOdometerChange(lastSignal as TelematicsSignal, newSignal)) {
                changes.push('odometer_change');
                if (category === 'skip') category = 'important';
            }

            // ROUTINE CHANGES - Store periodically
            if (this.shouldStoreRoutine(lastSignal as TelematicsSignal, newSignal)) {
                changes.push('routine_heartbeat');
                if (category === 'skip') category = 'routine';
            }

            const shouldStore = category !== 'skip';
            const hasSignificantChange = changes.length > 0;

            return {
                hasSignificantChange,
                changeReasons: changes,
                shouldStore,
                storageCategory: category
            };

        } catch (error) {
            console.error('❌ Error in smart signal filtering:', error);
            // On error, default to storing the signal
            return {
                hasSignificantChange: true,
                changeReasons: ['error_fallback'],
                shouldStore: true,
                storageCategory: 'critical'
            };
        }
    }

    /**
     * Store signal with appropriate TTL based on importance
     */
    async storeSignalWithSmartTTL(
        signal: TelematicsSignal,
        category: 'critical' | 'important' | 'routine' | 'skip'
    ): Promise<void> {
        if (category === 'skip') return;

        const db = await getDatabase();

        // Add TTL category for different retention periods
        const enhancedSignal = {
            ...signal,
            storageCategory: category,
            serverTs: new Date().toISOString()
        };

        // Use different collections for different retention periods
        let collectionName: string;
        switch (category) {
            case 'critical':
                collectionName = 'telematics_signals_critical'; // 30 days
                break;
            case 'important':
                collectionName = 'telematics_signals_important'; // 14 days
                break;
            case 'routine':
                collectionName = 'telematics_signals_routine'; // 3 days
                break;
            default:
                collectionName = 'telematics_signals';
        }

        await db.collection(collectionName).insertOne(enhancedSignal);

        console.log(`📊 Smart logged ${signal.vin}: ${category} (reasons: ${enhancedSignal.storageCategory})`);
    }

    /**
     * Check for ignition state changes (critical)
     */
    private hasIgnitionStateChange(lastSignal: TelematicsSignal, newSignal: TelematicsSignal): boolean {
        return lastSignal.ignition !== newSignal.ignition;
    }

    /**
     * Check for plug state changes (critical)
     */
    private hasPlugStateChange(lastSignal: TelematicsSignal, newSignal: TelematicsSignal): boolean {
        return lastSignal.pluggedIn !== newSignal.pluggedIn;
    }

    /**
     * Check for significant location changes (important)
     * Movement > 10 meters is considered significant
     */
    private hasSignificantLocationChange(lastSignal: TelematicsSignal, newSignal: TelematicsSignal): boolean {
        const distance = this.calculateDistance(
            lastSignal.latitude,
            lastSignal.longitude,
            newSignal.latitude,
            newSignal.longitude
        );

        return distance > 10; // 10 meters threshold
    }

    /**
     * Check for significant battery changes (important)
     * SOC change > 1% or range change > 2 miles
     */
    private hasSignificantBatteryChange(lastSignal: TelematicsSignal, newSignal: TelematicsSignal): boolean {
        const socChange = Math.abs((lastSignal.socPct || 0) - (newSignal.socPct || 0));

        let rangeChange = 0;
        if (lastSignal.batteryRangeKm && newSignal.batteryRangeKm) {
            rangeChange = Math.abs(lastSignal.batteryRangeKm - newSignal.batteryRangeKm) * 0.621371; // Convert to miles
        }

        return socChange >= 1 || rangeChange >= 2; // 1% SOC or 2 miles range
    }

    /**
     * Check for significant odometer changes (important)
     * Movement > 0.1 miles
     */
    private hasSignificantOdometerChange(lastSignal: TelematicsSignal, newSignal: TelematicsSignal): boolean {
        const odoChange = Math.abs((lastSignal.odoMiles || 0) - (newSignal.odoMiles || 0));
        return odoChange >= 0.1; // 0.1 miles threshold
    }

    /**
     * Routine storage - store every 15 minutes regardless of changes
     * This ensures we have regular heartbeat data
     */
    private shouldStoreRoutine(lastSignal: TelematicsSignal, newSignal: TelematicsSignal): boolean {
        const lastTs = new Date(lastSignal.ts);
        const newTs = new Date(newSignal.ts);
        const timeDiff = newTs.getTime() - lastTs.getTime();

        // Store every 15 minutes as routine heartbeat
        return timeDiff >= 15 * 60 * 1000; // 15 minutes
    }

    /**
     * Calculate distance between two GPS coordinates in meters
     */
    private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const R = 6371000; // Earth's radius in meters
        const dLat = this.toRadians(lat2 - lat1);
        const dLon = this.toRadians(lon2 - lon1);
        const a =
            Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    private toRadians(degrees: number): number {
        return degrees * (Math.PI/180);
    }

    /**
     * Initialize smart logging collections with appropriate TTL indexes
     */
    async initializeSmartCollections(): Promise<void> {
        const db = await getDatabase();

        try {
            // Critical signals collection (30 days retention)
            const criticalCollection = db.collection('telematics_signals_critical');
            await criticalCollection.createIndex(
                { serverTs: 1 },
                {
                    name: 'ttl_critical_idx',
                    expireAfterSeconds: 30 * 24 * 60 * 60, // 30 days
                    background: true
                }
            );
            await criticalCollection.createIndex({ vin: 1, ts: -1 }, { background: true });

            // Important signals collection (14 days retention)
            const importantCollection = db.collection('telematics_signals_important');
            await importantCollection.createIndex(
                { serverTs: 1 },
                {
                    name: 'ttl_important_idx',
                    expireAfterSeconds: 14 * 24 * 60 * 60, // 14 days
                    background: true
                }
            );
            await importantCollection.createIndex({ vin: 1, ts: -1 }, { background: true });

            // Routine signals collection (3 days retention)
            const routineCollection = db.collection('telematics_signals_routine');
            await routineCollection.createIndex(
                { serverTs: 1 },
                {
                    name: 'ttl_routine_idx',
                    expireAfterSeconds: 3 * 24 * 60 * 60, // 3 days
                    background: true
                }
            );
            await routineCollection.createIndex({ vin: 1, ts: -1 }, { background: true });

            console.log('✅ Smart logging collections initialized');
            console.log('   - Critical signals: 30 days TTL');
            console.log('   - Important signals: 14 days TTL');
            console.log('   - Routine signals: 3 days TTL');

        } catch (error: any) {
            if (error.message?.includes('already exists')) {
                console.log('✅ Smart logging collections already exist');
            } else {
                console.error('❌ Failed to create smart logging collections:', error);
                throw error;
            }
        }
    }

    /**
     * Get comprehensive signal history across all collections
     */
    async getSignalHistory(vin: string, limit: number = 100): Promise<TelematicsSignal[]> {
        const db = await getDatabase();

        const [critical, important, routine] = await Promise.all([
            db.collection('telematics_signals_critical')
                .find({ vin })
                .sort({ ts: -1 })
                .limit(limit)
                .toArray(),
            db.collection('telematics_signals_important')
                .find({ vin })
                .sort({ ts: -1 })
                .limit(limit)
                .toArray(),
            db.collection('telematics_signals_routine')
                .find({ vin })
                .sort({ ts: -1 })
                .limit(limit)
                .toArray()
        ]);

        // Combine and sort by timestamp
        const allSignals = [...critical, ...important, ...routine] as unknown as TelematicsSignal[];
        allSignals.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

        return allSignals.slice(0, limit);
    }
}

export const smartLogger = SmartLogger.getInstance();