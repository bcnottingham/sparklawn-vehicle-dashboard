import { MongoClient, Db, Collection } from 'mongodb';
import TimezoneUtils from '../utils/timezone';

export interface ParkingSession {
    _id?: string;
    vehicleId: string;
    vehicleName: string;
    
    // Parking timing
    parkingStartTime: Date; // When officially considered "parked" (after 1-minute grace)
    ignitionOffTime: Date; // When ignition actually turned off
    parkingEndTime?: Date; // When vehicle truly departed (moved >0.5 miles)
    
    // Location
    parkingLocation: {
        latitude: number;
        longitude: number;
        address?: string;
    };
    
    // Parking behavior analysis
    totalParkingDuration?: number; // minutes from parkingStartTime to parkingEndTime
    ignitionCycles: IgnitionCycle[]; // Brief engine starts during parking
    isCurrentlyParked: boolean;
    
    // Trip that led to this parking
    previousTripId?: string;
    
    // Trip that ended this parking
    nextTripId?: string;
    
    // Data quality
    lastUpdated: Date;
}

export interface IgnitionCycle {
    cycleNumber: number;
    ignitionOnTime: Date;
    ignitionOffTime?: Date;
    duration?: number; // minutes
    purpose: 'cooling' | 'break' | 'loading' | 'unknown'; // Inferred purpose
    batteryUsed?: number; // % battery during this cycle
    maxLocationChange?: number; // meters moved during cycle
}

export interface VehicleParkingState {
    vehicleId: string;
    vehicleName: string;
    currentParkingSession?: ParkingSession;
    lastIgnitionOffTime?: Date;
    isInGracePeriod: boolean; // True during 1-minute grace period
    gracePeriodEnd?: Date;
}

export class ParkingDetectionService {
    private client!: MongoClient;
    private db!: Db;
    private parkingSessionsCollection!: Collection<ParkingSession>;

    private vehicleParkingStates: Map<string, VehicleParkingState> = new Map();
    private isConnected: boolean = false;
    private connectionPromise: Promise<void> | null = null;

    // Configuration
    private readonly PARKING_GRACE_PERIOD = 1 * 60 * 1000; // 1 minute
    private readonly TRIP_THRESHOLD_DISTANCE = 804.67; // 0.5 miles in meters
    private readonly MAX_PARKING_IGNITION_CYCLE = 30 * 60 * 1000; // 30 minutes max for parking cycles

    constructor() {
        this.connectionPromise = this.connect();
    }
    
    private async connect(): Promise<void> {
        try {
            const mongoUri = process.env.MONGODB_URI;
            if (!mongoUri) {
                console.warn('⚠️ MONGODB_URI not configured - parking detection service disabled');
                return;
            }
            
            this.client = new MongoClient(mongoUri);
            await this.client.connect();
            this.db = this.client.db('sparklawn-fleet');
            
            this.parkingSessionsCollection = this.db.collection<ParkingSession>('parking_sessions');
            
            // Create indexes for efficient queries
            await this.parkingSessionsCollection.createIndex({ vehicleId: 1, parkingStartTime: -1 });
            await this.parkingSessionsCollection.createIndex({ isCurrentlyParked: 1 });
            await this.parkingSessionsCollection.createIndex({ parkingStartTime: -1 });
            
            console.log(TimezoneUtils.logWithTimezone('Parking detection service connected to MongoDB'));

            // Load current parking sessions
            await this.loadCurrentParkingSessions();

            this.isConnected = true;
        } catch (error) {
            console.error('❌ Failed to connect parking detection service:', error);
            this.isConnected = false;
            throw error;
        }
    }
    
