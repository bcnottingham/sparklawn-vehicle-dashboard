import { MongoClient, Db, Collection } from 'mongodb';

export interface TripPoint {
    vehicleId: string;
    latitude: number;
    longitude: number;
    timestamp: Date;
    batteryLevel?: number;
    speed?: number;
    address?: string;
    dataSource: 'fordpass' | 'smartcar' | 'mock';
}

export interface Trip {
    _id?: string;
    vehicleId: string;
    vehicleName: string;
    startTime: Date;
    endTime?: Date;
    startLocation: {
        latitude: number;
        longitude: number;
        address?: string;
    };
    endLocation?: {
        latitude: number;
        longitude: number;
        address?: string;
    };
    points: TripPoint[];
    distance?: number; // in miles
    duration?: number; // in minutes
    avgSpeed?: number; // in mph
    startBattery?: number;
    endBattery?: number;
    energyUsed?: number; // percentage
    isComplete: boolean;
    summary?: {
        maxSpeed: number;
        minBattery: number;
        maxBattery: number;
        totalStops: number;
        movingTime: number; // time actually moving
        idleTime: number; // time stopped
    };
}

export interface VehicleMovementEvent {
    vehicleId: string;
    vehicleName: string;
    eventType: 'trip_start' | 'trip_end' | 'location_update' | 'stop_detected';
    location: {
        latitude: number;
        longitude: number;
        address?: string;
    };
    timestamp: Date;
    batteryLevel?: number;
    speed?: number;
    metadata?: {
        previousLocation?: {
            latitude: number;
            longitude: number;
        };
        distanceMoved?: number;
        timeSinceLastUpdate?: number;
    };
}

export class TripHistoryService {
    private client!: MongoClient;
    private db!: Db;
    protected tripsCollection!: Collection<Trip>;
    private pointsCollection!: Collection<TripPoint>;
    protected eventsCollection!: Collection<VehicleMovementEvent>;
    private activeTrips: Map<string, Trip> = new Map();
    private lastKnownLocations: Map<string, TripPoint> = new Map();
    
    // Configuration
    private readonly TRIP_START_MOVEMENT_THRESHOLD = 50; // meters
    private readonly TRIP_END_IDLE_TIME = 10; // minutes
    private readonly LOCATION_UPDATE_INTERVAL = 3; // seconds for detailed trip tracking
    // GPS noise filtering and realistic trip detection constants
    private readonly MIN_MOVEMENT_THRESHOLD = 20; // meters - increased to filter GPS drift
    private readonly MIN_TRIP_DISTANCE = 100; // meters - minimum distance to consider a real trip
    private readonly MIN_SPEED_THRESHOLD = 3; // mph - ignore movements slower than walking speed
    private readonly MAX_SPEED_THRESHOLD = 85; // mph - maximum realistic speed for work vehicles
    private readonly GPS_ACCURACY_BUFFER = 15; // meters - typical GPS accuracy, ignore smaller movements
    private readonly MIN_TIME_BETWEEN_POINTS = 5; // seconds - minimum time to avoid division by zero
    
    constructor() {
        this.connect();
    }
    
    private async connect(): Promise<void> {
        try {
            const mongoUri = process.env.MONGODB_URI;
            if (!mongoUri) {
                console.warn('⚠️ MONGODB_URI not configured - trip history service disabled');
                return;
            }
            
            this.client = new MongoClient(mongoUri);
            await this.client.connect();
            this.db = this.client.db('sparklawn_fleet');
            
            // Initialize collections
            this.tripsCollection = this.db.collection<Trip>('trips');
            this.pointsCollection = this.db.collection<TripPoint>('trip_points');
            this.eventsCollection = this.db.collection<VehicleMovementEvent>('movement_events');
            
            // Create indexes for better performance
            await this.createIndexes();
            
            // Load active trips from database
            await this.loadActiveTrips();
            
            console.log('✅ Trip history service connected to MongoDB');
        } catch (error) {
            console.error('❌ Failed to connect trip history service to MongoDB:', error);
            throw error;
        }
    }
    
