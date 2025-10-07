import { MongoClient, Db, Collection } from 'mongodb';
import { hybridVehicleClient } from './hybridVehicleClient';
import { parkingDetectionService } from './parkingDetectionService';
import { smartAlertsService } from './smartAlertsService';
import TimezoneUtils from '../utils/timezone';
import { saveTelematics, upsertVehicleState, getLatestSignals } from '../db';
import { TelematicsSignal, VehicleState as NewVehicleState, VehicleStateEnum } from '../db/init';

export interface IgnitionTrip {
    _id?: string;
    vehicleId: string;
    vehicleName: string;
    
    // Trip timing
    ignitionOnTime: Date;
    ignitionOffTime?: Date;
    totalRunTime?: number; // minutes
    isActive: boolean;
    
    // Trip locations
    startLocation: {
        latitude: number;
        longitude: number;
        address?: string;
        clientName?: string; // From Jobber integration
    };
    endLocation?: {
        latitude: number;
        longitude: number;
        address?: string;
        clientName?: string;
    };
    
    // Trip metrics
    startOdometer?: number;
    endOdometer?: number;
    distanceTraveled?: number; // miles
    startBattery?: number;
    endBattery?: number;
    batteryUsed?: number;
    
    // Route tracking
    routePoints: RoutePoint[];
    
    // Trip analysis
    maxSpeed?: number;
    avgSpeed?: number;
    totalStops: number;
    
    // Business context
    estimatedClientName?: string;
    jobberJobId?: string;
    businessPurpose?: 'job_site' | 'travel' | 'maintenance' | 'personal';
    
    // Data quality
    dataSource: 'fordpass' | 'smartcar' | 'hybrid';
    lastUpdated: Date;
}

export interface RoutePoint {
    vehicleId: string;
    timestamp: Date;
    latitude: number;
    longitude: number;
    batteryLevel?: number;
    ignitionStatus: 'On' | 'Off' | 'Accessory';
    address?: string;
    speed?: number;
    isMoving: boolean;
    dataSource?: string;
}

export interface VehicleState {
    vehicleId: string;
    lastIgnitionStatus: 'On' | 'Off' | 'Accessory';
    lastLocation: { latitude: number; longitude: number };
    lastUpdate: Date;
    activeTrip?: string; // Trip ID if currently active
    lastBatteryLevel?: number; // For battery drain detection
    lastKnownClient?: string; // Last client location name for departure detection
}

export class BackgroundMonitoringService {
    private client!: MongoClient;
    private db!: Db;
    private tripsCollection!: Collection<IgnitionTrip>;
    private routePointsCollection!: Collection<RoutePoint>;
    private vehicleStatesCollection!: Collection<VehicleState>;

    private vehicleStates: Map<string, VehicleState> = new Map();
    private monitoringInterval: NodeJS.Timeout | null = null;
    private isRunning: boolean = false;
    private serverStartTime: Date = new Date(); // Track when server started to prevent false alerts

    // New state management with MongoDB as single source of truth
    private stateDerivationInterval: NodeJS.Timeout | null = null;
    private readonly STATE_DERIVATION_INTERVAL_BUSINESS_HOURS = 5 * 1000; // 5 seconds during business hours
    private readonly STATE_DERIVATION_INTERVAL_OFF_HOURS = 10 * 60 * 1000; // 10 minutes off-hours

    // Configuration - GPS noise filtering and realistic trip detection
    private readonly MONITORING_INTERVAL_BUSINESS_HOURS = 5 * 1000; // 5 seconds during business hours (6am-9pm CST)
    private readonly MONITORING_INTERVAL_OFF_HOURS = 10 * 60 * 1000; // 10 minutes off-hours (9pm-6am CST)
    private readonly BUSINESS_HOURS_START = 6; // 6am CST
    private readonly BUSINESS_HOURS_END = 21; // 9pm CST
    private readonly MIN_MOVEMENT_THRESHOLD = 15; // meters - tight threshold for trip detection
    private readonly MIN_TRIP_DISTANCE = 100; // meters - minimum distance to consider a real trip
    private readonly MIN_SPEED_THRESHOLD = 3; // mph - ignore movements slower than walking speed
    private readonly MAX_REASONABLE_SPEED = 85; // mph - maximum realistic speed for work vehicles
    private readonly GPS_ACCURACY_BUFFER = 15; // meters - typical GPS accuracy, ignore smaller movements
    private readonly MIN_TIME_BETWEEN_POINTS = 5; // seconds - minimum time to avoid division by zero
    private readonly STOP_DETECTION_TIME = 5 * 60 * 1000; // 5 minutes to avoid false stops (traffic lights, etc.)
    private readonly MAX_TRIP_IDLE_TIME = 30 * 60 * 1000; // 30 minutes before considering trip ended

    // McRay Shop geofence for automatic trip start detection
    private readonly MCRAY_SHOP_GEOFENCE = {
        latitude: 36.183151,
        longitude: -94.169547,
        radius: 100 // meters - vehicles exiting this radius trigger trip start
    };

    // Track which vehicles are currently inside McRay Shop geofence
    private vehiclesInMcRayGeofence: Map<string, boolean> = new Map();
    
    constructor() {
        // MongoDB connection will be initialized manually after dotenv.config()
    }
    
    async initialize(): Promise<void> {
        try {
            const mongoUri = process.env.MONGODB_URI;
            if (!mongoUri) {
                console.warn('⚠️ MONGODB_URI not configured - background monitoring service disabled');
                return;
            }
            
            this.client = new MongoClient(mongoUri);
            await this.client.connect();
            this.db = this.client.db('sparklawn_fleet');
            
            // Initialize collections
            this.tripsCollection = this.db.collection<IgnitionTrip>('ignition_trips');
            this.routePointsCollection = this.db.collection<RoutePoint>('route_points');
            this.vehicleStatesCollection = this.db.collection<VehicleState>('vehicle_states');
            
            // Create indexes
            await this.createIndexes();

            // Initialize smart logging collections
            const { smartLogger } = await import('./smartLogger');
            await smartLogger.initializeSmartCollections();

            // Load existing vehicle states (temporarily disabled for startup performance)
            // await this.loadVehicleStates();
            console.log('⏩ Skipped vehicle state loading for faster startup');

            // Initialize smart alerts service
            await smartAlertsService.initialize();
            
            console.log('✅ Background monitoring service connected to MongoDB');
        } catch (error) {
            console.error('❌ Failed to connect background monitoring service:', error);
            throw error;
        }
    }
    
    private async createIndexes(): Promise<void> {
        try {
            // Ignition trips indexes
            await this.tripsCollection.createIndex({ vehicleId: 1, ignitionOnTime: -1 });
            await this.tripsCollection.createIndex({ isActive: 1 });
            await this.tripsCollection.createIndex({ ignitionOnTime: -1 });
            await this.tripsCollection.createIndex({ vehicleId: 1, isActive: 1 });

            // Route points indexes with TTL for automatic cleanup (30 days)
            await this.routePointsCollection.createIndex({ timestamp: -1 });
            await this.routePointsCollection.createIndex({ timestamp: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 }); // 30 days TTL
            await this.routePointsCollection.createIndex({ "latitude": 1, "longitude": 1 });
            await this.routePointsCollection.createIndex({ vehicleId: 1, timestamp: -1 }); // For loadVehicleStates query

            // Vehicle states indexes
            await this.vehicleStatesCollection.createIndex({ vehicleId: 1 }, { unique: true });
            await this.vehicleStatesCollection.createIndex({ lastUpdate: -1 });

            console.log('✅ Background monitoring indexes created with TTL cleanup');
        } catch (error) {
            console.warn('⚠️ Failed to create background monitoring indexes:', error);
        }
    }
    
    private async loadVehicleStates(): Promise<void> {
        try {
            // Load active trips to restore vehicle states
            const activeTrips = await this.tripsCollection.find({ isActive: true }).toArray();
            
            for (const trip of activeTrips) {
                // Get the last route point for this specific vehicle to restore state
                const lastPoint = await this.routePointsCollection
                    .findOne(
                        { vehicleId: trip.vehicleId }, 
                        { sort: { timestamp: -1 } }
                    );
                    
                if (lastPoint) {
                    this.vehicleStates.set(trip.vehicleId, {
                        vehicleId: trip.vehicleId,
                        lastIgnitionStatus: lastPoint.ignitionStatus,
                        lastLocation: {
                            latitude: lastPoint.latitude,
                            longitude: lastPoint.longitude
                        },
                        lastUpdate: lastPoint.timestamp,
                        activeTrip: trip._id?.toString(),
                        lastBatteryLevel: lastPoint.batteryLevel
                    });
                }
            }
            
            console.log(`✅ Loaded ${this.vehicleStates.size} vehicle states`);
        } catch (error) {
            console.error('❌ Failed to load vehicle states:', error);
        }
    }
    
    private async persistVehicleState(vehicleId: string, state: VehicleState): Promise<void> {
        try {
            await this.vehicleStatesCollection.replaceOne(
                { vehicleId },
                state,
                { upsert: true }
            );
        } catch (error) {
            console.warn(`⚠️ Failed to persist vehicle state for ${vehicleId}:`, error);
        }
    }
    
    private async loadVehicleStateFromDatabase(vehicleId: string): Promise<VehicleState | null> {
        try {
            return await this.vehicleStatesCollection.findOne({ vehicleId });
        } catch (error) {
            console.warn(`⚠️ Failed to load vehicle state for ${vehicleId}:`, error);
            return null;
        }
    }
    
    /**
     * Check if current time is within business hours (6am-9pm CST)
     */
    private isBusinessHours(): boolean {
        const now = new Date();
        // Convert to CST (UTC-6, or UTC-5 during DST)
        const cstOffset = -6 * 60; // CST offset in minutes
        const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
        const cstTime = new Date(utcTime + (cstOffset * 60000));
        const hour = cstTime.getHours();

        return hour >= this.BUSINESS_HOURS_START && hour < this.BUSINESS_HOURS_END;
    }

    /**
     * Get current monitoring interval based on business hours
     */
    private getCurrentMonitoringInterval(): number {
        return this.isBusinessHours()
            ? this.MONITORING_INTERVAL_BUSINESS_HOURS
            : this.MONITORING_INTERVAL_OFF_HOURS;
    }

    public startMonitoring(): void {
        if (this.isRunning) {
            console.log('⚠️ Background monitoring already running');
            return;
        }

        this.isRunning = true;
        const interval = this.getCurrentMonitoringInterval();
        const isBusinessHrs = this.isBusinessHours();
        console.log(`🚀 Starting background vehicle monitoring (${interval / 1000}s intervals - ${isBusinessHrs ? 'BUSINESS HOURS' : 'OFF-HOURS'} mode)`);

        // Start the monitoring loop with dynamic interval checking
        const monitorWithIntervalCheck = async () => {
            await this.monitorAllVehicles();

            // Restart interval if business hours changed
            const newInterval = this.getCurrentMonitoringInterval();
            if (newInterval !== interval) {
                console.log(`⏰ Switching monitoring interval: ${interval / 1000}s → ${newInterval / 1000}s (${this.isBusinessHours() ? 'BUSINESS HOURS' : 'OFF-HOURS'})`);
                this.stopMonitoring();
                this.startMonitoring();
            }
        };

        this.monitoringInterval = setInterval(monitorWithIntervalCheck, interval);

        // Do an initial check immediately
        this.monitorAllVehicles();

        // Start state derivation loop
        this.startStateDerivation();
    }
    
    public stopMonitoring(): void {
        if (!this.isRunning) return;
        
        this.isRunning = false;
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }

        if (this.stateDerivationInterval) {
            clearInterval(this.stateDerivationInterval);
            this.stateDerivationInterval = null;
        }