    private async loadCurrentParkingSessions(): Promise<void> {
        await this.ensureConnected();
        if (!this.isConnected) return;

        const activeSessions = await this.parkingSessionsCollection
            .find({ isCurrentlyParked: true })
            .toArray();
            
        for (const session of activeSessions) {
            this.vehicleParkingStates.set(session.vehicleId, {
                vehicleId: session.vehicleId,
                vehicleName: session.vehicleName,
                currentParkingSession: session,
                isInGracePeriod: false
            });
        }
        
        console.log(TimezoneUtils.logWithTimezone(`Loaded ${activeSessions.length} active parking sessions`));
    }

    private async ensureConnected(): Promise<void> {
        if (!this.isConnected && this.connectionPromise) {
            await this.connectionPromise;
        }
        if (!this.isConnected) {
            console.warn('⚠️ Parking detection service not connected to MongoDB - operation skipped');
            return;
        }
    }
    
    /**
     * Handle when vehicle ignition turns OFF
     */
    async handleIgnitionOff(vehicleId: string, vehicleName: string, location: { latitude: number; longitude: number; address?: string }): Promise<void> {
        const now = new Date();
        const gracePeriodEnd = new Date(now.getTime() + this.PARKING_GRACE_PERIOD);
        
        console.log(TimezoneUtils.logWithTimezone(`🔑 ${vehicleName}: Ignition OFF - Starting grace period (1 minute)`));
        
        // Check if already in a parking session (ignition cycle)
        const currentState = this.vehicleParkingStates.get(vehicleId);
        
        if (currentState?.currentParkingSession) {
            // This is an ignition cycle during parking
            await this.endIgnitionCycle(vehicleId, now);
        } else {
            // Start new grace period
            this.vehicleParkingStates.set(vehicleId, {
                vehicleId,
                vehicleName,
                lastIgnitionOffTime: now,
                isInGracePeriod: true,
                gracePeriodEnd
            });
            
            // Schedule parking confirmation after grace period
            setTimeout(() => {
                this.confirmParking(vehicleId, location);
            }, this.PARKING_GRACE_PERIOD);
        }
    }
    
    /**
     * Handle when vehicle ignition turns ON
     */
    async handleIgnitionOn(vehicleId: string, vehicleName: string, location: { latitude: number; longitude: number }): Promise<void> {
        const now = new Date();
        const currentState = this.vehicleParkingStates.get(vehicleId);
        
        if (!currentState) {
            console.log(TimezoneUtils.logWithTimezone(`🔑 ${vehicleName}: Ignition ON - No parking state`));
            return;
        }
        
        if (currentState.isInGracePeriod) {
            // Ignition turned on during grace period - cancel parking
            console.log(TimezoneUtils.logWithTimezone(`🔑 ${vehicleName}: Ignition ON during grace period - Parking cancelled`));
            this.vehicleParkingStates.delete(vehicleId);
            return;
        }
        
        if (currentState.currentParkingSession) {
            // Start new ignition cycle during parking
            await this.startIgnitionCycle(vehicleId, now, location);
        }
    }
    
    /**
     * Handle when vehicle moves significantly (>0.5 miles)
     */
    async handleSignificantMovement(vehicleId: string, vehicleName: string, distance: number, newLocation: { latitude: number; longitude: number }): Promise<void> {
        const currentState = this.vehicleParkingStates.get(vehicleId);
        
        if (currentState?.currentParkingSession && distance > this.TRIP_THRESHOLD_DISTANCE) {
            console.log(TimezoneUtils.logWithTimezone(`🚗 ${vehicleName}: Moved ${(distance/1000).toFixed(1)}km - Ending parking session`));
            await this.endParkingSession(vehicleId, newLocation);
        }
    }
    