    private async createIndexes(): Promise<void> {
        try {
            // Trip indexes
            await this.tripsCollection.createIndex({ vehicleId: 1, startTime: -1 });
            await this.tripsCollection.createIndex({ isComplete: 1 });
            await this.tripsCollection.createIndex({ startTime: -1 });
            
            // Trip points indexes
            await this.pointsCollection.createIndex({ vehicleId: 1, timestamp: -1 });
            await this.pointsCollection.createIndex({ timestamp: -1 });
            
            // Movement events indexes
            await this.eventsCollection.createIndex({ vehicleId: 1, timestamp: -1 });
            await this.eventsCollection.createIndex({ eventType: 1, timestamp: -1 });
            
            console.log('✅ Trip history indexes created');
        } catch (error) {
            console.warn('⚠️ Failed to create trip history indexes:', error);
        }
    }
    
    private async loadActiveTrips(): Promise<void> {
        try {
            const activeTrips = await this.tripsCollection.find({ isComplete: false }).toArray();
            activeTrips.forEach(trip => {
                this.activeTrips.set(trip.vehicleId, trip);
            });
            
            console.log(`✅ Loaded ${activeTrips.length} active trips`);
        } catch (error) {
            console.error('❌ Failed to load active trips:', error);
        }
    }
    
    public async recordVehicleLocation(
        vehicleId: string,
        vehicleName: string,
        latitude: number,
        longitude: number,
        batteryLevel?: number,
        speed?: number,
        address?: string,
        dataSource: 'fordpass' | 'smartcar' | 'mock' = 'smartcar'
    ): Promise<void> {
        const timestamp = new Date();
        const newPoint: TripPoint = {
            vehicleId,
            latitude,
            longitude,
            timestamp,
            batteryLevel,
            speed,
            address,
            dataSource
        };
        
        try {
            // Get last known location
            const lastLocation = this.lastKnownLocations.get(vehicleId);
            
            // Calculate movement
            let distanceMoved = 0;
            let timeSinceLastUpdate = 0;
            
            if (lastLocation) {
                distanceMoved = this.calculateDistance(
                    lastLocation.latitude,
                    lastLocation.longitude,
                    latitude,
                    longitude
                );
                timeSinceLastUpdate = (timestamp.getTime() - lastLocation.timestamp.getTime()) / 1000;
            }
            
            // Determine event type and handle trip logic
            await this.processMovementEvent(
                vehicleId,
                vehicleName,
                newPoint,
                lastLocation,
                distanceMoved,
                timeSinceLastUpdate
            );
            
            // Store the point
            await this.pointsCollection.insertOne(newPoint);
            
            // Update last known location
            this.lastKnownLocations.set(vehicleId, newPoint);
            
        } catch (error) {
            console.error('❌ Failed to record vehicle location:', error);
        }
    }
    
    private async processMovementEvent(
        vehicleId: string,
        vehicleName: string,
        currentPoint: TripPoint,
        lastPoint: TripPoint | undefined,
        distanceMoved: number,
        timeSinceLastUpdate: number
    ): Promise<void> {
        const activeTrip = this.activeTrips.get(vehicleId);
        
        // Detect trip start
        if (!activeTrip && lastPoint && distanceMoved > this.TRIP_START_MOVEMENT_THRESHOLD) {
            await this.startTrip(vehicleId, vehicleName, currentPoint);
            await this.recordEvent(vehicleId, vehicleName, 'trip_start', currentPoint, {
                previousLocation: { latitude: lastPoint.latitude, longitude: lastPoint.longitude },
                distanceMoved,
                timeSinceLastUpdate
            });
            return;
        }
        
        // Update active trip
        if (activeTrip) {
            // Add point to active trip
            activeTrip.points.push(currentPoint);
            
            // Update trip metrics
            await this.updateTripMetrics(activeTrip, currentPoint);
            
            // Check for trip end (vehicle has been idle)
            if (timeSinceLastUpdate > this.TRIP_END_IDLE_TIME * 60) {
                await this.endTrip(vehicleId, currentPoint);
                await this.recordEvent(vehicleId, vehicleName, 'trip_end', currentPoint);
                return;
            }
            
            // Record regular location update
            await this.recordEvent(vehicleId, vehicleName, 'location_update', currentPoint, {
                previousLocation: lastPoint ? { latitude: lastPoint.latitude, longitude: lastPoint.longitude } : undefined,
                distanceMoved,
                timeSinceLastUpdate
            });
        }
    }
    
