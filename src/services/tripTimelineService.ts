import { Db, Collection } from 'mongodb';
import { RoutePoint } from './backgroundMonitoringService';
import { clientLocationService } from './clientLocations';
import { geocodingService } from './geocoding';
import { getDatabase } from '../db/index';

export interface TimelineEvent {
    id: string;
    type: 'ignition_on' | 'departure' | 'arrival' | 'stop_start' | 'stop_end' | 'parked' | 'ignition_off' | 'moving';
    timestamp: Date;
    location: {
        latitude: number;
        longitude: number;
        address?: string;
        clientName?: string;
    };
    batteryLevel?: number;
    speed?: number;
    duration?: number; // minutes since last event
    distance?: number; // kilometers from last event
    ignitionStatus?: string;
    metadata?: {
        stopDuration?: number;
        avgSpeed?: number;
        batteryUsed?: number;
        isClientLocation?: boolean;
        movementDetected?: boolean;
    };
}

export interface Stop {
    id: string;
    startTime: Date;
    endTime: Date;
    location: {
        latitude: number;
        longitude: number;
        address?: string;
        clientName?: string;
    };
    duration: number; // minutes
    batteryLevel?: number;
    type: 'client_visit' | 'service_stop' | 'unknown_stop';
}

export interface Trip {
    id: string;
    startTime: Date;
    endTime: Date;
    startLocation: {
        latitude: number;
        longitude: number;
        address?: string;
        clientName?: string;
        batteryLevel?: number;
    };
    endLocation: {
        latitude: number;
        longitude: number;
        address?: string;
        clientName?: string;
        batteryLevel?: number;
    };
    distance: number; // kilometers
    duration: number; // minutes
    batteryUsed: number;
    avgSpeed: number;
    maxSpeed: number;
    route: RoutePoint[];
}

export interface TripTimeline {
    vehicleId: string;
    vehicleName: string;
    date: string;
    trips: Trip[];
    stops: Stop[];
    events: TimelineEvent[];
    summary: {
        totalDistance: number;
        totalDuration: number;
        movingTime: number;
        stoppedTime: number;
        batteryUsed: number;
        clientVisits: number;
        avgSpeed: number;
        maxSpeed: number;
        totalTrips: number;
        routePoints: RoutePoint[];
    };
}

export class TripTimelineService {
    private routePointsCollection!: Collection<RoutePoint>;
    private clientLocationCache: Map<string, string | null> = new Map();
    private locationMatchCache: Map<string, { type: 'home_base' | 'client'; name: string } | null> = new Map();
    private initialized = false;

    private async ensureInitialized(): Promise<void> {
        if (!this.initialized) {
            try {
                const db = await getDatabase();
                this.routePointsCollection = db.collection<RoutePoint>('route_points');
                this.initialized = true;
                console.log('✅ Trip timeline service initialized');
            } catch (error) {
                console.error('❌ Failed to initialize timeline service:', error);
                throw error;
            }
        }
    }

    /**
     * Get detailed timeline for a specific vehicle for today
     */
    async getTodaysTimeline(vehicleId: string): Promise<TripTimeline> {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);
        