    private async confirmParking(vehicleId: string, location: { latitude: number; longitude: number; address?: string }): Promise<void> {
        await this.ensureConnected();
        if (!this.isConnected) return;

        const currentState = this.vehicleParkingStates.get(vehicleId);

        if (!currentState || !currentState.isInGracePeriod || !currentState.lastIgnitionOffTime) {
            return; // Grace period was cancelled
        }
        
        const parkingStartTime = new Date(currentState.lastIgnitionOffTime.getTime() + this.PARKING_GRACE_PERIOD);
        
        const parkingSession: ParkingSession = {
            vehicleId: vehicleId,
            vehicleName: currentState.vehicleName,
            parkingStartTime,
            ignitionOffTime: currentState.lastIgnitionOffTime,
            parkingLocation: location,
            ignitionCycles: [],
            isCurrentlyParked: true,
            lastUpdated: new Date()
        };
        
        const result = await this.parkingSessionsCollection.insertOne(parkingSession as any);
        parkingSession._id = result.insertedId?.toString();
        
        // Update state
        this.vehicleParkingStates.set(vehicleId, {
            vehicleId,
            vehicleName: currentState.vehicleName,
            currentParkingSession: parkingSession,
            isInGracePeriod: false
        });
        
        console.log(TimezoneUtils.logWithTimezone(`🅿️ ${currentState.vehicleName}: PARKED at ${location.address || 'Unknown location'}`));
    }
    
    private async startIgnitionCycle(vehicleId: string, ignitionOnTime: Date, location: { latitude: number; longitude: number }): Promise<void> {
        await this.ensureConnected();
        if (!this.isConnected) return;

        const currentState = this.vehicleParkingStates.get(vehicleId);

        if (!currentState?.currentParkingSession) return;
        
        const session = currentState.currentParkingSession;
        const cycleNumber = session.ignitionCycles.length + 1;
        
        const newCycle: IgnitionCycle = {
            cycleNumber,
            ignitionOnTime,
            purpose: this.inferCyclePurpose(cycleNumber, ignitionOnTime),
            maxLocationChange: 0
        };
        
        session.ignitionCycles.push(newCycle);
        session.lastUpdated = new Date();
        
        await this.parkingSessionsCollection.updateOne(
            { _id: session._id as any },
            { $set: { ignitionCycles: session.ignitionCycles, lastUpdated: session.lastUpdated } }
        );
        
        console.log(TimezoneUtils.logWithTimezone(`🔄 ${currentState.vehicleName}: Ignition cycle #${cycleNumber} started (${newCycle.purpose})`));
    }
    
    private async endIgnitionCycle(vehicleId: string, ignitionOffTime: Date): Promise<void> {
        await this.ensureConnected();
        if (!this.isConnected) return;

        const currentState = this.vehicleParkingStates.get(vehicleId);

        if (!currentState?.currentParkingSession) return;
        
        const session = currentState.currentParkingSession;
        const lastCycle = session.ignitionCycles[session.ignitionCycles.length - 1];
        
        if (lastCycle && !lastCycle.ignitionOffTime) {
            lastCycle.ignitionOffTime = ignitionOffTime;
            lastCycle.duration = (ignitionOffTime.getTime() - lastCycle.ignitionOnTime.getTime()) / (1000 * 60);
            
            session.lastUpdated = new Date();
            
            await this.parkingSessionsCollection.updateOne(
                { _id: session._id as any },
                { $set: { ignitionCycles: session.ignitionCycles, lastUpdated: session.lastUpdated } }
            );
            
            console.log(TimezoneUtils.logWithTimezone(`🔄 ${currentState.vehicleName}: Ignition cycle #${lastCycle.cycleNumber} ended (${lastCycle.duration?.toFixed(1)}min)`));
        }
    }
    
