import { MongoClient, Db, Collection } from 'mongodb';
import { RoutePoint, IgnitionTrip } from './backgroundMonitoringService';
import { hybridVehicleClient } from './hybridVehicleClient';
import { geocodingService } from './geocoding';
// Ford API removed - using MongoDB only

export interface MissedTripCandidate {
    vehicleId: string;
    vehicleName: string;
    estimatedStartTime: Date;
    estimatedEndTime: Date;
    startLocation: { latitude: number; longitude: number; address?: string };
    endLocation: { latitude: number; longitude: number; address?: string };
    distance: number;
    batteryDrain: number;
    confidence: number; // 0-100%
    reconstructionMethod: 'location_jump' | 'battery_drain' | 'time_gap' | 'mongodb_analysis';
}

export class TripReconstructionService {
    private client!: MongoClient;
    private db!: Db;
    private routePointsCollection!: Collection<RoutePoint>;
    private tripsCollection!: Collection<IgnitionTrip>;
    
    // Vehicle ID to VIN mapping for Ford Telematics API
    private readonly uuidToVinMap: Map<string, string> = new Map([
        ['35658624-018d-4041-ab6b-fa396f06af16', '1FT6W1EV3PWG37779'], // Lightning 1
        ['810bd9c5-a531-4984-8e5b-c59ef8a4a47c', '1FTBW1XK6PKA30591'], // eTransit Van
        ['2dc0332a-d8fc-4ef8-b0e3-31ec20caeee0', '1FTVW1EV3NWG07402'], // Lightning XLT
        ['c0a4d743-eb5d-4dd8-8ce2-1216bf359bda', '1FTVW1EL3NWG00285']  // Lightning 2
    ]);
    
    constructor() {
        this.connect();
    }
    
    private async connect(): Promise<void> {
        try {
            const mongoUri = process.env.MONGODB_URI;
            if (!mongoUri) {
                console.warn('⚠️ MONGODB_URI not configured - trip reconstruction service disabled');
                return;
            }
            
            this.client = new MongoClient(mongoUri);
            await this.client.connect();
            this.db = this.client.db('sparklawn');
            
            this.routePointsCollection = this.db.collection<RoutePoint>('route_points');
            this.tripsCollection = this.db.collection<IgnitionTrip>('ignition_trips');
            
            console.log('✅ Trip reconstruction service connected to MongoDB');
        } catch (error) {
            console.error('❌ Failed to connect trip reconstruction service:', error);
            throw error;
        }
    }
    
    /**
     * Analyze historical data to find missed trips
     * Enhanced with Ford Telematics integration for accurate timestamps
     */
    async findMissedTrips(startDate: Date = new Date(Date.now() - 24 * 60 * 60 * 1000)): Promise<MissedTripCandidate[]> {
        console.log(`🔍 Analyzing MongoDB data since ${startDate.toISOString()} for missed trips...`);
        console.log(`📊 Using MongoDB-only trip reconstruction`);

        const vehiclesResponse = await hybridVehicleClient.getVehiclesWithDetails();
        const vehicles = vehiclesResponse.vehicles;
        const candidates: MissedTripCandidate[] = [];

        for (const vehicle of vehicles) {
            try {
                console.log(`🚗 Analyzing ${vehicle.name} (${vehicle.id})...`);

                // Analyze MongoDB data only
                const mongoDbCandidates = await this.analyzeVehicleForMissedTrips(vehicle.id, vehicle.name, startDate);
                candidates.push(...mongoDbCandidates);

                console.log(`  📈 MongoDB candidates: ${mongoDbCandidates.length}`);

            } catch (error) {
                console.error(`❌ Error analyzing vehicle ${vehicle.name}:`, error);
            }
        }

        // Sort by confidence
        candidates.sort((a, b) => {
            return b.confidence - a.confidence || b.estimatedStartTime.getTime() - a.estimatedStartTime.getTime();
        });

        console.log(`🎯 Found ${candidates.length} missed trip candidates from MongoDB`);
        return candidates;
    }
    
    // Ford API calls removed - using MongoDB only
    