        return this.getTimelineForPeriod(vehicleId, startOfDay, endOfDay);
    }
    
    /**
     * Get timeline for specific date range
     */
    async getTimelineForPeriod(vehicleId: string, startDate: Date, endDate: Date): Promise<TripTimeline> {
        await this.ensureInitialized();
        console.log(`🔍 Building timeline for vehicle ${vehicleId} from ${startDate.toISOString()} to ${endDate.toISOString()}`);

        // Get all route points for this vehicle in the period with vehicleId filtering
        const routePoints = await this.routePointsCollection
            .find({ 
                vehicleId: vehicleId,
                timestamp: { 
                    $gte: startDate, 
                    $lte: endDate 
                }
            })
            .sort({ timestamp: 1 })
            .toArray();
            
        console.log(`📊 Found ${routePoints.length} route points for vehicle ${vehicleId}`);
        
        if (routePoints.length === 0) {
            return {
                vehicleId,
                vehicleName: this.getVehicleName(vehicleId),
                date: startDate.toISOString().split('T')[0],
                trips: [],
                stops: [],
                events: [],
                summary: {
                    totalDistance: 0,
                    totalDuration: 0,
                    movingTime: 0,
                    stoppedTime: 0,
                    batteryUsed: 0,
                    clientVisits: 0,
                    avgSpeed: 0,
                    maxSpeed: 0,
                    totalTrips: 0,
                    routePoints: []
                }
            };
        }
        
        // Process route points into timeline events
        const events = await this.processRoutePointsIntoEvents(routePoints);
        
        // Aggregate events into discrete trips
        const trips = await this.aggregateEventsIntoTrips(routePoints);
        
        // Generate stops between trips
        const stops = await this.generateStopsBetweenTrips(trips, routePoints);
        
        const summary = this.calculateSummary(routePoints, events, trips);
        
        return {
            vehicleId,
            vehicleName: this.getVehicleName(vehicleId),
            date: startDate.toISOString().split('T')[0],
            trips,
            stops,
            events,
            summary: {
                ...summary,
                routePoints
            }
        };
    }
    
    /**
     * Process route points into structured timeline events
     */
    private async processRoutePointsIntoEvents(routePoints: RoutePoint[]): Promise<TimelineEvent[]> {
        const events: TimelineEvent[] = [];
        let previousPoint: RoutePoint | null = null;
        let stopStartTime: Date | null = null;
        let lastMovingPoint: RoutePoint | null = null;
        
        for (let i = 0; i < routePoints.length; i++) {
            const point = routePoints[i];
            const nextPoint = i < routePoints.length - 1 ? routePoints[i + 1] : null;
            
            // Check for location match (home base or client)
            const locationMatch = await this.getCachedLocationMatch(point.latitude, point.longitude);
            const clientName = locationMatch?.type === 'client' ? locationMatch.name :
                              locationMatch?.type === 'home_base' ? `🏠 ${locationMatch.name}` : null;
            
            const event: TimelineEvent = {
                id: `${point.vehicleId}_${point.timestamp.getTime()}`,
                type: 'moving', // default, will be updated based on analysis
                timestamp: point.timestamp,
                location: {
                    latitude: point.latitude,
                    longitude: point.longitude,
                    address: point.address,
                    clientName: clientName || undefined
                },
                batteryLevel: point.batteryLevel,
                speed: point.speed || 0,
                ignitionStatus: point.ignitionStatus,
                metadata: {
                    isClientLocation: !!clientName,
                    movementDetected: point.isMoving
                }
            };
            
            // Calculate distance and duration from previous point
            if (previousPoint) {
                const distance = this.calculateDistance(
                    previousPoint.latitude, previousPoint.longitude,
                    point.latitude, point.longitude
                );
                const duration = (point.timestamp.getTime() - previousPoint.timestamp.getTime()) / (1000 * 60);
                
                event.distance = distance;
                event.duration = duration;
                
                if (previousPoint.batteryLevel && point.batteryLevel) {
                    event.metadata!.batteryUsed = previousPoint.batteryLevel - point.batteryLevel;
                }
            }
            
            // Determine event type based on ignition status and movement
            if (point.ignitionStatus === 'On' && (!previousPoint || previousPoint.ignitionStatus !== 'On')) {
                event.type = 'ignition_on';
            } else if (point.ignitionStatus === 'Off' && previousPoint && previousPoint.ignitionStatus === 'On') {
                event.type = 'ignition_off';
            } else if (point.isMoving && previousPoint && !previousPoint.isMoving) {
                event.type = 'departure';
                lastMovingPoint = point;
                if (stopStartTime) {
                    event.metadata!.stopDuration = (point.timestamp.getTime() - stopStartTime.getTime()) / (1000 * 60);
                    stopStartTime = null;
                }
            } else if (!point.isMoving && previousPoint && previousPoint.isMoving) {
                event.type = 'arrival';
                if (clientName) {
                    event.type = 'arrival'; // Arrived at client location
                }
                stopStartTime = point.timestamp;
            } else if (point.isMoving) {
                event.type = 'moving';
                lastMovingPoint = point;
            } else {
                event.type = 'parked';
            }
            
            // Detect significant stops (5+ minutes)
            if (stopStartTime && nextPoint && nextPoint.isMoving && !point.isMoving) {
                const stopDuration = (nextPoint.timestamp.getTime() - stopStartTime.getTime()) / (1000 * 60);
                if (stopDuration >= 5) {
                    event.type = 'stop_start';
                    event.metadata!.stopDuration = stopDuration;
                }
            }
            
            events.push(event);
            previousPoint = point;
        }
        
        return events;
    }
    
    /**
     * Aggregate route points into discrete trips based on MOVEMENT
     * North Star: Track where vehicles go and how long they stay - ignoring ignition cycling
     */
    private async aggregateEventsIntoTrips(routePoints: RoutePoint[]): Promise<Trip[]> {
        if (routePoints.length === 0) return [];

        const trips: Trip[] = [];
        let currentTripStart: RoutePoint | null = null;
        let currentTripPoints: RoutePoint[] = [];

        const STATIONARY_RADIUS = 0.1; // 100 meters - define a "location"
        const MIN_STOP_DURATION = 1.5; // 90 seconds (1.5 minutes) - real stop vs traffic light

        console.log(`🔍 [TripTimeline] Processing ${routePoints.length} GPS points into trips...`);

        for (let i = 0; i < routePoints.length; i++) {
            const point = routePoints[i];

            // NO TRIP IN PROGRESS - Check if vehicle starts moving
            if (!currentTripStart) {
                if (point.isMoving) {
                    currentTripStart = point;
                    currentTripPoints = [point];
                    console.log(`🚗 [TripTimeline] Trip started at ${point.timestamp.toISOString().substr(11, 8)}`);
                }
                continue;
            }

            // TRIP IN PROGRESS - Add this point
            currentTripPoints.push(point);

            // Check if vehicle has STOPPED and STAYS STOPPED
            if (!point.isMoving) {
                // Scan forward from this point to see if vehicle stays within STATIONARY_RADIUS for MIN_STOP_DURATION
                let totalStoppedTime = 0;
                let staysNearby = true;
                let scanIndex = i + 1;

                while (scanIndex < routePoints.length) {
                    const futurePoint = routePoints[scanIndex];
                    const distance = this.calculateDistance(
                        point.latitude, point.longitude,
                        futurePoint.latitude, futurePoint.longitude
                    );

                    const timeDiff = (futurePoint.timestamp.getTime() - point.timestamp.getTime()) / (1000 * 60);

                    // Vehicle moved away - not a stop
                    if (distance > STATIONARY_RADIUS) {
                        staysNearby = false;
                        break;
                    }

                    totalStoppedTime = timeDiff;

                    // Vehicle has been stationary for MIN_STOP_DURATION - this is a real stop
                    if (totalStoppedTime >= MIN_STOP_DURATION) {
                        break;
                    }

                    scanIndex++;
                }

                // Vehicle stayed stationary for 90+ seconds - END THE TRIP
                if (staysNearby && totalStoppedTime >= MIN_STOP_DURATION) {
                    const trip = await this.createTripFromPoints(currentTripStart, currentTripPoints);
                    if (trip) {
                        trips.push(trip);
                        console.log(`✅ [TripTimeline] Trip: ${trip.startLocation.clientName || trip.startLocation.address} → ${trip.endLocation.clientName || trip.endLocation.address} (${trip.duration.toFixed(1)}m, ${trip.distance.toFixed(2)}mi)`);
                    }

                    // Jump ahead past all the stationary points
                    i = scanIndex - 1; // -1 because loop will i++

                    // Reset for next trip
                    currentTripStart = null;
                    currentTripPoints = [];
                }
            }
        }

        // Handle incomplete trip at end of data
        if (currentTripStart && currentTripPoints.length > 1) {
            const trip = await this.createTripFromPoints(currentTripStart, currentTripPoints);
            if (trip) {
                trips.push(trip);
                console.log(`✅ [TripTimeline] Final trip: ${trip.startLocation.clientName || trip.startLocation.address} → ${trip.endLocation.clientName || trip.endLocation.address}`);
            }
        }

        console.log(`📊 [TripTimeline] Generated ${trips.length} trips from GPS data`);

        // Apply trip continuity logic: use previous trip's endLocation as next trip's startLocation
        // This eliminates GPS drift gaps - if you ended at Coler Crossing, next trip starts FROM Coler Crossing
        for (let i = 1; i < trips.length; i++) {
            const previousTrip = trips[i - 1];
            const currentTrip = trips[i];

            // Inherit previous trip's end location as this trip's start location
            console.log(`🔗 [TripTimeline] Trip continuity: Trip ${i + 1} starting from ${previousTrip.endLocation.clientName || previousTrip.endLocation.address}`);
            currentTrip.startLocation = {
                latitude: previousTrip.endLocation.latitude,
                longitude: previousTrip.endLocation.longitude,
                address: previousTrip.endLocation.address,
                clientName: previousTrip.endLocation.clientName,
                batteryLevel: currentTrip.startLocation.batteryLevel // Keep original battery level
            };
        }

        return trips;
    }
    
    /**
     * Find the next time the vehicle starts moving after a given index
     * NEW: Checks GPS distance, not just isMoving flag, to handle ignition cycling
     */
    private findNextMovementTime(routePoints: RoutePoint[], fromIndex: number): Date | null {
        const currentPoint = routePoints[fromIndex];
        const MOVEMENT_THRESHOLD = 0.05; // 50 meters - vehicle has truly left the location

        for (let i = fromIndex + 1; i < routePoints.length; i++) {
            const nextPoint = routePoints[i];

            // Calculate distance from current position
            const distance = this.calculateDistance(
                currentPoint.latitude,
                currentPoint.longitude,
                nextPoint.latitude,
                nextPoint.longitude
            );

            // Vehicle has moved away from this location (50+ meters)
            if (distance >= MOVEMENT_THRESHOLD) {
                return nextPoint.timestamp;
            }
        }
        return null;
    }
    
    /**
     * Create a Trip object from a series of route points
     */
    private async createTripFromPoints(startPoint: RoutePoint, tripPoints: RoutePoint[]): Promise<Trip | null> {
        if (tripPoints.length < 2) return null;
        
        const endPoint = tripPoints[tripPoints.length - 1];
        
        // Calculate total distance
        let totalDistance = 0;
        for (let i = 1; i < tripPoints.length; i++) {
            const prev = tripPoints[i - 1];
            const curr = tripPoints[i];
            totalDistance += this.calculateDistance(
                prev.latitude, prev.longitude,
                curr.latitude, curr.longitude
            );
        }

        // Skip very short trips (< 0.05 km / 50m) - filter out ignition cycling while allowing close client-to-client trips
        if (totalDistance < 0.05) {
            console.log(`⏭️ [TripTimeline] Skipping trip - too short (${(totalDistance * 1000).toFixed(0)}m)`);
            return null;
        }
        
        const duration = (endPoint.timestamp.getTime() - startPoint.timestamp.getTime()) / (1000 * 60);
        const batteryUsed = startPoint.batteryLevel && endPoint.batteryLevel 
            ? startPoint.batteryLevel - endPoint.batteryLevel 
            : 0;
        
        // Calculate speed metrics
        const speedValues = tripPoints.map(p => p.speed || 0).filter(s => s > 0);
        const maxSpeed = speedValues.length > 0 ? Math.max(...speedValues) : 0;
        const avgSpeed = duration > 0 ? (totalDistance / (duration / 60)) : 0; // km/h
        
        // Get location information (home base or client) and fresh geocoded addresses for start/end locations in parallel
        const [startLocationMatch, endLocationMatch, startAddress, endAddress] = await Promise.all([
            this.getCachedLocationMatch(startPoint.latitude, startPoint.longitude),
            this.getCachedLocationMatch(endPoint.latitude, endPoint.longitude),
            geocodingService.getAddress(startPoint.latitude, startPoint.longitude),
            geocodingService.getAddress(endPoint.latitude, endPoint.longitude)
        ]);

        // Determine display names for start/end locations
        const startClientName = startLocationMatch?.type === 'client' ? startLocationMatch.name :
                               startLocationMatch?.type === 'home_base' ? `🏠 ${startLocationMatch.name}` : undefined;
        const endClientName = endLocationMatch?.type === 'client' ? endLocationMatch.name :
                             endLocationMatch?.type === 'home_base' ? `🏠 ${endLocationMatch.name}` : undefined;

        // Use client/home base name as address if available, otherwise use geocoded street address
        const startDisplayAddress = startClientName || startAddress;
        const endDisplayAddress = endClientName || endAddress;

        return {
            id: `trip_${startPoint.vehicleId}_${startPoint.timestamp.getTime()}`,
            startTime: startPoint.timestamp,
            endTime: endPoint.timestamp,
            startLocation: {
                latitude: startPoint.latitude,
                longitude: startPoint.longitude,
                address: startDisplayAddress, // Use client name if available, otherwise geocoded address
                clientName: startClientName || undefined,
                batteryLevel: startPoint.batteryLevel
            },
            endLocation: {
                latitude: endPoint.latitude,
                longitude: endPoint.longitude,
                address: endDisplayAddress, // Use client name if available, otherwise geocoded address
                clientName: endClientName || undefined,
                batteryLevel: endPoint.batteryLevel
            },
            distance: Number((totalDistance / 1.609344).toFixed(2)), // Convert km to miles
            duration: Number(duration.toFixed(1)),
            batteryUsed: Number(batteryUsed.toFixed(1)),
            avgSpeed: Number(avgSpeed.toFixed(1)),
            maxSpeed: Number(maxSpeed.toFixed(1)),
            route: tripPoints
        };
    }
    
    /**
     * Get client location match with caching for performance (legacy method - use getCachedLocationMatch instead)
     */
    private async getCachedClientLocationMatch(latitude: number, longitude: number): Promise<string | null> {
        // Create a cache key based on coordinates rounded to ~10m precision
        const cacheKey = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;

        if (this.clientLocationCache.has(cacheKey)) {
            return this.clientLocationCache.get(cacheKey) || null;
        }

        const result = await clientLocationService.findClientLocationMatch(latitude, longitude);
        this.clientLocationCache.set(cacheKey, result);

        return result;
    }

    /**
     * Get location match (home base or client) with caching for performance
     */
    private async getCachedLocationMatch(latitude: number, longitude: number): Promise<{ type: 'home_base' | 'client'; name: string } | null> {
        // Create a cache key based on coordinates rounded to ~10m precision
        const cacheKey = `loc_${latitude.toFixed(4)},${longitude.toFixed(4)}`;

        if (this.locationMatchCache.has(cacheKey)) {
            return this.locationMatchCache.get(cacheKey) || null;
        }

        const result = await clientLocationService.findLocationMatch(latitude, longitude);
        this.locationMatchCache.set(cacheKey, result);

        return result;
    }
    