    private async endParkingSession(vehicleId: string, newLocation: { latitude: number; longitude: number }): Promise<void> {
        await this.ensureConnected();
        if (!this.isConnected) return;

        const currentState = this.vehicleParkingStates.get(vehicleId);

        if (!currentState?.currentParkingSession) return;
        
        const session = currentState.currentParkingSession;
        const now = new Date();
        
        session.parkingEndTime = now;
        session.totalParkingDuration = (now.getTime() - session.parkingStartTime.getTime()) / (1000 * 60);
        session.isCurrentlyParked = false;
        session.lastUpdated = now;
        
        await this.parkingSessionsCollection.updateOne(
            { _id: session._id as any },
            { 
                $set: { 
                    parkingEndTime: session.parkingEndTime,
                    totalParkingDuration: session.totalParkingDuration,
                    isCurrentlyParked: false,
                    lastUpdated: session.lastUpdated
                } 
            }
        );
        
        // Remove from active state
        this.vehicleParkingStates.delete(vehicleId);
        
        console.log(TimezoneUtils.logWithTimezone(`🚗 ${currentState.vehicleName}: Parking ended after ${TimezoneUtils.formatDuration(session.totalParkingDuration * 60 * 1000)}`));
    }
    
    private inferCyclePurpose(cycleNumber: number, ignitionOnTime: Date): 'cooling' | 'break' | 'loading' | 'unknown' {
        const centralTime = TimezoneUtils.toCentralTime(ignitionOnTime);
        const hour = centralTime.hour();
        const temp = 75; // TODO: Get actual temperature
        
        // Hot weather (>85°F) = likely cooling
        if (temp > 85) return 'cooling';
        
        // Break times (lunch, etc.)
        if ((hour >= 11 && hour <= 13) || (hour >= 15 && hour <= 16)) return 'break';
        
        // Multiple cycles = likely loading/unloading
        if (cycleNumber > 1) return 'loading';
        
        return 'unknown';
    }
    
    /**
     * Get current parking status for a vehicle
     */
    getCurrentParkingStatus(vehicleId: string): { isParked: boolean; duration: string; cycles: number } {
        const currentState = this.vehicleParkingStates.get(vehicleId);
        
        if (!currentState?.currentParkingSession) {
            return { isParked: false, duration: '0m', cycles: 0 };
        }
        
        const session = currentState.currentParkingSession;
        const now = new Date();
        const parkingDuration = now.getTime() - session.parkingStartTime.getTime();
        const duration = TimezoneUtils.formatDuration(parkingDuration);
        
        return {
            isParked: true,
            duration,
            cycles: session.ignitionCycles.length
        };
    }
    
    /**
     * Get parking sessions for a vehicle
     */
    async getParkingSessions(vehicleId: string, limit: number = 10): Promise<ParkingSession[]> {
        await this.ensureConnected();
        if (!this.isConnected) return [];

        return await this.parkingSessionsCollection
            .find({ vehicleId })
            .sort({ parkingStartTime: -1 })
            .limit(limit)
            .toArray();
    }
    
    /**
     * Map VIN to vehicle UUID for parking lookup
     * Since the parking system uses UUIDs but the fleet uses VINs
     */
    private readonly vinToUuidMap: Map<string, string> = new Map([
        // Lightning 1
        ['1FT6W1EV3PWG37779', '35658624-018d-4041-ab6b-fa396f06af16'],
        // eTransit Van  
        ['1FTBW1XK6PKA30591', '810bd9c5-a531-4984-8e5b-c59ef8a4a47c'],
        // Lightning XLT
        ['1FTVW1EV3NWG07402', '2dc0332a-d8fc-4ef8-b0e3-31ec20caeee0'],
        // Lightning 2
        ['1FTVW1EL3NWG00285', 'c0a4d743-eb5d-4dd8-8ce2-1216bf359bda']
    ]);
    
    /**
     * Get current parking status by VIN or UUID
     */
    async getCurrentParkingStatusByVinOrId(identifier: string): Promise<{ isParked: boolean; duration: string; cycles: number }> {
        // Check if it's a VIN (starts with 1F) and map to UUID
        let vehicleId = identifier;
        if (identifier.startsWith('1F')) {
            const mappedId = this.vinToUuidMap.get(identifier);
            if (mappedId) {
                vehicleId = mappedId;
            }
        }
        
        // Use the existing method with the mapped ID
        return this.getCurrentParkingStatus(vehicleId);
    }
}

export const parkingDetectionService = new ParkingDetectionService();