        console.log('🛑 Background monitoring stopped');
    }
    
    private async monitorAllVehicles(): Promise<void> {
        try {
            console.log('🔍 Monitoring all vehicles...');
            
            // Get all vehicle IDs
            const vehicleList = await hybridVehicleClient.getVehicles();
            
            // Monitor each vehicle
            const monitoringPromises = vehicleList.vehicles.map(vehicleId => 
                this.monitorVehicle(vehicleId)
            );
            
            await Promise.allSettled(monitoringPromises);
            
        } catch (error) {
            console.error('❌ Error during vehicle monitoring cycle:', error);
        }
    }
    
    private async monitorVehicle(vehicleId: string): Promise<void> {
        try {
            // Get current vehicle data
            const vehicleData = await hybridVehicleClient.getVehicleData(vehicleId);
            
            if (!vehicleData.location?.latitude || !vehicleData.location?.longitude) {
                console.warn(`⚠️ No location data for vehicle ${vehicleData.name}`);
                return;
            }
            
            // Enhanced ignition status detection using multiple factors
            let ignitionStatus: 'On' | 'Off' | 'Accessory' = 'Off';

            // Try to get ignition status from vehicle data first
            const vehicleDetail = vehicleData as any;
            if (vehicleDetail.ignition_status?.value) {
                ignitionStatus = vehicleDetail.ignition_status.value as 'On' | 'Off' | 'Accessory';
            } else {
                // Multi-factor inference when direct ignition data unavailable
                const isRunning = this.detectVehicleActivity(vehicleId, vehicleData);
                ignitionStatus = isRunning ? 'On' : 'Off';
            }

            // GPS-BASED PARKING OVERRIDE: Override Ford API ignition status if vehicle is clearly parked
            // This prevents fragmented trips caused by ignition fluctuations when vehicles are stationary
            const currentLocation = {
                latitude: vehicleData.location.latitude,
                longitude: vehicleData.location.longitude
            };

            // Pass client name for aggressive parking detection at client locations
            const clientName = vehicleData.location?.clientName;
            const isGpsParked = await this.detectGpsBasedParking(vehicleId, currentLocation, clientName);
            if (isGpsParked) {
                const locationContext = clientName ? `at ${clientName}` : 'general location';
                console.log(`🅿️ GPS Override: ${vehicleData.name} detected as PARKED ${locationContext} (overriding Ford API ignition: ${ignitionStatus})`);
                ignitionStatus = 'Off'; // Force parking status to prevent trip fragmentation

                // GPS parking override - StateDeriver will handle canonical state
                console.log(`✅ Updated canonical state for ${vehicleData.name}: PARKED (GPS parking override)`);
            }
            
            // Create route point
            const routePoint: RoutePoint = {
                vehicleId,
                timestamp: new Date(),
                latitude: currentLocation.latitude,
                longitude: currentLocation.longitude,
                batteryLevel: vehicleData.battery.percentRemaining,
                ignitionStatus,
                address: vehicleData.location.address,
                isMoving: this.detectMovement(vehicleId, currentLocation),
                dataSource: 'ford-telematics'
            };
            
            // Get previous vehicle state
            const previousState = this.vehicleStates.get(vehicleId);
            
            // Detect ignition state changes
            if (!previousState || previousState.lastIgnitionStatus !== ignitionStatus) {
                await this.handleIgnitionStateChange(
                    vehicleId,
                    vehicleData.name,
                    ignitionStatus,
                    previousState?.lastIgnitionStatus,
                    vehicleData,
                    routePoint
                );
            }
            
            // Update active trip if exists
            if (previousState?.activeTrip) {
                await this.updateActiveTrip(previousState.activeTrip, routePoint);
            }
            
            // Check for significant movement during parking
            if (previousState) {
                const distance = this.calculateDistance(
                    previousState.lastLocation.latitude,
                    previousState.lastLocation.longitude,
                    currentLocation.latitude,
                    currentLocation.longitude
                );
                
                if (distance > 0) { // Any movement
                    await parkingDetectionService.handleSignificantMovement(
                        vehicleId,
                        vehicleData.name,
                        distance,
                        currentLocation
                    );
                }
            }
            
            // Store route point intelligently - only if significant change or every 5 minutes
            const shouldStore = await this.shouldStoreRoutePoint(vehicleId, routePoint);
            if (shouldStore) {
                await this.routePointsCollection.insertOne(routePoint);
            }

            // Check for McRay Shop geofence exit - this ensures trips starting from McRay are captured
            await this.checkMcRayGeofenceExit(vehicleId, currentLocation, vehicleData.name, routePoint);

            // Check for client location match
            let currentClientName: string | undefined;
            try {
                const { clientLocationService } = await import('./clientLocations');
                currentClientName = await clientLocationService.findClientLocationMatch(
                    currentLocation.latitude,
                    currentLocation.longitude
                ) || undefined;
            } catch (error) {
                console.warn(`Failed to check client location for ${vehicleId}:`, error);
            }

            // Update vehicle state
            const newVehicleState = {
                vehicleId,
                lastIgnitionStatus: ignitionStatus,
                lastLocation: currentLocation,
                lastUpdate: new Date(),
                activeTrip: previousState?.activeTrip,
                lastBatteryLevel: vehicleData.battery.percentRemaining,
                lastKnownClient: currentClientName
            };

            this.vehicleStates.set(vehicleId, newVehicleState);

            // Persist to database
            await this.persistVehicleState(vehicleId, newVehicleState);

        } catch (error) {
            console.error(`❌ Error monitoring vehicle ${vehicleId}:`, error);
        }
    }
    
    private detectMovement(vehicleId: string, currentLocation: { latitude: number; longitude: number }): boolean {
        const previousState = this.vehicleStates.get(vehicleId);
        if (!previousState) return false;

        const distance = this.calculateDistance(
            previousState.lastLocation.latitude,
            previousState.lastLocation.longitude,
            currentLocation.latitude,
            currentLocation.longitude
        );

        // Only consider it movement if it exceeds GPS accuracy buffer AND minimum movement threshold
        const isSignificantMovement = distance > Math.max(this.GPS_ACCURACY_BUFFER, this.MIN_MOVEMENT_THRESHOLD);

        if (isSignificantMovement) {
            console.log(`🚗 Significant movement detected for ${vehicleId}: ${distance.toFixed(1)}m`);
        }

        return isSignificantMovement;
    }

    private detectVehicleActivity(vehicleId: string, vehicleData: any): boolean {
        const previousState = this.vehicleStates.get(vehicleId);
        
        // Factor 1: Currently charging (definitely activity)
        if (vehicleData.battery.isCharging) {
            console.log(`🔌 ${vehicleData.name}: Activity detected - CHARGING`);
            return true;
        }
        
        // Factor 2: Significant location change (movement) - filter GPS drift
        if (previousState) {
            const currentLocation = vehicleData.location;
            const distance = this.calculateDistance(
                previousState.lastLocation.latitude,
                previousState.lastLocation.longitude,
                currentLocation.latitude,
                currentLocation.longitude
            );

            // Only consider significant movement (not GPS drift)
            if (distance > Math.max(this.GPS_ACCURACY_BUFFER, this.MIN_MOVEMENT_THRESHOLD)) {
                console.log(`🚗 ${vehicleData.name}: Activity detected - SIGNIFICANT MOVEMENT (${distance.toFixed(1)}m)`);
                return true;
            }
        }
        
        // Factor 3: Battery drain indicating recent activity
        const batteryDrain = this.detectBatteryDrain(vehicleId, vehicleData.battery.percentRemaining);
        if (batteryDrain.isDraining && batteryDrain.drainRate > 0.05) { // >0.05% in 3 seconds
            console.log(`🔋 ${vehicleData.name}: Activity detected - BATTERY DRAIN (${batteryDrain.drainRate.toFixed(1)}%/30s)`);
            return true;
        }
        
        // Factor 4: Recent significant activity (not just being "On")
        // Only consider as active if there was actual movement or battery drain recently
        if (previousState && previousState.lastIgnitionStatus === 'On') {
            const timeSinceLastUpdate = Date.now() - previousState.lastUpdate.getTime();
            
            // Only stay "On" for 5 minutes max without other activity indicators
            if (timeSinceLastUpdate < 5 * 60 * 1000) {
                // Must have additional evidence of activity, not just time-based
                // This prevents infinite "On" loops
                console.log(`⏰ ${vehicleData.name}: Recently active but checking for real activity...`);
                
                // Don't just return true - let other factors determine activity
                // This allows transitions to "Off" when vehicle actually stops
            }
        }
        
        return false;
    }

    public async detectGpsBasedParking(vehicleId: string, currentLocation: { latitude: number; longitude: number }, clientName?: string): Promise<boolean> {
        try {
            // AGGRESSIVE MODE: If at a client location and not moving, assume parked quickly
            const isAtClient = !!clientName;

            // Get recent route points for this vehicle from the database
            const recentRoutePoints = await this.db.collection('route_points')
                .find({
                    vehicleId,
                    timestamp: {
                        $gte: new Date(Date.now() - 5 * 60 * 1000) // Last 5 minutes
                    }
                })
                .sort({ timestamp: -1 })
                .limit(20)
                .toArray();

            if (recentRoutePoints.length < 2) {
                // Not enough recent data - check if vehicle has been stationary for extended period
                const extendedRoutePoints = await this.db.collection('route_points')
                    .find({
                        vehicleId,
                        timestamp: {
                            $gte: new Date(Date.now() - 30 * 60 * 1000) // Last 30 minutes
                        }
                    })
                    .sort({ timestamp: -1 })
                    .limit(10)
                    .toArray();

                if (extendedRoutePoints.length >= 2) {
                    console.log(`🅿️ Extended GPS check for ${vehicleId}: ${extendedRoutePoints.length} points in 30min window`);

                    // Check MAXIMUM movement between ANY consecutive points (not just first-to-last)
                    // This prevents false PARKED status when vehicle just started moving
                    let maxMovement = 0;
                    for (let i = 1; i < extendedRoutePoints.length; i++) {
                        const prev = extendedRoutePoints[i];
                        const curr = extendedRoutePoints[i - 1];
                        const distance = this.calculateDistance(
                            prev.latitude, prev.longitude,
                            curr.latitude, curr.longitude
                        );
                        maxMovement = Math.max(maxMovement, distance);
                    }

                    // If ANY movement > 25m in the extended window, vehicle is moving
                    // TIGHT threshold to catch trips immediately
                    if (maxMovement < 25) {
                        console.log(`🅿️ Long-term stationary detected for ${vehicleId}: ${maxMovement.toFixed(1)}m max movement in 30min`);
                        return true; // Vehicle is clearly parked for extended period
                    } else {
                        console.log(`🚗 Movement detected in extended check for ${vehicleId}: ${maxMovement.toFixed(1)}m max movement - NOT parked`);
                        return false; // Vehicle is moving
                    }
                }

                return false; // Not enough data to determine parking status
            }

            // Calculate movement statistics
            const distances = [];
            for (let i = 1; i < recentRoutePoints.length; i++) {
                const prev = recentRoutePoints[i];
                const curr = recentRoutePoints[i - 1];
                const distance = this.calculateDistance(
                    prev.latitude, prev.longitude,
                    curr.latitude, curr.longitude
                );
                distances.push(distance);
            }

            if (distances.length === 0) return false;

            const maxMovement = Math.max(...distances);
            const totalMovement = distances.reduce((sum, d) => sum + d, 0);
            const avgMovement = totalMovement / distances.length;
            const timeSpan = recentRoutePoints[0].timestamp.getTime() - recentRoutePoints[recentRoutePoints.length - 1].timestamp.getTime();

            // AGGRESSIVE PARKING DETECTION - tightened thresholds
            if (isAtClient) {
                // At client location: 1.5 minutes stationary with < 20m movement = PARKED
                const clientParkingTime = 90 * 1000; // 90 seconds (1.5 minutes)
                const clientMaxMovement = 20; // 20 meters max

                if (timeSpan >= clientParkingTime && maxMovement < clientMaxMovement) {
                    console.log(`🅿️ CLIENT PARKING for ${vehicleId} at ${clientName}: PARKED (${maxMovement.toFixed(1)}m movement over ${(timeSpan/60000).toFixed(1)}min)`);
                    return true;
                }
            } else {
                // Not at client: 2 minutes stationary with < 15m movement = PARKED
                const generalParkingTime = 2 * 60 * 1000; // 2 minutes
                const generalMaxMovement = 15; // 15 meters max

                if (timeSpan >= generalParkingTime && maxMovement < generalMaxMovement) {
                    console.log(`🅿️ GENERAL PARKING for ${vehicleId}: PARKED (${maxMovement.toFixed(1)}m movement over ${(timeSpan/60000).toFixed(1)}min)`);
                    return true;
                }
            }

            return false;

        } catch (error) {
            console.error(`❌ Error in GPS parking detection for ${vehicleId}:`, error);
            return false; // Default to not parked if error occurs
        }
    }

    private detectBatteryDrain(vehicleId: string, currentBatteryLevel: number): { isDraining: boolean; drainRate: number } {
        const previousState = this.vehicleStates.get(vehicleId);
        
        if (!previousState || !previousState.lastBatteryLevel) {
            // Store current level for next comparison
            if (previousState) {
                (previousState as any).lastBatteryLevel = currentBatteryLevel;
            }
            return { isDraining: false, drainRate: 0 };
        }
        
        const batteryChange = (previousState as any).lastBatteryLevel - currentBatteryLevel;
        const timeElapsed = Date.now() - previousState.lastUpdate.getTime();
        const drainRate = (batteryChange / (timeElapsed / (3 * 1000))) * 100; // % per 3 seconds
        
        // Update stored battery level
        (previousState as any).lastBatteryLevel = currentBatteryLevel;
        
        return {
            isDraining: batteryChange > 0, // Battery decreased
            drainRate: Math.max(0, drainRate) // Only positive drain rates
        };
    }
    
    private async handleIgnitionStateChange(
        vehicleId: string,
        vehicleName: string,
        newStatus: 'On' | 'Off' | 'Accessory',
        previousStatus: 'On' | 'Off' | 'Accessory' | undefined,
        vehicleData: any,
        routePoint: RoutePoint
    ): Promise<void> {

        console.log(`🚗 ${vehicleName}: Ignition ${previousStatus || 'Unknown'} → ${newStatus}`);

        // PREVENT FALSE ALERTS: Skip if this is during server startup grace period (first 5 minutes)
        const timeSinceStartup = Date.now() - this.serverStartTime.getTime();
        const isStartupGracePeriod = timeSinceStartup < (5 * 60 * 1000); // 5 minutes
        const isUnknownTransition = previousStatus === undefined || previousStatus === null;

        if (isStartupGracePeriod && isUnknownTransition) {
            console.log(`⏰ Skipping alert for ${vehicleName} - startup grace period (${Math.round(timeSinceStartup/1000)}s since startup)`);
            return; // Don't create false alerts during startup
        }

        if (newStatus === 'On' && previousStatus !== 'On') {
            // Vehicle started - create ignition ON alert
            await smartAlertsService.createIgnitionOnAlert(
                vehicleId,
                vehicleName,
                { latitude: routePoint.latitude, longitude: routePoint.longitude },
                vehicleData.battery.percentRemaining
            );
            
            await this.startIgnitionTrip(vehicleId, vehicleName, vehicleData, routePoint);
            
            // Notify parking detection service
            await parkingDetectionService.handleIgnitionOn(vehicleId, vehicleName, {
                latitude: routePoint.latitude,
                longitude: routePoint.longitude
            });
        } else if (newStatus === 'Off' && previousStatus === 'On') {
            // Vehicle stopped - check trip duration before creating alert to reduce noise

            // Calculate trip duration to filter out very short stops
            const vehicleState = this.vehicleStates.get(vehicleId);
            let tripDurationMinutes = 0;

            if (vehicleState?.activeTrip) {
                try {
                    const trip = await this.tripsCollection.findOne({ _id: vehicleState.activeTrip });
                    if (trip) {
                        tripDurationMinutes = (routePoint.timestamp.getTime() - trip.ignitionOnTime.getTime()) / (1000 * 60);
                        console.log(`🕐 Trip duration for ${vehicleName}: ${tripDurationMinutes.toFixed(1)} minutes`);
                    }
                } catch (error) {
                    console.warn(`⚠️ Could not calculate trip duration for ${vehicleName}:`, error);
                }
            }

            // Only create ignition OFF alert for trips longer than 1 minute to reduce noise
            const MIN_TRIP_DURATION_FOR_ALERT = 1.0; // minutes
            if (tripDurationMinutes >= MIN_TRIP_DURATION_FOR_ALERT) {
                console.log(`📢 Creating ignition OFF alert for ${vehicleName} (trip: ${tripDurationMinutes.toFixed(1)}m)`);
                await smartAlertsService.createIgnitionOffAlert(
                    vehicleId,
                    vehicleName,
                    { latitude: routePoint.latitude, longitude: routePoint.longitude },
                    vehicleData.battery.percentRemaining
                );
            } else {
                console.log(`🔇 Skipping ignition OFF alert for ${vehicleName} - trip too short (${tripDurationMinutes.toFixed(1)}m < ${MIN_TRIP_DURATION_FOR_ALERT}m)`);
            }

            await this.endIgnitionTrip(vehicleId, vehicleName, vehicleData, routePoint);
            
            // Notify parking detection service
            await parkingDetectionService.handleIgnitionOff(vehicleId, vehicleName, {
                latitude: routePoint.latitude,
                longitude: routePoint.longitude,
                address: routePoint.address
            });
        }
    }
    
    private async startIgnitionTrip(
        vehicleId: string,
        vehicleName: string,
        vehicleData: any,
        routePoint: RoutePoint
    ): Promise<void> {

        // CRITICAL: Check if there's already an active trip for this vehicle
        const existingActiveTrip = await this.tripsCollection.findOne({
            vehicleId,
            isActive: true
        });

        if (existingActiveTrip) {
            console.log(`🔄 Active trip already exists for ${vehicleName} (ID: ${existingActiveTrip._id}) - updating instead of creating duplicate`);

            // Make sure vehicle state knows about the active trip
            const vehicleState = this.vehicleStates.get(vehicleId);
            if (vehicleState && !vehicleState.activeTrip) {
                vehicleState.activeTrip = existingActiveTrip._id?.toString() || 'unknown';
            }

            // Update the existing trip with new route point instead of creating duplicate
            await this.updateActiveTrip(existingActiveTrip._id?.toString() || 'unknown', routePoint);
            return;
        }

        // Check for previous trip continuity - use last trip from today for seamless journey tracking
        let startLocation;
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0); // Start of today

        const recentTripEnd = await this.tripsCollection.findOne(
            {
                vehicleId,
                isActive: false,
                ignitionOffTime: {
                    $gte: todayStart // Any completed trip from today
                }
            },
            { sort: { ignitionOffTime: -1 } }
        );

        if (recentTripEnd && recentTripEnd.endLocation) {
            // Continue from where the last trip ended for seamless journey tracking
            startLocation = {
                latitude: recentTripEnd.endLocation.latitude,
                longitude: recentTripEnd.endLocation.longitude,
                address: recentTripEnd.endLocation.address,
                clientName: recentTripEnd.endLocation.clientName
            };
            console.log(`🔗 Trip continuity: Starting from previous trip end location: ${startLocation.clientName || startLocation.address} (same-day continuity)`);
        } else {
            // No recent trip end, use current GPS location with client priority
            const clientName = await this.getClientNameForLocation(
                routePoint.latitude,
                routePoint.longitude
            );

            // Prioritize client name over generic street address for trip start location
            const displayAddress = clientName || routePoint.address;

            startLocation = {
                latitude: routePoint.latitude,
                longitude: routePoint.longitude,
                address: displayAddress, // Use client name if available, otherwise street address
                clientName
            };

            if (clientName) {
                console.log(`🏢 Trip starting at client location: ${clientName} (prioritized over street address)`);
            }
        }

        const trip: IgnitionTrip = {
            vehicleId,
            vehicleName,
            ignitionOnTime: routePoint.timestamp,
            isActive: true,
            startLocation,
            startBattery: vehicleData.battery.percentRemaining,
            routePoints: [routePoint],
            totalStops: 0,
            dataSource: vehicleData.battery._dataSource || 'hybrid',
            lastUpdated: new Date()
        };
        
        const result = await this.tripsCollection.insertOne(trip as any);
        const tripId = (result as any).insertedId?.toString() || 'unknown';
        
        // Update vehicle state
        const vehicleState = this.vehicleStates.get(vehicleId);
        if (vehicleState) {
            vehicleState.activeTrip = tripId;
        }

        // Trip start - StateDeriver will handle canonical state updates
        console.log(`✅ Updated canonical state for ${vehicleName}: TRIP (trip started)`);

        // Create trip start alert
        await smartAlertsService.createTripStartAlert(
            vehicleId,
            vehicleName,
            tripId,
            { latitude: routePoint.latitude, longitude: routePoint.longitude },
            vehicleData.battery.percentRemaining
        );
        
        const centralTime = TimezoneUtils.toCentralTime(routePoint.timestamp);
        console.log(`\n🚀 TRIP STARTED`);
        console.log(`   Vehicle: ${vehicleName}`);
        console.log(`   Trip ID: ${tripId}`);
        console.log(`   Time: ${centralTime.format('MM/DD/YYYY h:mm:ss A')} CT`);
        console.log(`   Start Location: ${routePoint.address || 'Unknown location'}`);
        console.log(`   Battery: ${vehicleData.battery.percentRemaining}%`);
        console.log(`────────────────────────────────────────────────────────`);
    }
    
    private async endIgnitionTrip(
        vehicleId: string,
        vehicleName: string,
        vehicleData: any,
        routePoint: RoutePoint
    ): Promise<void> {
        
        const vehicleState = this.vehicleStates.get(vehicleId);
        if (!vehicleState?.activeTrip) {
            console.warn(`⚠️ No active trip found for ${vehicleName} to end`);
            return;
        }
        
        // Get the active trip
        const trip = await this.tripsCollection.findOne({ _id: vehicleState.activeTrip });
        if (!trip) {
            console.warn(`⚠️ Active trip ${vehicleState.activeTrip} not found in database`);
            return;
        }
        
        // Get client name for end location and prioritize it over street address
        const clientName = await this.getClientNameForLocation(
            routePoint.latitude,
            routePoint.longitude
        );

        // Prioritize client name over generic street address for trip end location
        const displayAddress = clientName || routePoint.address;

        if (clientName) {
            console.log(`🏢 Trip ending at client location: ${clientName} (prioritized over street address)`);
        }

        // Calculate trip metrics
        const runTime = (routePoint.timestamp.getTime() - trip.ignitionOnTime.getTime()) / (1000 * 60); // minutes
        const distanceTraveled = await this.getAccurateTripDistance(trip);
        const batteryUsed = (trip.startBattery || 0) - (vehicleData.battery.percentRemaining || 0);

        // Update trip with end data
        const updatedTrip: Partial<IgnitionTrip> = {
            ignitionOffTime: routePoint.timestamp,
            totalRunTime: runTime,
            isActive: false,
            endLocation: {
                latitude: routePoint.latitude,
                longitude: routePoint.longitude,
                address: displayAddress, // Use client name if available, otherwise street address
                clientName
            },
            endBattery: vehicleData.battery.percentRemaining,
            batteryUsed,
            distanceTraveled,
            lastUpdated: new Date()
        };
        
        await this.tripsCollection.updateOne(
            { _id: vehicleState.activeTrip },
            { $set: updatedTrip }
        );
        
        // Create trip end alert
        await smartAlertsService.createTripEndAlert(
            vehicleId,
            vehicleName,
            trip._id?.toString() || 'unknown',
            { latitude: routePoint.latitude, longitude: routePoint.longitude },
            runTime,
            distanceTraveled,
            batteryUsed
        );
        
        // Check for client visit or supplier stop
        if (clientName) {
            await smartAlertsService.createClientVisitAlert(
                vehicleId,
                vehicleName,
                clientName,
                { latitude: routePoint.latitude, longitude: routePoint.longitude }
            );
        } else if (routePoint.address) {
            // Check for supplier stops
            const suppliers = ['Home Depot', 'Lowes', "Lowe's", 'Garden City Nursery', 'Walmart', 'Menards'];
            const isSupplier = suppliers.some(supplier => 
                routePoint.address!.toLowerCase().includes(supplier.toLowerCase())
            );
            
            if (isSupplier) {
                await smartAlertsService.createSupplierStopAlert(
                    vehicleId,
                    vehicleName,
                    routePoint.address,
                    { latitude: routePoint.latitude, longitude: routePoint.longitude }
                );
            }
        }
        
        // Clear active trip from vehicle state
        vehicleState.activeTrip = undefined;

        // Trip end - StateDeriver will handle canonical state updates
        console.log(`✅ Updated canonical state for ${vehicleName}: PARKED (trip ended)`);

        const centralStartTime = TimezoneUtils.toCentralTime(trip.ignitionOnTime);
        const centralEndTime = TimezoneUtils.toCentralTime(routePoint.timestamp);

        console.log(`\n🏁 TRIP COMPLETED`);
        console.log(`   Vehicle: ${vehicleName}`);
        console.log(`   Trip ID: ${trip._id}`);
        console.log(`   Started: ${centralStartTime.format('MM/DD/YYYY h:mm:ss A')} CT`);
        console.log(`   Ended: ${centralEndTime.format('MM/DD/YYYY h:mm:ss A')} CT`);
        console.log(`   Duration: ${runTime.toFixed(1)} minutes`);
        console.log(`   Distance: ${distanceTraveled.toFixed(1)} miles`);
        console.log(`   Start Location: ${trip.startLocation.address || 'Unknown'}`);
        console.log(`   End Location: ${routePoint.address || 'Unknown'}`);
        console.log(`   Battery Used: ${batteryUsed.toFixed(1)}%`);
        if (clientName) {
            console.log(`   Client: ${clientName}`);
        }
        console.log(`────────────────────────────────────────────────────────`);
    }
    
    private async updateActiveTrip(tripId: string, routePoint: RoutePoint): Promise<void> {
        // Limit route points to prevent memory overflow - only keep last 100 points per trip
        await this.tripsCollection.updateOne(
            { _id: tripId },
            {
                $push: {
                    routePoints: {
                        $each: [routePoint],
                        $slice: -100  // Keep only last 100 route points
                    }
                },
                $set: { lastUpdated: new Date() }
            }
        );
    }
    
    private async getClientNameForLocation(latitude: number, longitude: number): Promise<string | undefined> {
        // TODO: Implement Jobber integration to match locations with client addresses
        // For now, return undefined - this will be implemented when Jobber integration is ready
        
        // Placeholder logic for demonstration
        const address = await this.getAddressFromCoordinates(latitude, longitude);
        if (address) {
            // Simple pattern matching for demo purposes
            if (address.toLowerCase().includes('residential') || address.toLowerCase().includes('house')) {
                return 'Pending Jobber Integration';
            }
        }
        
        return undefined;
    }
    
    private async getAddressFromCoordinates(latitude: number, longitude: number, vehicleState?: string): Promise<string | undefined> {
        try {
            const { geocodingService } = await import('./geocoding');
            return await geocodingService.getAddress(latitude, longitude, vehicleState);
        } catch (error) {
            console.warn('Geocoding failed:', error);
            return undefined;
        }
    }
    
    /**
     * Get accurate trip distance - prefer Ford API data over GPS calculations
     */
    private async getAccurateTripDistance(trip: IgnitionTrip): Promise<number> {
        try {
            // Map vehicleId (UUID) to VIN for Ford API
            const uuidToVinMap = new Map([
                ['35658624-018d-4041-ab6b-fa396f06af16', '1FT6W1EV3PWG37779'], // Lightning 1
                ['810bd9c5-a531-4984-8e5b-c59ef8a4a47c', '1FTBW1XK6PKA30591'], // eTransit Van
                ['2dc0332a-d8fc-4ef8-b0e3-31ec20caeee0', '1FTVW1EV3NWG07402'], // Lightning XLT
                ['c0a4d743-eb5d-4dd8-8ce2-1216bf359bda', '1FTVW1EL3NWG00285']  // Lightning 2
            ]);

            const vehicleVin = uuidToVinMap.get(trip.vehicleId) || trip.vehicleId;

            // Try to get Ford's accurate trip distance
            const startTime = trip.ignitionOnTime.toISOString().substring(0, 19) + 'Z';
            const endTime = trip.ignitionOffTime?.toISOString().substring(0, 19) + 'Z' || new Date().toISOString().substring(0, 19) + 'Z';

            console.log(`🔍 Getting Ford API trip distance for ${trip.vehicleName} (VIN: ${vehicleVin}): ${startTime} to ${endTime}`);

            // Import Ford client dynamically like other parts of the code
            const { fordTelematicsClient } = await import('./fordTelematicsClient');
            const fordTrips = await fordTelematicsClient.instance.getVehicleTrips(vehicleVin, startTime, endTime, 10);

            // Find matching trip by comparing timestamps (within reasonable tolerance)
            const matchingTrip = fordTrips.find((fordTrip: any) => {
                const fordStartTime = new Date(fordTrip.startTime).getTime();
                const tripStartTime = trip.ignitionOnTime.getTime();
                const timeDifference = Math.abs(fordStartTime - tripStartTime);

                // Allow up to 5 minutes difference to account for API delays
                return timeDifference <= 5 * 60 * 1000;
            });

            if (matchingTrip && matchingTrip.tripDistance > 0) {
                // Convert Ford's kilometers to miles
                const distanceInMiles = matchingTrip.tripDistance * 0.621371;
                console.log(`✅ Using Ford API trip distance: ${distanceInMiles.toFixed(2)} miles (was GPS: ${this.calculateTripDistanceFromGPS(trip.routePoints).toFixed(2)} miles)`);
                return distanceInMiles;
            }
        } catch (error) {
            console.warn(`⚠️ Failed to get Ford API trip distance, falling back to GPS calculation:`, error);
        }

        // Fallback to GPS calculation only when Ford API data unavailable
        console.log(`📡 Ford API trip data unavailable, using GPS calculation as fallback`);
        return this.calculateTripDistanceFromGPS(trip.routePoints);
    }

    /**
     * Calculate trip distance from GPS coordinates (fallback only)
     * This method accumulates GPS errors and should only be used when Ford API data is unavailable
     */
    private calculateTripDistanceFromGPS(routePoints: RoutePoint[]): number {
        if (routePoints.length < 2) return 0;

        let totalDistance = 0;
        let filteredSegments = 0;

        for (let i = 1; i < routePoints.length; i++) {
            const distance = this.calculateDistance(
                routePoints[i - 1].latitude,
                routePoints[i - 1].longitude,
                routePoints[i].latitude,
                routePoints[i].longitude
            );

            // Filter out GPS noise - only count meaningful movement
            if (distance >= this.GPS_ACCURACY_BUFFER) {
                totalDistance += distance;
            } else {
                filteredSegments++;
            }
        }

        if (filteredSegments > 0) {
            console.log(`🗂️ Filtered ${filteredSegments} GPS noise segments from GPS fallback calculation`);
        }

        // Convert meters to miles
        const distanceInMiles = totalDistance * 0.000621371;
        console.log(`⚠️ GPS fallback distance calculation: ${distanceInMiles.toFixed(2)} miles (may have ~${((distanceInMiles * 0.4) || 2).toFixed(1)} mile GPS error accumulation)`);
        return distanceInMiles;
    }
    
    // Haversine formula for distance calculation in meters
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
     * Check if vehicle has exited McRay Shop geofence and insert departure marker
     * This ensures trips starting from the shop are captured even if isMoving isn't detected immediately
     */
    private async checkMcRayGeofenceExit(
        vehicleId: string,
        currentLocation: { latitude: number; longitude: number },
        vehicleName: string,
        routePoint: RoutePoint
    ): Promise<void> {
        try {
            // Calculate distance from McRay Shop
            const distanceFromMcRay = this.calculateDistance(
                this.MCRAY_SHOP_GEOFENCE.latitude,
                this.MCRAY_SHOP_GEOFENCE.longitude,
                currentLocation.latitude,
                currentLocation.longitude
            );

            const isInsideGeofence = distanceFromMcRay <= this.MCRAY_SHOP_GEOFENCE.radius;
            const wasInsideGeofence = this.vehiclesInMcRayGeofence.get(vehicleId) || false;

            // Update geofence status
            this.vehiclesInMcRayGeofence.set(vehicleId, isInsideGeofence);

            // Detect geofence exit - vehicle WAS inside, now is OUTSIDE
            if (wasInsideGeofence && !isInsideGeofence) {
                console.log(`🚀 GEOFENCE EXIT: ${vehicleName} has left McRay Shop (${distanceFromMcRay.toFixed(1)}m away)`);
                console.log(`   Creating departure marker to ensure trip is captured from McRay Shop`);

                // Insert a "departure marker" route point at McRay Shop with isMoving: true
                // This ensures the trip detection logic will start the trip from McRay Shop
                const departureMarker: RoutePoint = {
                    vehicleId,
                    timestamp: new Date(routePoint.timestamp.getTime() - 1000), // 1 second before current point
                    latitude: this.MCRAY_SHOP_GEOFENCE.latitude,
                    longitude: this.MCRAY_SHOP_GEOFENCE.longitude,
                    batteryLevel: routePoint.batteryLevel,
                    ignitionStatus: 'On', // Vehicle must be on to exit geofence
                    address: 'McRay Shop',
                    isMoving: true, // CRITICAL: Mark as moving to trigger trip start
                    dataSource: 'geofence-departure'
                };

                await this.routePointsCollection.insertOne(departureMarker);
                console.log(`✅ Inserted departure marker at McRay Shop for ${vehicleName}`);
            }
        } catch (error) {
            console.error(`❌ Error checking McRay geofence for ${vehicleId}:`, error);
        }
    }

    /**
     * Intelligent route point storage optimized for data conservation
     * Priority: Only store coordinates during active trips to conserve database usage
     * Exception: Always store ignition changes for trip reconstruction
     */
    private async shouldStoreRoutePoint(vehicleId: string, routePoint: RoutePoint): Promise<boolean> {
        try {
            // ALWAYS store ignition state changes regardless of trip status
            // This is essential for trip start/end detection and reconstruction
            const previousState = this.vehicleStates.get(vehicleId);
            if (!previousState || previousState.lastIgnitionStatus !== routePoint.ignitionStatus) {
                console.log(`📍 Storing route point for ${vehicleId}: ignition change (${routePoint.ignitionStatus})`);
                return true;
            }

            // DATA CONSERVATION: Only store detailed route tracking during active trips
            // This significantly reduces database usage during parking periods
            const ignitionStatus = routePoint.ignitionStatus?.toUpperCase() || 'OFF';
            const isVehicleOnTrip = ignitionStatus === 'ON' || ignitionStatus === 'RUN';

            if (!isVehicleOnTrip) {
                // Vehicle is parked/off - only store ignition changes (already handled above)
                // Skip routine coordinate updates during parking to conserve data
                console.log(`📍 Skipping route point for ${vehicleId}: vehicle parked (data conservation)`);
                return false;
            }

            console.log(`📍 Vehicle ${vehicleId} is on trip - processing route tracking logic`);

            // ACTIVE TRIP: Apply detailed route tracking logic
            // Get last stored route point
            const lastStored = await this.routePointsCollection
                .findOne({ vehicleId }, { sort: { timestamp: -1 } });

            if (!lastStored) {
                console.log(`📍 Storing route point for ${vehicleId}: first trip point`);
                return true;
            }

            // During active trips, store points more frequently for accurate route visualization
            // Reduce time threshold from 5 minutes to 1 minute during trips
            const timeSinceLastStore = routePoint.timestamp.getTime() - lastStored.timestamp.getTime();
            const timeThreshold = 1 * 60 * 1000; // 1 minute for active trips

            if (timeSinceLastStore > timeThreshold) {
                console.log(`📍 Storing route point for ${vehicleId}: ${Math.round(timeSinceLastStore/60000)}+ minutes during trip`);
                return true;
            }

            // Store points for significant movement during trips (reduced threshold for better route tracking)
            const distance = this.calculateDistance(
                lastStored.latitude,
                lastStored.longitude,
                routePoint.latitude,
                routePoint.longitude
            );

            // Reduce distance threshold from 50m to 25m during active trips for better route detail
            const movementThreshold = 25; // meters
            if (distance > movementThreshold) {
                console.log(`📍 Storing route point for ${vehicleId}: moved ${distance.toFixed(1)}m during trip`);
                return true;
            }

            // Skip storage - no significant change during trip
            return false;

        } catch (error) {
            console.warn(`⚠️ Error checking route point storage for ${vehicleId}:`, error);
            return true; // Store on error to be safe
        }
    }
    
    // Public API methods
    
    public async getIgnitionTrips(vehicleId?: string, limit: number = 50): Promise<IgnitionTrip[]> {
        const query = vehicleId ? { vehicleId } : {};
        return this.tripsCollection
            .find(query)
            .sort({ ignitionOnTime: -1 })
            .limit(limit)
            .toArray();
    }
    
    public async getActiveTrips(): Promise<IgnitionTrip[]> {
        return this.tripsCollection.find({ isActive: true }).toArray();
    }
    
    public async getVehicleStats(vehicleId: string, days: number = 30): Promise<any> {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        
        const trips = await this.tripsCollection.find({
            vehicleId,
            ignitionOnTime: { $gte: startDate },
            isActive: false
        }).toArray();
        
        if (trips.length === 0) {
            return {
                totalTrips: 0,
                totalRunTime: 0,
                totalDistance: 0,
                totalBatteryUsed: 0,
                avgTripDistance: 0,
                avgTripDuration: 0
            };
        }
        
        const totalRunTime = trips.reduce((sum, trip) => sum + (trip.totalRunTime || 0), 0);
        const totalDistance = trips.reduce((sum, trip) => sum + (trip.distanceTraveled || 0), 0);
        const totalBatteryUsed = trips.reduce((sum, trip) => sum + (trip.batteryUsed || 0), 0);
        
        return {
            totalTrips: trips.length,
            totalRunTime: Math.round(totalRunTime),
            totalDistance: Math.round(totalDistance * 10) / 10,
            totalBatteryUsed: Math.round(totalBatteryUsed * 10) / 10,
            avgTripDistance: Math.round((totalDistance / trips.length) * 10) / 10,
            avgTripDuration: Math.round(totalRunTime / trips.length)
        };
    }
    
    /**
     * Get real-time parking status based on the most recent ignition trip
     * This replaces the stale MongoDB parking sessions with accurate data
     */
    public async getRealTimeParkingStatus(vehicleIdOrVin: string): Promise<{ isParked: boolean; duration: string; lastIgnitionOffTime?: Date }> {
        try {
            console.log(`🔍 getRealTimeParkingStatus called with: ${vehicleIdOrVin}`);
            
            // Handle both VIN and UUID - convert VIN to UUID if needed
            const vinToUuidMap: Map<string, string> = new Map([
                ['1FT6W1EV3PWG37779', '35658624-018d-4041-ab6b-fa396f06af16'], // Lightning 1
                ['1FTBW1XK6PKA30591', '810bd9c5-a531-4984-8e5b-c59ef8a4a47c'], // eTransit Van
                ['1FTVW1EV3NWG07402', '2dc0332a-d8fc-4ef8-b0e3-31ec20caeee0'], // Lightning XLT
                ['1FTVW1EL3NWG00285', 'c0a4d743-eb5d-4dd8-8ce2-1216bf359bda']  // Lightning 2
            ]);

            // If the input looks like a VIN (17 characters), convert it to UUID
            const vehicleId = vehicleIdOrVin.length === 17 ? 
                (vinToUuidMap.get(vehicleIdOrVin) || vehicleIdOrVin) : 
                vehicleIdOrVin;
            
            console.log(`🔍 Converted to vehicleId: ${vehicleId}`);

            // Get the most recent trip for this vehicle
            const recentTrips = await this.tripsCollection
                .find({ vehicleId })
                .sort({ ignitionOnTime: -1 })
                .limit(2)
                .toArray();
            
            console.log(`🔍 Found ${recentTrips.length} recent trips for vehicle ${vehicleId}`);
            
            // Check if we have recent trip data
            if (recentTrips.length > 0) {
                const mostRecentTrip = recentTrips[0];
                console.log(`🔍 Most recent trip:`, {
                    id: mostRecentTrip._id,
                    isActive: mostRecentTrip.isActive,
                    ignitionOnTime: mostRecentTrip.ignitionOnTime,
                    ignitionOffTime: mostRecentTrip.ignitionOffTime,
                    vehicleId: mostRecentTrip.vehicleId,
                    totalTrips: recentTrips.length
                });
                console.log(`🔍 All recent trips:`, recentTrips.map(trip => ({
                    id: trip._id?.toString().slice(-6),
                    isActive: trip.isActive,
                    ignitionOn: trip.ignitionOnTime,
                    ignitionOff: trip.ignitionOffTime
                })));
                
                // If the most recent trip is still active, cross-check with Ford Telematics to verify
                if (mostRecentTrip.isActive) {
                    console.log(`🔍 Trip marked as active, cross-checking with Ford Telematics`);
                    
                    // Get real-time ignition status from Ford Telematics
                    try {
                        const { fordTelematicsClient } = await import('./fordTelematicsClient');
                        const uuidToVinMap = new Map([
                            ['35658624-018d-4041-ab6b-fa396f06af16', '1FT6W1EV3PWG37779'], // Lightning 1
                            ['810bd9c5-a531-4984-8e5b-c59ef8a4a47c', '1FTBW1XK6PKA30591'], // eTransit Van
                            ['2dc0332a-d8fc-4ef8-b0e3-31ec20caeee0', '1FTVW1EV3NWG07402'], // Lightning XLT
                            ['c0a4d743-eb5d-4dd8-8ce2-1216bf359bda', '1FTVW1EL3NWG00285']  // Lightning 2
                        ]);
                        const vinForTelematics = vehicleIdOrVin.length === 17 ? 
                            vehicleIdOrVin : 
                            (uuidToVinMap.get(vehicleId) || vehicleId);
                        
                        const vehicleData = await fordTelematicsClient.instance.getVehicleStatus(vinForTelematics);
                        
                        if (vehicleData && vehicleData.signals && vehicleData.signals.ignition_status) {
                            const ignitionSignal = vehicleData.signals.ignition_status;
                            console.log(`🔍 Ford Telematics ignition status: ${ignitionSignal.value}, timestamp: ${ignitionSignal.timestamp}`);
                            
                            if (ignitionSignal.value === 'OFF' && ignitionSignal.timestamp) {
                                // Vehicle is actually parked - MongoDB data is stale
                                const now = new Date();
                                const ignitionOffTime = new Date(ignitionSignal.timestamp);
                                const parkingDuration = now.getTime() - ignitionOffTime.getTime();
                                
                                console.log(`🔍 Parking duration check: ${parkingDuration}ms (${parkingDuration / 1000 / 60}min) > ${2 * 60 * 1000}ms threshold`);
                                
                                // Only consider it parked if it's been off for more than 2 minutes
                                if (parkingDuration > 2 * 60 * 1000) {
                                    const duration = this.formatDuration(parkingDuration);
                                    console.log(`🔍 ✅ Ford Telematics shows vehicle PARKED, duration: ${duration} - RETURNING PARKED STATUS`);
                                    
                                    return {
                                        isParked: true,
                                        duration,
                                        lastIgnitionOffTime: ignitionOffTime
                                    };
                                } else {
                                    console.log(`🔍 ❌ Ford Telematics: ignition off but duration too short (${parkingDuration / 1000 / 60}min < 2min)`);
                                }
                            } else if (ignitionSignal.value === 'ON') {
                                console.log(`🔍 Ford Telematics confirms vehicle is active`);
                                return { isParked: false, duration: '0m' };
                            }
                        }
                    } catch (error) {
                        console.log(`🔍 Ford Telematics cross-check failed: ${error instanceof Error ? error.message : error}`);
                        // Fall back to MongoDB data if Ford Telematics fails
                    }
                    
                    console.log(`🔍 Using MongoDB data: vehicle is active, returning not parked`);
                    return { isParked: false, duration: '0m' };
                }
                
                // If we have an ignitionOffTime, calculate parking duration from that
                if (mostRecentTrip.ignitionOffTime) {
                    const now = new Date();
                    const parkingDuration = now.getTime() - mostRecentTrip.ignitionOffTime.getTime();
                    
                    // Format duration as human-readable
                    const duration = this.formatDuration(parkingDuration);
                    
                    console.log(`🔍 Found ignitionOffTime, parking duration: ${duration}`);
                    return {
                        isParked: true,
                        duration,
                        lastIgnitionOffTime: mostRecentTrip.ignitionOffTime
                    };
                } else {
                    console.log(`🔍 No ignitionOffTime found in most recent trip, trying Ford Telematics fallback`);
                    // Also try Ford Telematics fallback when MongoDB has incomplete data
                }
            } else {
                console.log(`🔍 No recent trips found, will try Ford Telematics fallback`);
            }
            
            // Fallback: Use Ford Telematics data directly
            // This handles cases where vehicles have been parked for days without trip data
            console.log(`🔍 No recent trips or ignition data - falling back to Ford Telematics`);
            try {
                const { fordTelematicsClient } = await import('./fordTelematicsClient');
                // Ford Telematics needs VIN, so convert UUID back to VIN if needed
                const uuidToVinMap = new Map([
                    ['35658624-018d-4041-ab6b-fa396f06af16', '1FT6W1EV3PWG37779'], // Lightning 1
                    ['810bd9c5-a531-4984-8e5b-c59ef8a4a47c', '1FTBW1XK6PKA30591'], // eTransit Van
                    ['2dc0332a-d8fc-4ef8-b0e3-31ec20caeee0', '1FTVW1EV3NWG07402'], // Lightning XLT
                    ['c0a4d743-eb5d-4dd8-8ce2-1216bf359bda', '1FTVW1EL3NWG00285']  // Lightning 2
                ]);
                const vinForTelematics = vehicleIdOrVin.length === 17 ? 
                    vehicleIdOrVin : 
                    (uuidToVinMap.get(vehicleId) || vehicleId);
                
                console.log(`🔍 Calling Ford Telematics with VIN: ${vinForTelematics}`);
                const vehicleData = await fordTelematicsClient.instance.getVehicleStatus(vinForTelematics);
                console.log(`🔍 Ford Telematics response:`, JSON.stringify(vehicleData, null, 2));
                
                // Check for ignition status in signals
                if (vehicleData && vehicleData.signals && vehicleData.signals.ignition_status) {
                    const ignitionSignal = vehicleData.signals.ignition_status;
                    console.log(`🔍 Ignition signal:`, ignitionSignal);
                    if (ignitionSignal.value === 'OFF' && ignitionSignal.timestamp) {
                        const now = new Date();
                        const ignitionOffTime = new Date(ignitionSignal.timestamp);
                        console.log(`🔍 Vehicle is parked since: ${ignitionOffTime.toISOString()}`);
                        const parkingDuration = now.getTime() - ignitionOffTime.getTime();
                        
                        // Only consider it parked if it's been off for more than 2 minutes (to avoid transient states)
                        if (parkingDuration > 2 * 60 * 1000) {
                            const duration = this.formatDuration(parkingDuration);
                            
                            return {
                                isParked: true,
                                duration,
                                lastIgnitionOffTime: ignitionOffTime
                            };
                        }
                    }
                }
            } catch (error) {
                console.log('Could not fetch Ford Telematics data for parking calculation:', (error as Error).message);
            }
            
            // Final fallback: not parked
            return { isParked: false, duration: '0m' };
            
        } catch (error) {
            console.error('Error getting real-time parking status:', error);
            return { isParked: false, duration: '0m' };
        }
    }
    
    /**
     * Get parking status using movement-based detection with real-time Ford Telematics data
     * Only resets parking when vehicle moves significantly (>0.5 miles from parking location)
     * Ignition cycles without movement are considered normal parking behavior
     */
    public async getSimpleParkingStatus(vin: string): Promise<{ isParked: boolean; duration: string; lastIgnitionOffTime?: Date }> {
        try {
            console.log(`🔍 getSimpleParkingStatus called with VIN: ${vin}`);
            
            // Get cached vehicle state from the monitoring service (updated every 1.5 seconds)
            const vehicleState = this.vehicleStates.get(vin);
            if (!vehicleState) {
                console.log(`🔍 ❌ No cached monitoring data found for VIN: ${vin}`);
                return { isParked: false, duration: '0m' };
            }
            
            console.log(`🔍 Current ignition: ${vehicleState.lastIgnitionStatus}, location: ${vehicleState.lastLocation?.latitude}, ${vehicleState.lastLocation?.longitude}`);
            
            // Check if ignition is currently ON - if so, not parked
            if (vehicleState.lastIgnitionStatus === 'On') {
                console.log(`🔍 ✅ Vehicle is ACTIVE (ignition ON) - not parked`);
                return { isParked: false, duration: '0m' };
            }
            
            // Vehicle ignition is OFF - check if we have a parking session or need to create one
            if (vehicleState.lastIgnitionStatus === 'Off') {
                
                // Try to find the most recent parking session from database to get the original parking location and time
                try {
                    const { parkingDetectionService } = await import('./parkingDetectionService');
                    
                    // Get the most recent parking session for this vehicle
                    const recentSessions = await parkingDetectionService.getParkingSessions(vin, 1);
                    let parkingStartLocation = null;
                    let parkingStartTime = null;
                    
                    if (recentSessions.length > 0 && recentSessions[0].isCurrentlyParked) {
                        const session = recentSessions[0];
                        parkingStartLocation = session.parkingLocation;
                        parkingStartTime = session.parkingStartTime;
                        console.log(`🔍 Found active parking session started at: ${parkingStartTime?.toISOString()}`);
                        console.log(`🔍 Original parking location: ${parkingStartLocation.latitude}, ${parkingStartLocation.longitude}`);
                        
                        // Check if vehicle has moved significantly from parking location  
                        if (vehicleState.lastLocation?.latitude && vehicleState.lastLocation?.longitude) {
                            const distanceFromParkingSpot = this.calculateDistance(
                                parkingStartLocation.latitude,
                                parkingStartLocation.longitude,
                                vehicleState.lastLocation.latitude,
                                vehicleState.lastLocation.longitude
                            );
                            
                            const TRIP_THRESHOLD_METERS = 804.67; // 0.5 miles
                            
                            console.log(`🔍 Distance from parking spot: ${distanceFromParkingSpot.toFixed(1)}m (threshold: ${TRIP_THRESHOLD_METERS}m)`);
                            
                            if (distanceFromParkingSpot > TRIP_THRESHOLD_METERS) {
                                console.log(`🔍 ✅ Vehicle MOVED significantly (${(distanceFromParkingSpot/1000).toFixed(2)}km) from old parking spot`);
                                console.log(`🔍 🔧 ENHANCED: Attempting to calculate parking duration for new location`);
                                console.log(`🔍 🔧 ENHANCED: vehicleState.lastUpdate = ${vehicleState.lastUpdate ? vehicleState.lastUpdate.toISOString() : 'NULL'}`);
                                
                                // Vehicle moved to new location - calculate duration from recent ignition OFF
                                // Use the most recent data available to determine parking duration
                                let calculatedDuration = '0m';
                                let ignitionOffTime: Date | null = null;
                                
                                // Try to use cached lastUpdate time (when ignition status changed to OFF)
                                if (vehicleState.lastUpdate) {
                                    console.log(`🔍 🔧 ENHANCED: Found cached lastUpdate time, checking grace period...`);
                                    const now = new Date();
                                    const timeSinceUpdate = now.getTime() - vehicleState.lastUpdate.getTime();
                                    
                                    // Only consider parked if been off for more than 2 minutes (grace period)
                                    if (timeSinceUpdate > 2 * 60 * 1000) {
                                        calculatedDuration = this.formatDuration(timeSinceUpdate);
                                        ignitionOffTime = vehicleState.lastUpdate;
                                        console.log(`🔍 ✅ New parking location - duration from cached data: ${calculatedDuration}`);
                                        return {
                                            isParked: true,
                                            duration: calculatedDuration,
                                            lastIgnitionOffTime: ignitionOffTime
                                        };
                                    } else {
                                        console.log(`🔍 ❌ Recent ignition off (${(timeSinceUpdate / 1000 / 60).toFixed(1)}min < 2min grace)`);
                                        return { isParked: false, duration: '0m' };
                                    }
                                }
                                
                                // Fallback to Ford Telematics for ignition OFF time
                                try {
                                    console.log(`🔍 🔧 ENHANCED: Fallback to Ford Telematics for ignition OFF time`);
                                    console.log(`🔍 ⚠️ No cached ignition off time - using Ford Telematics for new location`);
                                    const { fordTelematicsClient } = await import('./fordTelematicsClient');
                                    const fordData = await fordTelematicsClient.instance.getVehicleStatus(vin, ['ignition_status']);
                                    
                                    if (fordData?.signals?.ignition_status?.timestamp && fordData.signals.ignition_status.value === 'OFF') {
                                        ignitionOffTime = new Date(fordData.signals.ignition_status.timestamp);
                                        const now = new Date();
                                        const parkingDuration = now.getTime() - ignitionOffTime.getTime();
                                        
                                        if (parkingDuration > 2 * 60 * 1000) {
                                            calculatedDuration = this.formatDuration(parkingDuration);
                                            console.log(`🔍 ✅ New parking location - duration from Ford: ${calculatedDuration}`);
                                            return {
                                                isParked: true,
                                                duration: calculatedDuration,
                                                lastIgnitionOffTime: ignitionOffTime
                                            };
                                        }
                                    }
                                } catch (error) {
                                    console.error(`🔍 ❌ Error fetching Ford Telematics for new location:`, error);
                                }
                                
                                // No valid ignition OFF time found
                                console.log(`🔍 ❌ Unable to determine parking duration at new location`);
                                return { isParked: false, duration: '0m' };
                            }
                        } else {
                            // No GPS location data available - use fallback approach
                            console.log(`🔍 ⚠️ No GPS location data available for ${vin} - using ignition-based fallback`);
                            console.log(`🔍 🔧 FALLBACK: Vehicle has active parking session but no GPS data`);
                            
                            // Since we can't check movement, calculate duration from parking session start
                            const now = new Date();
                            const parkingDuration = now.getTime() - parkingStartTime.getTime();
                            const duration = this.formatDuration(parkingDuration);
                            
                            console.log(`🔍 ✅ FALLBACK: Vehicle assumed PARKED (no GPS data), duration: ${duration}`);
                            return {
                                isParked: true,
                                duration,
                                lastIgnitionOffTime: parkingStartTime
                            };
                        }
                        
                        // Vehicle is still at parking location - calculate duration (shouldn't reach here)
                        const now = new Date();
                        const parkingDuration = now.getTime() - parkingStartTime.getTime();
                        const duration = this.formatDuration(parkingDuration);
                        
                        console.log(`🔍 ✅ Vehicle still PARKED at original location, duration: ${duration}`);
                        return {
                            isParked: true,
                            duration,
                            lastIgnitionOffTime: parkingStartTime
                        };
                    }
                    
                    // No active parking session found - use last update time as rough parking start (ignition status changed to OFF)  
                    if (vehicleState.lastUpdate) {
                        const now = new Date();
                        const approximateParkingDuration = now.getTime() - vehicleState.lastUpdate.getTime();
                        
                        // Only consider parked if been off for more than 2 minutes (grace period)
                        if (approximateParkingDuration > 2 * 60 * 1000) {
                            const duration = this.formatDuration(approximateParkingDuration);
                            console.log(`🔍 ✅ Vehicle PARKED (approximate duration based on status change: ${duration})`);
                            return {
                                isParked: true,
                                duration,
                                lastIgnitionOffTime: vehicleState.lastUpdate
                            };
                        } else {
                            console.log(`🔍 ❌ Ignition recently turned off (${(approximateParkingDuration / 1000 / 60).toFixed(1)}min < 2min grace period)`);
                            return { isParked: false, duration: '0m' };
                        }
                    }
                    
                    // No ignition off time available - fallback to Ford Telematics
                    console.log(`🔍 ⚠️ No cached ignition off time - using Ford Telematics fallback`);
                    const { fordTelematicsClient } = await import('./fordTelematicsClient');
                    const fordData = await fordTelematicsClient.instance.getVehicleStatus(vin, ['ignition_status']);
                    
                    if (fordData?.signals?.ignition_status?.timestamp && fordData.signals.ignition_status.value === 'OFF') {
                        const ignitionOffTime = new Date(fordData.signals.ignition_status.timestamp);
                        const now = new Date();
                        const parkingDuration = now.getTime() - ignitionOffTime.getTime();
                        
                        if (parkingDuration > 2 * 60 * 1000) {
                            const duration = this.formatDuration(parkingDuration);
                            console.log(`🔍 ✅ Ford Telematics: Vehicle PARKED for ${duration}`);
                            return {
                                isParked: true,
                                duration,
                                lastIgnitionOffTime: ignitionOffTime
                            };
                        }
                    }
                    
                } catch (error) {
                    console.error(`🔍 ❌ Error in parking session lookup:`, error);
                }
                
                console.log(`🔍 ❌ Unable to determine parking status for ignition OFF vehicle`);
                return { isParked: false, duration: '0m' };
            } else {
                console.log(`🔍 ❌ Unknown ignition status: ${vehicleState.lastIgnitionStatus}`);
                return { isParked: false, duration: '0m' };
            }
            
        } catch (error) {
            console.error('🔍 ❌ Error getting movement-based parking status:', error);
            return { isParked: false, duration: '0m' };
        }
    }

    /**
     * Database-based parking duration calculation (resilient to API failures)
     * Uses route points and ignition trip data as primary source
     */
    private async getTelemticsBasedIgnitionOff(vin: string): Promise<{ ignitionOffTime: Date | null; source: string }> {
        try {
            console.log(`📡 Analyzing telematics signals for ignition transitions: ${vin}`);

            // Look back 7 days for ignition transitions
            const lookbackDays = 7;
            const searchStart = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

            const signals = await this.db.collection('telematics_signals').find({
                vin: vin,
                ts: { $gte: searchStart.toISOString() }
            }).sort({ ts: 1 }).toArray();

            if (signals.length === 0) {
                console.log(`📡 No telematics signals found for ${vin} in last ${lookbackDays} days`);
                return { ignitionOffTime: null, source: 'no-telematics-data' };
            }

            // Find ignition transitions: On → Off
            let lastIgnition = null;
            let mostRecentIgnitionOff: Date | null = null;

            for (const signal of signals) {
                if (lastIgnition === 'On' && signal.ignition === 'Off') {
                    // Found an On → Off transition
                    mostRecentIgnitionOff = new Date(signal.ts);
                    console.log(`📡 Found ignition Off transition at ${signal.ts} for ${vin}`);
                }
                lastIgnition = signal.ignition;
            }

            if (mostRecentIgnitionOff) {
                console.log(`📡 ✅ Most recent ignition Off for ${vin}: ${mostRecentIgnitionOff.toISOString()}`);
                return { ignitionOffTime: mostRecentIgnitionOff, source: 'telematics-transition' };
            } else {
                // Check if vehicle has been consistently Off
                const allOffSignals = signals.filter(s => s.ignition === 'Off');
                if (allOffSignals.length > 0) {
                    // Use the earliest Off signal as proxy for when parking started
                    const earliestOff = new Date(allOffSignals[0].ts);
                    console.log(`📡 ⚠️ No On→Off transition found for ${vin}, using earliest Off signal: ${earliestOff.toISOString()}`);
                    return { ignitionOffTime: earliestOff, source: 'telematics-earliest-off' };
                }

                console.log(`📡 ❌ No usable ignition data found for ${vin}`);
                return { ignitionOffTime: null, source: 'no-ignition-data' };
            }
        } catch (error) {
            console.error(`📡 Error analyzing telematics signals for ${vin}:`, error);
            return { ignitionOffTime: null, source: 'telematics-error' };
        }
    }

    public async getDatabaseParkingStatus(vin: string): Promise<{ isParked: boolean; duration: string; lastIgnitionOffTime?: Date; source: string }> {
        try {
            console.log(`🗃️ Getting database-based parking status for ${vin}`);

            // PRIMARY STRATEGY: Direct telematics signal analysis for accurate ignition off detection
            const telematicsResult = await this.getTelemticsBasedIgnitionOff(vin);

            if (telematicsResult.ignitionOffTime) {
                const now = new Date();
                const parkingDurationMs = now.getTime() - telematicsResult.ignitionOffTime.getTime();
                const durationStr = this.formatDuration(parkingDurationMs);

                console.log(`🗃️ ✅ Telematics-based parking duration for ${vin}: ${durationStr} since ${telematicsResult.ignitionOffTime.toISOString()}`);
                return {
                    isParked: true,
                    duration: durationStr,
                    lastIgnitionOffTime: telematicsResult.ignitionOffTime,
                    source: `database-${telematicsResult.source}`
                };
            }

            // FALLBACK STRATEGY: Traditional ignition trip analysis
            console.log(`🗃️ Telematics analysis failed for ${vin}, falling back to trip data`);
            const recentTrip = await this.tripsCollection
                .findOne(
                    { vehicleId: vin },
                    { sort: { ignitionOnTime: -1 } }
                );

            if (!recentTrip) {
                console.log(`🗃️ No trips found for ${vin}`);
                return { isParked: false, duration: '0m', source: 'database-no-data' };
            }
            
            console.log(`🗃️ Found recent trip for ${vin}: active=${recentTrip.isActive}, ignitionOnTime=${recentTrip.ignitionOnTime.toISOString()}`);
            
            // Cross-check database trip status with real-time ignition data
            if (recentTrip.isActive) {
                // Before trusting database trip status, verify with real-time ignition
                const vehicleState = this.vehicleStates.get(vin);
                const currentIgnition = vehicleState?.lastIgnitionStatus;

                if (currentIgnition === 'On') {
                    // Database and real-time agree: vehicle is on trip
                    console.log(`🗃️ Vehicle ${vin} has active trip confirmed by real-time ignition - not parked`);
                    return { isParked: false, duration: '0m', source: 'database-active-trip' };
                } else {
                    // Database says active but ignition is OFF - database is stale
                    console.warn(`🗃️ ⚠️ Database shows active trip for ${vin} but ignition is ${currentIgnition}. Database is stale - treating as parked.`);
                    // Continue to parking duration calculation since vehicle is actually parked
                }
            }
            
            // Find most recent route point to get last ignition OFF time
            const lastRoutePoint = await this.routePointsCollection
                .findOne(
                    { vehicleId: vin },
                    { sort: { timestamp: -1 } }
                );
                
            if (!lastRoutePoint) {
                console.log(`🗃️ No route points found for ${vin}`);
                return { isParked: false, duration: '0m', source: 'database-no-route-data' };
            }
            
            console.log(`🗃️ Latest route point for ${vin}: ignition=${lastRoutePoint.ignitionStatus}, timestamp=${lastRoutePoint.timestamp.toISOString()}`);
            
            // If last known ignition status is ON, vehicle is likely not parked
            if (lastRoutePoint.ignitionStatus?.toUpperCase() === 'ON') {
                console.log(`🗃️ Last known ignition status is ON for ${vin} - not parked`);
                return { isParked: false, duration: '0m', source: 'database-ignition-on' };
            }
            
            // Calculate parking duration from last ignition OFF time
            const now = new Date();
            const timeSinceLastOff = now.getTime() - lastRoutePoint.timestamp.getTime();
            const gracePeriod = 2 * 60 * 1000; // 2 minutes
            
            if (timeSinceLastOff < gracePeriod) {
                console.log(`🗃️ Recent ignition OFF for ${vin} (${Math.round(timeSinceLastOff / 1000 / 60)}m < 2m grace) - not parked yet`);
                return { isParked: false, duration: '0m', source: 'database-grace-period' };
            }
            
            const duration = this.formatDuration(timeSinceLastOff);
            console.log(`🗃️ ✅ Database parking duration for ${vin}: ${duration}`);
            
            return {
                isParked: true,
                duration,
                lastIgnitionOffTime: lastRoutePoint.timestamp,
                source: 'database-route-points'
            };
            
        } catch (error) {
            console.error(`🗃️ ❌ Database parking calculation failed for ${vin}:`, error);
            return { isParked: false, duration: '0m', source: 'database-error' };
        }
    }
    
    /**
     * Enhanced parking status with multiple fallback strategies
     * Priority: Real-time API -> Database routes -> Parking sessions -> Cached state
     */
    public async getResilientParkingStatus(vin: string): Promise<{ isParked: boolean; duration: string; lastIgnitionOffTime?: Date; source: string }> {
        console.log(`🔒 Getting resilient parking status for ${vin}`);
        
        // Strategy 1: Try real-time API first (for map markers)
        try {
            const realtimeResult = await this.getSimpleParkingStatus(vin);
            if (realtimeResult.isParked) {
                console.log(`🔒 ✅ Real-time API successful for ${vin}: ${realtimeResult.duration}`);
                return {
                    ...realtimeResult,
                    source: 'real-time-api'
                };
            }
        } catch (error) {
            console.log(`🔒 ⚠️ Real-time API failed for ${vin}, falling back to database`);
        }
        
        // Strategy 2: Database-based calculation (most reliable)
        const dbResult = await this.getDatabaseParkingStatus(vin);
        if (dbResult.isParked) {
            console.log(`🔒 ✅ Database calculation successful for ${vin}: ${dbResult.duration}`);
            return dbResult;
        }
        
        // Strategy 3: Check parking sessions (fallback) with stale data detection
        try {
            const { parkingDetectionService } = await import('./parkingDetectionService');
            const recentSessions = await parkingDetectionService.getParkingSessions(vin, 1);

            if (recentSessions.length > 0 && recentSessions[0].isCurrentlyParked) {
                const session = recentSessions[0];
                const now = new Date();
                const parkingDuration = now.getTime() - session.parkingStartTime.getTime();

                // Detect stale data: If parking duration is > 4 hours, likely stale
                // Force refresh with current vehicle state for more accurate timing
                if (parkingDuration > 4 * 60 * 60 * 1000) { // 4 hours in milliseconds
                    console.log(`🔒 ⚠️ Parking session for ${vin} seems stale (${this.formatDuration(parkingDuration)}), checking vehicle state`);

                    const vehicleState = this.vehicleStates.get(vin);
                    if (vehicleState && vehicleState.lastIgnitionStatus === 'Off' && vehicleState.lastUpdate) {
                        // Use vehicle state timing for fresher data
                        const fresherDuration = now.getTime() - vehicleState.lastUpdate.getTime();
                        const fresherDurationStr = this.formatDuration(fresherDuration);

                        console.log(`🔒 ✅ Using fresher vehicle state for ${vin}: ${fresherDurationStr} (vs stale ${this.formatDuration(parkingDuration)})`);
                        return {
                            isParked: true,
                            duration: fresherDurationStr,
                            lastIgnitionOffTime: vehicleState.lastUpdate,
                            source: 'parking-sessions-corrected'
                        };
                    }
                }

                const duration = this.formatDuration(parkingDuration);
                console.log(`🔒 ✅ Parking session fallback for ${vin}: ${duration}`);
                return {
                    isParked: true,
                    duration,
                    lastIgnitionOffTime: session.ignitionOffTime,
                    source: 'parking-sessions'
                };
            }
        } catch (error) {
            console.log(`🔒 ⚠️ Parking session fallback failed for ${vin}`);
        }
        
        // Strategy 4: Return best available result
        console.log(`🔒 ❌ All strategies failed for ${vin}, returning: ${dbResult.source}`);
        return dbResult;
    }

    /**
     * Get trip status with duration for ON TRIP vehicles
     * Mirrors parking status logic but for active trips
     */
    public async getResilientTripStatus(vin: string): Promise<{ isOnTrip: boolean; duration: string; lastIgnitionOnTime?: Date; source: string }> {
        console.log(`🚗 Getting resilient trip status for ${vin}`);

        // Get current vehicle state first
        const vehicleState = this.vehicleStates.get(vin);

        if (!vehicleState) {
            console.log(`🚗 ❌ No vehicle state found for ${vin}, checking current Ford API status...`);

            // Fallback: Check current Ford API ignition status when no vehicle state exists
            try {
                const { fordClient } = await import('./providers/fordClient');
                const currentSignal = await fordClient.getSignals(vin, ['ignition_status']);

                if (currentSignal?.ignition?.value) {
                    const currentIgnition = currentSignal.ignition.value.toUpperCase();
                    console.log(`🚗 Current Ford API ignition for ${vin}: ${currentIgnition}`);

                    if (currentIgnition === 'ON') {
                        // Vehicle is on trip but we don't know when it started
                        console.log(`🚗 ✅ Vehicle ${vin} is ON TRIP (Ford API fallback), duration unknown`);
                        return {
                            isOnTrip: true,
                            duration: 'Unknown duration',
                            source: 'ford-api-fallback'
                        };
                    } else {
                        console.log(`🚗 Vehicle ${vin} ignition is OFF (Ford API fallback)`);
                        return {
                            isOnTrip: false,
                            duration: '0m',
                            source: 'ford-api-fallback-off'
                        };
                    }
                }
            } catch (error) {
                console.error(`🚗 Failed to check Ford API for ${vin}:`, error);
            }

            return {
                isOnTrip: false,
                duration: '0m',
                source: 'no-state'
            };
        }

        // Check if vehicle is currently on a trip (ignition ON)
        // Handle both "ON" and "On" case variations from Ford API
        const isCurrentlyOnTrip = vehicleState.lastIgnitionStatus?.toUpperCase() === 'ON';

        if (!isCurrentlyOnTrip) {
            console.log(`🚗 Vehicle ${vin} is not on trip (ignition: ${vehicleState.lastIgnitionStatus})`);
            return {
                isOnTrip: false,
                duration: '0m',
                source: 'ignition-off'
            };
        }

        // Vehicle is on trip - calculate duration from last ignition ON time
        let tripDuration = '0m';
        let ignitionOnTime: Date | null = null;

        if (vehicleState.lastUpdate) {
            const now = new Date();
            const timeSinceIgnitionOn = now.getTime() - vehicleState.lastUpdate.getTime();
            tripDuration = this.formatDuration(timeSinceIgnitionOn);
            ignitionOnTime = vehicleState.lastUpdate;

            console.log(`🚗 ✅ Trip active for ${vin}: ${tripDuration} (since ${ignitionOnTime.toISOString()})`);
        }

        return {
            isOnTrip: true,
            duration: tripDuration,
            lastIgnitionOnTime: ignitionOnTime || undefined,
            source: 'real-time-ignition'
        };
    }

    /**
     * Get current state derivation interval based on business hours
     */
    private getCurrentStateDerivationInterval(): number {
        return this.isBusinessHours()
            ? this.STATE_DERIVATION_INTERVAL_BUSINESS_HOURS
            : this.STATE_DERIVATION_INTERVAL_OFF_HOURS;
    }

    /**
     * Start state derivation loop for new MongoDB architecture
     */
    private startStateDerivation(): void {
        const interval = this.getCurrentStateDerivationInterval();
        console.log(`🔄 Starting vehicle state derivation loop (${interval / 1000}s intervals)...`);

        // Start with a 10-second delay to stagger with the main monitoring loop
        setTimeout(() => {
            this.stateDerivationInterval = setInterval(async () => {
                await this.deriveVehicleStates();
            }, interval);

            // Run initial state derivation after delay
            this.deriveVehicleStates();
        }, 10 * 1000);
    }

    /**
     * Capture Ford Telematics data and derive canonical vehicle state
     * This is the core of the new architecture - MongoDB as single source of truth
     */
    private async deriveVehicleStates(): Promise<void> {
        try {
            // Get all vehicles
            const { vehicles } = await hybridVehicleClient.getVehicles();

            for (const vin of vehicles) {
                await this.captureAndDeriveVehicleState(vin);
            }

        } catch (error) {
            console.error('❌ Error in state derivation cycle:', error);
        }
    }

    /**
     * Capture Ford Telematics signal and derive state for a single vehicle
     */
    private async captureAndDeriveVehicleState(vin: string): Promise<void> {
        console.log(`🧠 [BKGND] Starting captureAndDeriveVehicleState for ${vin}`);
        try {
            // Get current vehicle data using Ford provider wrapper for API stability
            const { fordClient } = await import('./providers/fordClient');

            // Request all relevant signals including battery range
            const signalFilter = [
                'ignition_status',
                'position',
                'odometer',
                'xev_battery_state_of_charge',
                'xev_battery_range',  // This is the missing range data!
                'xev_battery_charge_display_status',
                'xev_plug_charger_status'
            ];

            console.log(`📡 Fetching Ford data via provider for ${vin} with signals: ${signalFilter.join(', ')}`);
            const fordSignal = await fordClient.getSignals(vin, signalFilter);

            if (!fordSignal || !fordSignal.position) {
                console.warn(`⚠️ No Ford position data received for ${vin}`);
                return;
            }

            // Extract location data from normalized Ford signal
            const latitude = fordSignal.position.lat || 0;
            const longitude = fordSignal.position.lon || 0;

            if (!latitude || !longitude) {
                console.warn(`⚠️ No location data for vehicle ${vin}`);
                return;
            }

            const now = new Date();

            // Create telematics signal record with all available data from normalized Ford signal
            const signal: TelematicsSignal = {
                vin,
                ts: fordSignal.ts,
                serverTs: now.toISOString(),
                ignition: fordSignal.ignition?.value || 'Unknown',
                latitude: latitude,
                longitude: longitude,
                odoMiles: fordSignal.odoMiles?.value || 0,
                socPct: fordSignal.socPct?.value || 0,
                pluggedIn: fordSignal.plug?.connected || false,
                // Add the missing range field!
                batteryRangeKm: fordSignal.rangeKm?.value
            };

            console.log(`📊 Captured Ford data for ${vin}: battery ${signal.socPct}%, range ${signal.batteryRangeKm}km, ignition ${signal.ignition}`);

            // Use smart logging to filter and store signals intelligently
            const { smartLogger } = await import('./smartLogger');
            const changeDetection = await smartLogger.shouldStoreSignal(signal);

            if (changeDetection.shouldStore) {
                await smartLogger.storeSignalWithSmartTTL(signal, changeDetection.storageCategory);
                console.log(`🧠 Smart stored ${vin}: ${changeDetection.storageCategory} (${changeDetection.changeReasons.join(', ')})`);
            } else {
                console.log(`📤 Skipped storing ${vin}: no significant changes`);
            }

            // Always derive canonical state regardless of storage decision
            console.log(`🧠 [BKGND] About to call StateDeriver for ${vin}`);
            const { stateDeriver } = await import('./stateDeriver');
            const canonicalState = await stateDeriver.deriveState(signal);
            await stateDeriver.upsertCanonicalState(canonicalState);
            console.log(`🧠 [BKGND] StateDeriver completed for ${vin}`);

        } catch (error) {
            console.error(`❌ Error capturing state for ${vin}:`, error);
        }
    }

    /**
     * Derive canonical vehicle state from telematics signal
     */
    private async deriveStateFromSignal(
        signal: TelematicsSignal,
        vehicleData: any
    ): Promise<NewVehicleState> {
        const now = new Date();
        const signalTime = new Date(signal.ts);
        const freshnessMs = now.getTime() - signalTime.getTime();

        // Get previous state to detect transitions
        let prevSignal: any;
        try {
            const existingStates = await getLatestSignals();
            prevSignal = existingStates.find(s => s.vin === signal.vin);
        } catch (error) {
            console.warn(`Failed to get previous signals for ${signal.vin}:`, error);
            prevSignal = null;
        }

        // Determine current state based on multiple factors
        let currentState: VehicleStateEnum;
        let stateSince: string;

        if (signal.ignition === 'On' || signal.ignition === 'Run') {
            // Vehicle is actively running
            currentState = 'TRIP';

            // Check if this is a state transition
            if (!prevSignal || prevSignal.ignition === 'Off') {
                stateSince = signal.ts; // New trip started
                console.log(`🚗 ${signal.vin}: TRIP started at ${signal.ts}`);
            } else {
                // Continue existing trip state
                stateSince = prevSignal.stateSince || signal.ts;
            }

        } else if (signal.pluggedIn && signal.ignition === 'Off') {
            // Vehicle is parked and charging
            currentState = 'CHARGING';

            if (!prevSignal || prevSignal.state !== 'CHARGING') {
                stateSince = signal.ts; // Started charging
                console.log(`🔌 ${signal.vin}: CHARGING started at ${signal.ts}`);
            } else {
                stateSince = prevSignal.stateSince || signal.ts;
            }

        } else {
            // Vehicle is parked (ignition off, not charging)
            currentState = 'PARKED';

            if (!prevSignal || prevSignal.state !== 'PARKED') {
                stateSince = signal.ts; // Started parking
                console.log(`🅿️ ${signal.vin}: PARKED started at ${signal.ts}`);
            } else {
                stateSince = prevSignal.stateSince || signal.ts;
            }
        }

        // Detect movement for lastMovementTs
        let lastMovementTs: string | undefined;
        if (prevSignal) {
            const distance = this.calculateDistance(
                prevSignal.latitude,
                prevSignal.longitude,
                signal.latitude,
                signal.longitude
            );

            if (distance > 10) { // 10 meters movement threshold
                lastMovementTs = signal.ts;
            } else {
                lastMovementTs = prevSignal.lastMovementTs;
            }
        }

        // Track ignition state changes
        let lastIgnitionOnTs: string | undefined;
        let lastIgnitionOffTs: string | undefined;

        if (prevSignal) {
            // Inherit previous timestamps
            lastIgnitionOnTs = prevSignal.lastIgnitionOnTs;
            lastIgnitionOffTs = prevSignal.lastIgnitionOffTs;

            // Update if ignition state changed
            if (signal.ignition === 'On' && prevSignal.ignition === 'Off') {
                lastIgnitionOnTs = signal.ts;
            } else if (signal.ignition === 'Off' && prevSignal.ignition === 'On') {
                lastIgnitionOffTs = signal.ts;
            }
        } else {
            // First signal - set based on current state
            if (signal.ignition === 'On') {
                lastIgnitionOnTs = signal.ts;
            } else {
                lastIgnitionOffTs = signal.ts;
            }
        }

        // Get address if available
        const lastKnownAddress = vehicleData.location?.address;

        const derivedState: NewVehicleState = {
            vin: signal.vin,
            lastSignalTs: signal.ts,
            freshnessMs,
            state: currentState,
            stateSince,
            lastMovementTs,
            lastIgnitionOnTs,
            lastIgnitionOffTs,
            lastKnownAddress,
            lastUpdatedAt: now.toISOString()
        };

        return derivedState;
    }

    /**
     * Normalize ignition status from Ford API variations
     */
    private normalizeIgnitionStatus(status: string): 'Off' | 'Run' | 'On' | 'Unknown' {
        const normalized = status.toUpperCase();

        if (normalized === 'OFF') return 'Off';
        if (normalized === 'ON' || normalized === 'RUNNING' || normalized === 'STARTED') return 'On';
        if (normalized === 'RUN') return 'Run';

        return 'Unknown';
    }

    /**
     * Get vehicle name from VIN
     */
    private getVehicleNameFromVin(vin: string): string {
        // Direct VIN mapping - VIN ending in 0591 is eTransit Van, others are Lightnings
        if (vin.endsWith('0591')) return 'eTransit Van';

        // Map VINs to friendly names based on environment variables
        if (vin === process.env.LIGHTNING_VIN) return 'Lightning 1';
        if (vin === process.env.LIGHTNING_PRO_VIN) return 'Lightning Pro';
        if (vin === process.env.LIGHTNING_XLT_VIN) return 'Lightning XLT';
        if (vin === process.env.TRANSIT_VIN) return 'eTransit Van';
        if (vin === process.env.LIGHTNING_2_VIN) return 'Lightning 2';

        // Fallback based on VIN pattern
        if (vin.includes('3FTTK8')) return 'F-150 Lightning';
        if (vin.includes('3PCAJ')) return 'Transit Van';
        if (vin.includes('1FT')) return 'Ford Lightning'; // Ford F-150 Lightning pattern
        if (vin.includes('1FTVW')) return 'Ford Lightning'; // Ford F-150 Lightning pattern

        return 'Unknown Vehicle';
    }

    /**
     * Format milliseconds into human readable duration using centralized TimezoneUtils
     */
    private formatDuration(milliseconds: number): string {
        return TimezoneUtils.formatDuration(milliseconds);
    }


    public async close(): Promise<void> {
        this.stopMonitoring();
        
        if (this.client) {
            await this.client.close();
        }
        
        console.log('✅ Background monitoring service closed');
    }
}

export const backgroundMonitoringService = new BackgroundMonitoringService();