/**
     * Generate stops from the gaps BETWEEN trips
     * With movement-based trips, a stop is simply: trip ends → vehicle stationary → next trip starts
     */
    private async generateStopsBetweenTrips(trips: Trip[], routePoints: RoutePoint[]): Promise<Stop[]> {
        const stops: Stop[] = [];

        console.log(`🔍 [TripTimeline] Generating stops between ${trips.length} trips...`);

        // Create a stop for each gap between trips
        for (let i = 0; i < trips.length; i++) {
            const currentTrip = trips[i];
            const nextTrip = trips[i + 1];

            // Stop starts when current trip ends
            const stopStart = currentTrip.endTime;
            const stopLocation = currentTrip.endLocation;

            // Determine stop end time
            let stopEnd: Date;
            if (nextTrip) {
                // Stop ends when next trip starts
                stopEnd = nextTrip.startTime;
            } else {
                // Last trip of the day - check if vehicle is still parked there
                const lastPoint = routePoints[routePoints.length - 1];
                if (lastPoint && !lastPoint.isMoving) {
                    // Vehicle is still parked - use current time for ongoing stop
                    stopEnd = new Date();
                } else {
                    // Vehicle drove away - no final stop
                    continue;
                }
            }

            // Calculate stop duration
            const duration = (stopEnd.getTime() - stopStart.getTime()) / (1000 * 60);

            // Only create stops that are meaningful (> 90 seconds)
            if (duration > 1.5) {
                // Determine stop type
                const isHomeBase = stopLocation.clientName?.includes('🏠') || stopLocation.clientName?.includes('McRay Shop');
                const isClientLocation = stopLocation.clientName && !isHomeBase;

                const stopType: Stop['type'] = isClientLocation ? 'client_visit' :
                                                isHomeBase ? 'service_stop' : 'unknown_stop';

                // Skip mid-day returns to home base (but keep final stop)
                if (isHomeBase && nextTrip) {
                    console.log(`⏭️  [TripTimeline] Skipping mid-day home base stop (${duration.toFixed(1)}m)`);
                    continue;
                }

                const locationName = stopLocation.clientName || stopLocation.address || 'Unknown';

                stops.push({
                    id: `stop_${locationName.replace(/\s+/g, '_')}_${stopStart.getTime()}`,
                    startTime: stopStart,
                    endTime: stopEnd,
                    location: stopLocation,
                    duration: Number(duration.toFixed(1)),
                    batteryLevel: stopLocation.batteryLevel,
                    type: stopType
                });

                console.log(`🛑 [TripTimeline] Stop at ${locationName}: ${duration.toFixed(1)}m (${stopStart.toISOString().substr(11,8)} - ${stopEnd.toISOString().substr(11,8)})`);
            }
        }

        console.log(`✅ [TripTimeline] Generated ${stops.length} stops`);

        stops.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

        return stops;
    }
    
    /**
     * Calculate summary statistics
     */
    private calculateSummary(routePoints: RoutePoint[], events: TimelineEvent[], trips: Trip[]): Omit<TripTimeline['summary'], 'routePoints'> {
        if (routePoints.length === 0) {
            return {
                totalDistance: 0,
                totalDuration: 0,
                movingTime: 0,
                stoppedTime: 0,
                batteryUsed: 0,
                clientVisits: 0,
                avgSpeed: 0,
                maxSpeed: 0,
                totalTrips: 0
            };
        }
        
        const firstPoint = routePoints[0];
        const lastPoint = routePoints[routePoints.length - 1];
        
        // Calculate total distance
        let totalDistance = 0;
        for (let i = 1; i < routePoints.length; i++) {
            const prev = routePoints[i - 1];
            const curr = routePoints[i];
            totalDistance += this.calculateDistance(
                prev.latitude, prev.longitude,
                curr.latitude, curr.longitude
            );
        }
        
        // Calculate time metrics
        const totalDuration = (lastPoint.timestamp.getTime() - firstPoint.timestamp.getTime()) / (1000 * 60);
        const movingEvents = events.filter(e => e.type === 'moving' || e.type === 'departure');
        const stoppedEvents = events.filter(e => e.type === 'parked' || e.type === 'arrival');
        
        const movingTime = movingEvents.reduce((sum, e) => sum + (e.duration || 0), 0);
        const stoppedTime = stoppedEvents.reduce((sum, e) => sum + (e.duration || 0), 0);
        
        // Calculate battery usage
        const batteryUsed = firstPoint.batteryLevel && lastPoint.batteryLevel 
            ? firstPoint.batteryLevel - lastPoint.batteryLevel 
            : 0;
        
        // Count client visits
        const clientVisits = events.filter(e => e.metadata?.isClientLocation).length;
        
        // Calculate speed metrics
        const speedValues = routePoints.map(p => p.speed || 0).filter(s => s > 0);
        const maxSpeed = speedValues.length > 0 ? Math.max(...speedValues) : 0;
        const avgSpeed = totalDistance > 0 && movingTime > 0 
            ? (totalDistance / (movingTime / 60)) // km/h
            : 0;
        
        return {
            totalDistance: Number((totalDistance / 1.609344).toFixed(2)), // Convert km to miles
            totalDuration: Number(totalDuration.toFixed(1)),
            movingTime: Number(movingTime.toFixed(1)),
            stoppedTime: Number(stoppedTime.toFixed(1)),
            batteryUsed: Number(batteryUsed.toFixed(1)),
            clientVisits,
            avgSpeed: Number(avgSpeed.toFixed(1)),
            maxSpeed: Number(maxSpeed.toFixed(1)),
            totalTrips: trips.length
        };
    }
    
    /**
     * Calculate distance between two points using Haversine formula
     */
    private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const R = 6371; // Earth's radius in kilometers
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }
    
    /**
     * Get vehicle name from VIN
     */
    private getVehicleName(vehicleId: string): string {
        switch (vehicleId) {
            case '1FT6W1EV3PWG37779': return 'Lightning 2';
            case '1FTVW1EL3NWG00285': return 'Lightning 1';
            case '1FTBW1XK6PKA30591': return 'eTransit 1';
            case '1FTVW1EV3NWG07402': return 'Lightning 3';
            default: return `Vehicle ${vehicleId.slice(-4)}`;
        }
    }
}

export const tripTimelineService = new TripTimelineService();