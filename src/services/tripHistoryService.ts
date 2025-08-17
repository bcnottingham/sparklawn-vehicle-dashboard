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
    private tripsCollection!: Collection<Trip>;
    private pointsCollection!: Collection<TripPoint>;
    private eventsCollection!: Collection<VehicleMovementEvent>;
    private activeTrips: Map<string, Trip> = new Map();
    private lastKnownLocations: Map<string, TripPoint> = new Map();
    
    // Configuration
    private readonly TRIP_START_MOVEMENT_THRESHOLD = 50; // meters
    private readonly TRIP_END_IDLE_TIME = 10; // minutes
    private readonly LOCATION_UPDATE_INTERVAL = 30; // seconds
    private readonly MAX_SPEED_THRESHOLD = 80; // mph (likely GPS error if exceeded)
    
    constructor() {
        this.connect();
    }
    
    private async connect(): Promise<void> {
        try {
            const mongoUri = process.env.MONGODB_URI;
            if (!mongoUri) {
                throw new Error('MONGODB_URI environment variable is required');
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
        activeTrip.isComplete = true;
        
        // Calculate final trip metrics
        await this.calculateFinalTripMetrics(activeTrip);
        
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
            
            // Speed analysis
            const timeDiff = (curr.timestamp.getTime() - prev.timestamp.getTime()) / (1000 * 3600); // hours
            if (timeDiff > 0 && segmentDistance > 0) {
                const speed = segmentDistance / timeDiff;
                if (speed < this.MAX_SPEED_THRESHOLD) {
                    maxSpeed = Math.max(maxSpeed, speed);
                    if (speed > 5) { // Moving
                        movingTime += timeDiff * 60; // minutes
                    } else { // Stopped
                        idleTime += timeDiff * 60;
                        if (timeDiff > 2/60) { // Stop longer than 2 minutes
                            stops++;
                        }
                    }
                }
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
    private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
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
        const query = vehicleId ? { vehicleId, isComplete: true } : { isComplete: true };
        return this.tripsCollection
            .find(query)
            .sort({ startTime: -1 })
            .limit(limit)
            .toArray();
    }
    
    public async getActiveTrips(): Promise<Trip[]> {
        return Array.from(this.activeTrips.values());
    }
    
    public async getTripById(tripId: string): Promise<Trip | null> {
        return this.tripsCollection.findOne({ _id: tripId });
    }
    
    public async getVehicleStats(vehicleId: string, days: number = 30): Promise<any> {
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
    }
    
    public async getFleetStats(days: number = 7): Promise<any> {
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
    }
}

export const tripHistoryService = new TripHistoryService();