    private async startTrip(vehicleId: string, vehicleName: string, startPoint: TripPoint): Promise<void> {
        const trip: Trip = {
            vehicleId,
            vehicleName,
            startTime: startPoint.timestamp,
            startLocation: {
                latitude: startPoint.latitude,
                longitude: startPoint.longitude,
                address: startPoint.address
            },
            points: [startPoint],
            startBattery: startPoint.batteryLevel,
            isComplete: false
        };
        
        // Insert trip into database
        const result = await this.tripsCollection.insertOne(trip as any);
        trip._id = result.insertedId?.toString();
        
        // Store in active trips
        this.activeTrips.set(vehicleId, trip);
        
        console.log(`🚗 Started new trip for vehicle ${vehicleName} (${vehicleId})`);
    }
    
    private async endTrip(vehicleId: string, endPoint: TripPoint): Promise<void> {
        const activeTrip = this.activeTrips.get(vehicleId);
        if (!activeTrip) return;
        
        // Update trip with end information
        activeTrip.endTime = endPoint.timestamp;
        activeTrip.endLocation = {
            latitude: endPoint.latitude,
            longitude: endPoint.longitude,
            address: endPoint.address
        };
        activeTrip.endBattery = endPoint.batteryLevel;

        // Calculate final trip metrics first to get distance
        await this.calculateFinalTripMetrics(activeTrip);

        // Validate trip meets minimum requirements - filter out GPS noise trips
        const totalDistanceMeters = (activeTrip.distance || 0) * 1609.34; // Convert miles to meters
        if (totalDistanceMeters < this.MIN_TRIP_DISTANCE) {
            console.log(`🚫 Discarding trip for ${activeTrip.vehicleName}: distance ${totalDistanceMeters.toFixed(1)}m below ${this.MIN_TRIP_DISTANCE}m threshold`);

            // Remove invalid trip from database and active trips
            if (activeTrip._id) {
                await this.tripsCollection.deleteOne({ _id: activeTrip._id });
            }
            this.activeTrips.delete(vehicleId);
            return;
        }

        activeTrip.isComplete = true;
        
        // Update in database
        await this.tripsCollection.updateOne(
            { _id: activeTrip._id },
            { $set: activeTrip }
        );
        
        // Remove from active trips
        this.activeTrips.delete(vehicleId);
        
        console.log(`🏁 Completed trip for vehicle ${activeTrip.vehicleName}: ${activeTrip.distance?.toFixed(1)} miles in ${activeTrip.duration} minutes`);
    }
    
    private async updateTripMetrics(trip: Trip, newPoint: TripPoint): Promise<void> {
        if (trip.points.length < 2) return;
        
        const lastPoint = trip.points[trip.points.length - 2];
        const segmentDistance = this.calculateDistance(
            lastPoint.latitude,
            lastPoint.longitude,
            newPoint.latitude,
            newPoint.longitude
        );
        
        // Update total distance
        trip.distance = (trip.distance || 0) + segmentDistance;
        
        // Update duration
        trip.duration = Math.round((newPoint.timestamp.getTime() - trip.startTime.getTime()) / (1000 * 60));
        
        // Update average speed
        if (trip.duration > 0) {
            trip.avgSpeed = Math.round((trip.distance / trip.duration) * 60); // mph
        }
        
        // Update energy used
        if (trip.startBattery && newPoint.batteryLevel) {
            trip.energyUsed = trip.startBattery - newPoint.batteryLevel;
        }
    }
    