    private async analyzeVehicleForMissedTrips(vehicleId: string, vehicleName: string, since: Date): Promise<MissedTripCandidate[]> {
        const candidates: MissedTripCandidate[] = [];
        
        // Get all route points for this vehicle since the start date
        const routePoints = await this.routePointsCollection
            .find({ 
                vehicleId: vehicleId,
                timestamp: { $gte: since }
            })
            .sort({ timestamp: 1 })
            .toArray();
            
        if (routePoints.length < 2) {
            console.log(`⚠️ Not enough data points for ${vehicleName} (${routePoints.length} points)`);
            return candidates;
        }
        
        // Analyze for location jumps (teleportation = missed trip)
        for (let i = 1; i < routePoints.length; i++) {
            const prevPoint = routePoints[i - 1];
            const currPoint = routePoints[i];
            
            const distance = this.calculateDistance(
                prevPoint.latitude, prevPoint.longitude,
                currPoint.latitude, currPoint.longitude
            );
            
            const timeDiff = currPoint.timestamp.getTime() - prevPoint.timestamp.getTime();
            const timeDiffMinutes = timeDiff / (1000 * 60);
            
            // Detect significant location jumps
            if (distance > 100 && timeDiffMinutes > 5) { // More than 100m in more than 5 minutes
                const batteryDrain = (prevPoint.batteryLevel || 0) - (currPoint.batteryLevel || 0);
                const speed = distance / (timeDiffMinutes / 60); // meters per hour
                
                // Calculate confidence based on multiple factors
                let confidence = 0;
                
                // Distance factor (longer distances are more likely to be real trips)
                confidence += Math.min(distance / 1000 * 20, 40); // Up to 40 points for 2km+
                
                // Battery drain factor (more drain = more confidence)
                confidence += Math.min(batteryDrain * 10, 30); // Up to 30 points for 3%+ drain
                
                // Time gap factor (reasonable time gaps increase confidence)
                if (timeDiffMinutes > 10 && timeDiffMinutes < 180) { // 10 min to 3 hours
                    confidence += 20;
                }
                
                // Speed reasonableness (not too fast, not too slow)
                if (speed > 500 && speed < 50000) { // 0.5-50 km/h reasonable for driving
                    confidence += 10;
                }
                
                if (confidence > 40) { // Only report high-confidence candidates
                    candidates.push({
                        vehicleId,
                        vehicleName,
                        estimatedStartTime: prevPoint.timestamp,
                        estimatedEndTime: currPoint.timestamp,
                        startLocation: {
                            latitude: prevPoint.latitude,
                            longitude: prevPoint.longitude,
                            address: await geocodingService.getAddress(prevPoint.latitude, prevPoint.longitude)
                        },
                        endLocation: {
                            latitude: currPoint.latitude,
                            longitude: currPoint.longitude,
                            address: await geocodingService.getAddress(currPoint.latitude, currPoint.longitude)
                        },
                        distance: distance / 1000, // Convert to km
                        batteryDrain,
                        confidence: Math.round(confidence),
                        reconstructionMethod: 'location_jump'
                    });
                    
                    console.log(`🚗 MISSED TRIP DETECTED: ${vehicleName}`);
                    console.log(`   📍 From: ${prevPoint.address || 'Unknown'}`);
                    console.log(`   📍 To: ${currPoint.address || 'Unknown'}`);
                    console.log(`   📏 Distance: ${(distance/1000).toFixed(1)}km`);
                    console.log(`   🔋 Battery drain: ${batteryDrain.toFixed(1)}%`);
                    console.log(`   ⏰ Duration gap: ${timeDiffMinutes.toFixed(1)} minutes`);
                    console.log(`   🎯 Confidence: ${Math.round(confidence)}%`);
                }
            }
        }
        
        return candidates;
    }
    
    /**
     * Convert a missed trip candidate into a proper trip record
     * Uses MongoDB-derived timing data
     */
    async reconstructTrip(candidate: MissedTripCandidate): Promise<IgnitionTrip> {
        const dataSource = 'trip-reconstruction';

        console.log(`🔧 Reconstructing trip for ${candidate.vehicleName}...`);
        console.log(`   📊 Using MongoDB timing data`);
        console.log(`   🎯 Confidence: ${candidate.confidence}%`);

        // Calculate trip duration and distance from MongoDB data
        const tripDistance = candidate.distance;
        const startOdometer = 0;
        const endOdometer = 0;
        
        const trip: IgnitionTrip = {
            vehicleId: candidate.vehicleId,
            vehicleName: candidate.vehicleName,
            ignitionOnTime: candidate.estimatedStartTime,
            ignitionOffTime: candidate.estimatedEndTime,
            totalRunTime: (candidate.estimatedEndTime.getTime() - candidate.estimatedStartTime.getTime()) / (1000 * 60),
            isActive: false,
            startLocation: {
                latitude: candidate.startLocation.latitude,
                longitude: candidate.startLocation.longitude,
                address: candidate.startLocation.address || 'Unknown Location'
            },
            endLocation: {
                latitude: candidate.endLocation.latitude,
                longitude: candidate.endLocation.longitude,
                address: candidate.endLocation.address || 'Unknown Location'
            },
            startOdometer,
            endOdometer,
            distanceTraveled: tripDistance,
            batteryUsed: candidate.batteryDrain,
            routePoints: [
                {
                    vehicleId: candidate.vehicleId,
                    timestamp: candidate.estimatedStartTime,
                    latitude: candidate.startLocation.latitude,
                    longitude: candidate.startLocation.longitude,
                    ignitionStatus: 'On',
                    address: candidate.startLocation.address,
                    isMoving: true,
                    dataSource
                },
                {
                    vehicleId: candidate.vehicleId,
                    timestamp: candidate.estimatedEndTime,
                    latitude: candidate.endLocation.latitude,
                    longitude: candidate.endLocation.longitude,
                    ignitionStatus: 'Off',
                    address: candidate.endLocation.address,
                    isMoving: false,
                    dataSource
                }
            ],
            totalStops: 0,
            dataSource: 'hybrid', // MongoDB-derived reconstruction
            lastUpdated: new Date()
        };
        
        // Insert reconstructed trip
        const result = await this.tripsCollection.insertOne(trip as any);
        trip._id = result.insertedId?.toString();
        
        console.log(`✅ Trip reconstruction completed for ${candidate.vehicleName}`);
        console.log(`   📅 Trip Start: ${candidate.estimatedStartTime.toISOString()}`);
        console.log(`   📅 Trip End: ${candidate.estimatedEndTime.toISOString()}`);
        console.log(`   ⏱️ Duration: ${(trip.totalRunTime || 0).toFixed(1)} minutes`);
        console.log(`   📏 Distance: ${tripDistance} km`);
        console.log(`   📊 Data Source: ${trip.dataSource} (MongoDB analysis)`);

        return trip;
    }
    
    // Ford API validation removed - MongoDB is single source of truth
    
    private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const R = 6371000; // Earth's radius in meters
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }
}

export const tripReconstructionService = new TripReconstructionService();