    private async calculateFinalTripMetrics(trip: Trip): Promise<void> {
        if (trip.points.length < 2) return;
        
        let totalDistance = 0;
        let maxSpeed = 0;
        let minBattery = 100;
        let maxBattery = 0;
        let movingTime = 0;
        let idleTime = 0;
        let stops = 0;
        
        for (let i = 1; i < trip.points.length; i++) {
            const prev = trip.points[i - 1];
            const curr = trip.points[i];
            
            // Distance calculation
            const segmentDistance = this.calculateDistance(
                prev.latitude,
                prev.longitude,
                curr.latitude,
                curr.longitude
            );
            totalDistance += segmentDistance;
            
            // Enhanced speed analysis with GPS noise filtering
            const timeDiffSeconds = (curr.timestamp.getTime() - prev.timestamp.getTime()) / 1000;
            const timeDiffHours = timeDiffSeconds / 3600;

            // Only process segments with meaningful distance and time differences
            if (timeDiffSeconds >= this.MIN_TIME_BETWEEN_POINTS &&
                segmentDistance >= this.GPS_ACCURACY_BUFFER &&
                timeDiffHours > 0) {

                const speed = segmentDistance / timeDiffHours; // mph

                // Filter out impossible speeds caused by GPS drift/noise
                if (speed >= this.MIN_SPEED_THRESHOLD && speed <= this.MAX_SPEED_THRESHOLD) {
                    maxSpeed = Math.max(maxSpeed, speed);

                    if (speed > 5) { // Moving
                        movingTime += timeDiffHours * 60; // minutes
                    } else { // Stopped or very slow movement
                        idleTime += timeDiffHours * 60;
                        if (timeDiffHours > 2/60) { // Stop longer than 2 minutes
                            stops++;
                        }
                    }
                } else {
                    // Log filtered GPS noise for debugging
                    if (speed > this.MAX_SPEED_THRESHOLD) {
                        console.log(`🚫 Filtered impossible speed: ${speed.toFixed(1)} mph (distance: ${segmentDistance.toFixed(1)}m, time: ${timeDiffSeconds}s) for ${trip.vehicleId}`);
                    }
                    // Treat as idle time for very low speeds (GPS noise while parked)
                    idleTime += timeDiffHours * 60;
                }
            } else {
                // GPS noise - very small movement or time difference, treat as idle
                if (segmentDistance < this.GPS_ACCURACY_BUFFER) {
                    console.log(`🚫 Filtered GPS drift: ${segmentDistance.toFixed(1)}m movement for ${trip.vehicleId}`);
                }
                idleTime += timeDiffHours * 60;
            }
            
            // Battery analysis
            if (curr.batteryLevel) {
                minBattery = Math.min(minBattery, curr.batteryLevel);
                maxBattery = Math.max(maxBattery, curr.batteryLevel);
            }
        }
        
        trip.distance = totalDistance;
        trip.summary = {
            maxSpeed: Math.round(maxSpeed),
            minBattery: minBattery === 100 ? 0 : minBattery,
            maxBattery,
            totalStops: stops,
            movingTime: Math.round(movingTime),
            idleTime: Math.round(idleTime)
        };
    }
    
    private async recordEvent(
        vehicleId: string,
        vehicleName: string,
        eventType: VehicleMovementEvent['eventType'],
        location: TripPoint,
        metadata?: any
    ): Promise<void> {
        const event: VehicleMovementEvent = {
            vehicleId,
            vehicleName,
            eventType,
            location: {
                latitude: location.latitude,
                longitude: location.longitude,
                address: location.address
            },
            timestamp: location.timestamp,
            batteryLevel: location.batteryLevel,
            speed: location.speed,
            metadata
        };
        
        await this.eventsCollection.insertOne(event);
    }
    
    // Haversine formula for distance calculation
    protected calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const R = 3959; // Earth's radius in miles
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
    
    // Public API methods
    
    public async getTripHistory(vehicleId?: string, limit: number = 50): Promise<Trip[]> {
        if (!this.tripsCollection) {
            console.warn('⚠️ MongoDB not connected, returning empty trip history');
            return [];
        }
        
        try {
            const query = vehicleId ? { vehicleId, isComplete: true } : { isComplete: true };
            return await this.tripsCollection
                .find(query)
                .sort({ startTime: -1 })
                .limit(limit)
                .toArray();
        } catch (error) {
            console.error('❌ Failed to fetch trip history from MongoDB:', error);
            return [];
        }
    }
    
    public async getActiveTrips(): Promise<Trip[]> {
        return Array.from(this.activeTrips.values());
    }
    
    public async getTripById(tripId: string): Promise<Trip | null> {
        if (!this.tripsCollection) {
            console.warn('⚠️ MongoDB not connected, cannot fetch trip by ID');
            return null;
        }
        
        try {
            return await this.tripsCollection.findOne({ _id: tripId });
        } catch (error) {
            console.error('❌ Failed to fetch trip by ID from MongoDB:', error);
            return null;
        }
    }
    
    public async getVehicleStats(vehicleId: string, days: number = 30): Promise<any> {
        if (!this.tripsCollection) {
            console.warn('⚠️ MongoDB not connected, returning empty vehicle stats');
            return {
                totalTrips: 0,
                totalDistance: 0,
                totalDuration: 0,
                avgDistance: 0,
                avgDuration: 0,
                energyEfficiency: 0
            };
        }
        
        try {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);
            
            const trips = await this.tripsCollection
                .find({
                    vehicleId,
                    isComplete: true,
                    startTime: { $gte: startDate }
                })
                .toArray();
                
            if (trips.length === 0) {
            return {
                totalTrips: 0,
                totalDistance: 0,
                totalDuration: 0,
                avgDistance: 0,
                avgDuration: 0,
                energyEfficiency: 0
            };
        }
        
            const totalDistance = trips.reduce((sum, trip) => sum + (trip.distance || 0), 0);
            const totalDuration = trips.reduce((sum, trip) => sum + (trip.duration || 0), 0);
            const totalEnergyUsed = trips.reduce((sum, trip) => sum + (trip.energyUsed || 0), 0);
            
            return {
                totalTrips: trips.length,
                totalDistance: Math.round(totalDistance * 10) / 10,
                totalDuration: totalDuration,
                avgDistance: Math.round((totalDistance / trips.length) * 10) / 10,
                avgDuration: Math.round(totalDuration / trips.length),
                energyEfficiency: totalDistance > 0 ? Math.round((totalDistance / totalEnergyUsed) * 10) / 10 : 0
            };
        } catch (error) {
            console.error('❌ Failed to fetch vehicle stats from MongoDB:', error);
            return {
                totalTrips: 0,
                totalDistance: 0,
                totalDuration: 0,
                avgDistance: 0,
                avgDuration: 0,
                energyEfficiency: 0
            };
        }
    }
    
    public async getFleetStats(days: number = 7): Promise<any> {
        if (!this.tripsCollection) {
            console.warn('⚠️ MongoDB not connected, returning empty fleet stats');
            return { vehicleStats: {}, totalTrips: 0, totalDistance: 0 };
        }
        
        try {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);
            
            const trips = await this.tripsCollection
                .find({
                    isComplete: true,
                    startTime: { $gte: startDate }
                })
                .toArray();
        
        const vehicleStats: {[key: string]: any} = {};
        trips.forEach(trip => {
            if (!vehicleStats[trip.vehicleId]) {
                vehicleStats[trip.vehicleId] = {
                    vehicleName: trip.vehicleName,
                    trips: 0,
                    distance: 0,
                    duration: 0
                };
            }
            vehicleStats[trip.vehicleId].trips++;
            vehicleStats[trip.vehicleId].distance += trip.distance || 0;
            vehicleStats[trip.vehicleId].duration += trip.duration || 0;
        });
        
            return {
                totalTrips: trips.length,
                totalDistance: trips.reduce((sum, trip) => sum + (trip.distance || 0), 0),
                totalDuration: trips.reduce((sum, trip) => sum + (trip.duration || 0), 0),
                activeVehicles: Object.keys(vehicleStats).length,
                vehicleBreakdown: vehicleStats
            };
        } catch (error) {
            console.error('❌ Failed to fetch fleet stats from MongoDB:', error);
            return { vehicleStats: {}, totalTrips: 0, totalDistance: 0 };
        }
    }
}

// Linear Timeline Data Interface
export interface TimelineEvent {
    type: 'ignition_on' | 'departure' | 'arrival' | 'stop_start' | 'stop_end' | 'parked' | 'ignition_off';
    timestamp: Date;
    location: {
        latitude: number;
        longitude: number;
        address?: string;
        clientName?: string;
    };
    batteryLevel?: number;
    duration?: number; // For stops and drives
    distance?: number; // For drives
    metadata?: {
        stopDuration?: number;
        driveDuration?: number;
        driveDistance?: number;
        previousLocation?: string;
    };
}

// Extend the TripHistoryService class with timeline methods
export class TripTimelineService extends TripHistoryService {
    public async getTodaysLinearTimeline(vehicleId: string): Promise<{
        vehicle: string;
        status: 'active' | 'parked' | 'no_activity';
        currentLocation?: string;
        currentClient?: string;
        parkedDuration?: number;
        timeline: TimelineEvent[];
    }> {
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);

            // Get today's trips and events
            const todaysTrips = await this.tripsCollection
                .find({
                    vehicleId,
                    startTime: { $gte: today, $lt: tomorrow }
                })
                .sort({ startTime: 1 })
                .toArray();

            const todaysEvents = await this.eventsCollection
                .find({
                    vehicleId,
                    timestamp: { $gte: today, $lt: tomorrow }
                })
                .sort({ timestamp: 1 })
                .toArray();

            const timeline: TimelineEvent[] = [];
            let currentStatus: 'active' | 'parked' | 'no_activity' = 'no_activity';
            let currentLocation: string | undefined;
            let currentClient: string | undefined;
            let parkedDuration: number | undefined;

            // If no activity today, show current parked status
            if (todaysTrips.length === 0 && todaysEvents.length === 0) {
                // Get latest known location from any recent trip
                const recentTrip = await this.tripsCollection
                    .findOne(
                        { vehicleId },
                        { sort: { startTime: -1 } }
                    );

                if (recentTrip && recentTrip.endLocation) {
                    currentStatus = 'parked';
                    currentLocation = recentTrip.endLocation.address;
                    currentClient = await this.getClientNameFromLocation(
                        recentTrip.endLocation.latitude,
                        recentTrip.endLocation.longitude
                    );
                    
                    // Calculate how long it's been parked
                    if (recentTrip.endTime) {
                        parkedDuration = Math.floor((Date.now() - recentTrip.endTime.getTime()) / (1000 * 60));
                    }

                    timeline.push({
                        type: 'parked',
                        timestamp: recentTrip.endTime || new Date(),
                        location: recentTrip.endLocation,
                        metadata: {
                            stopDuration: parkedDuration
                        }
                    });
                }
                
                return {
                    vehicle: vehicleId,
                    status: currentStatus,
                    currentLocation,
                    currentClient,
                    parkedDuration,
                    timeline
                };
            }

            // Process trips chronologically to build timeline
            for (const trip of todaysTrips) {
                // Trip start (ignition on)
                timeline.push({
                    type: 'ignition_on',
                    timestamp: trip.startTime,
                    location: trip.startLocation,
                    batteryLevel: trip.startBattery
                });

                // Departure (leaving first location)
                if (trip.points && trip.points.length > 1) {
                    const departurePoint = trip.points[1]; // Second point shows actual departure
                    timeline.push({
                        type: 'departure',
                        timestamp: departurePoint.timestamp,
                        location: {
                            latitude: departurePoint.latitude,
                            longitude: departurePoint.longitude,
                            address: departurePoint.address
                        },
                        batteryLevel: departurePoint.batteryLevel
                    });
                }

                // Process stops during the trip
                await this.processTripStops(trip, timeline);

                // Trip end
                if (trip.isComplete && trip.endLocation && trip.endTime) {
                    timeline.push({
                        type: 'arrival',
                        timestamp: trip.endTime,
                        location: trip.endLocation,
                        batteryLevel: trip.endBattery,
                        metadata: {
                            driveDuration: trip.duration,
                            driveDistance: trip.distance
                        }
                    });

                    timeline.push({
                        type: 'ignition_off',
                        timestamp: trip.endTime,
                        location: trip.endLocation,
                        batteryLevel: trip.endBattery
                    });

                    currentStatus = 'parked';
                    currentLocation = trip.endLocation.address;
                    currentClient = await this.getClientNameFromLocation(
                        trip.endLocation.latitude,
                        trip.endLocation.longitude
                    );
                } else {
                    // Trip is still active
                    currentStatus = 'active';
                    if (trip.points && trip.points.length > 0) {
                        const lastPoint = trip.points[trip.points.length - 1];
                        currentLocation = lastPoint.address;
                        currentClient = await this.getClientNameFromLocation(
                            lastPoint.latitude,
                            lastPoint.longitude
                        );
                    }
                }
            }

            // Calculate parked duration if currently parked
            if (currentStatus === 'parked' && timeline.length > 0) {
                const lastEvent = timeline[timeline.length - 1];
                parkedDuration = Math.floor((Date.now() - lastEvent.timestamp.getTime()) / (1000 * 60));
            }

            return {
                vehicle: vehicleId,
                status: currentStatus,
                currentLocation,
                currentClient,
                parkedDuration,
                timeline
            };

        } catch (error) {
            console.error('❌ Failed to generate linear timeline:', error);
            return {
                vehicle: vehicleId,
                status: 'no_activity',
                timeline: []
            };
        }
    }

    private async processTripStops(trip: Trip, timeline: TimelineEvent[]): Promise<void> {
        if (!trip.points || trip.points.length < 3) return;

        const stops: { start: TripPoint, end: TripPoint, duration: number }[] = [];
        let potentialStopStart: TripPoint | null = null;
        let lastMovingPoint: TripPoint = trip.points[0];

        // Detect stops by looking for periods where vehicle doesn't move significantly
        for (let i = 1; i < trip.points.length; i++) {
            const currentPoint = trip.points[i];
            const distanceFromLast = this.calculateDistance(
                lastMovingPoint.latitude,
                lastMovingPoint.longitude,
                currentPoint.latitude,
                currentPoint.longitude
            );

            // If we haven't moved much, this might be a stop
            if (distanceFromLast < 0.1) { // Less than 0.1 miles
                if (!potentialStopStart) {
                    potentialStopStart = lastMovingPoint;
                }
            } else {
                // We're moving again
                if (potentialStopStart) {
                    const stopDuration = (currentPoint.timestamp.getTime() - potentialStopStart.timestamp.getTime()) / (1000 * 60);
                    
                    // Only count as a stop if it was at least 5 minutes
                    if (stopDuration >= 5) {
                        stops.push({
                            start: potentialStopStart,
                            end: lastMovingPoint,
                            duration: stopDuration
                        });
                    }
                    potentialStopStart = null;
                }
                lastMovingPoint = currentPoint;
            }
        }

        // Add stops to timeline
        for (const stop of stops) {
            timeline.push({
                type: 'stop_start',
                timestamp: stop.start.timestamp,
                location: {
                    latitude: stop.start.latitude,
                    longitude: stop.start.longitude,
                    address: stop.start.address
                },
                batteryLevel: stop.start.batteryLevel
            });

            timeline.push({
                type: 'stop_end',
                timestamp: stop.end.timestamp,
                location: {
                    latitude: stop.end.latitude,
                    longitude: stop.end.longitude,
                    address: stop.end.address
                },
                batteryLevel: stop.end.batteryLevel,
                metadata: {
                    stopDuration: stop.duration
                }
            });
        }
    }

    private async getClientNameFromLocation(latitude: number, longitude: number): Promise<string | undefined> {
        try {
            // Import the client location service
            const { clientLocationService } = await import('./clientLocations');
            return await clientLocationService.findClientLocationMatch(latitude, longitude) || undefined;
        } catch (error) {
            console.warn('Failed to get client name from location:', error);
            return undefined;
        }
    }
}

export const tripHistoryService = new TripHistoryService();
// Timeline service is exported from tripTimelineService.ts