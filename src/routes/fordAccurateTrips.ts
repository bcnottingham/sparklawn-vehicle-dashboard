import { Router } from 'express';
import { clientLocationService } from '../services/clientLocations';
import { geocodingService } from '../services/geocoding';

const router = Router();

// Vehicle VIN to friendly name mapping (UUID logic removed - Ford Telematics uses VINs)
const vinToNameMap = new Map([
    ['1FT6W1EV3PWG37779', 'Lightning 2'],
    ['1FTBW1XK6PKA30591', 'eTransit Van'],
    ['1FTVW1EV3NWG07402', 'Lightning XLT'],
    ['1FTVW1EL3NWG00285', 'Lightning 1']
]);

// Get today's trips with Ford API accurate distances (no GPS inflation)
router.get('/today', async (req, res) => {
    try {
        console.log('🔍 Getting Ford API historical trips for today...');

        // Get today's date range for Ford API query
        const today = new Date();
        const startOfDay = new Date(today);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(today);
        endOfDay.setHours(23, 59, 59, 999);

        const startTime = startOfDay.toISOString().substring(0, 19) + 'Z';
        const endTime = endOfDay.toISOString().substring(0, 19) + 'Z';

        console.log(`📅 Querying Ford API for trips between ${startTime} and ${endTime}`);

        // Import Ford client to get historical trips
        const { fordTelematicsClient } = await import('../services/fordTelematicsClient');

        const allTrips: any[] = [];

        // Get trips for each vehicle from Ford API using VINs only
        for (const [vin, vehicleName] of vinToNameMap.entries()) {
            try {
                console.log(`🚗 Getting Ford API trips for ${vehicleName} (${vin})...`);
                const fordTrips = await fordTelematicsClient.instance.getVehicleTrips(vin, startTime, endTime, 10);

                console.log(`📊 Found ${fordTrips.length} Ford API trips for ${vehicleName}`);

                // Convert Ford API trips to our format
                fordTrips.forEach((fordTrip: any, index: number) => {
                    // Ford API returns trip_distance in snake_case format (km)
                    const distance = fordTrip.trip_distance || fordTrip.tripDistance || fordTrip.distance || fordTrip.totalDistance || 0;

                    if (distance > 0) {
                        const distanceInMiles = distance * 0.621371; // Convert km to miles
                        const startTimestamp = new Date(fordTrip.trip_start_time || fordTrip.tripStartTime || fordTrip.startTime || fordTrip.start);
                        const endTimestamp = new Date(fordTrip.trip_end_time || fordTrip.tripEndTime || fordTrip.endTime || fordTrip.end);
                        const durationMinutes = Math.round((endTimestamp.getTime() - startTimestamp.getTime()) / (1000 * 60));

                        console.log(`✅ Ford API trip: ${vehicleName} - ${distanceInMiles.toFixed(2)} miles, ${durationMinutes} min`);

                        allTrips.push({
                            _id: `ford-${vin}-${fordTrip.tripStartTime || fordTrip.startTime || Date.now()}`,
                            vehicleId: vin, // Use VIN instead of UUID
                            vehicleName: vehicleName,
                            ignitionOnTime: startTimestamp,
                            ignitionOffTime: endTimestamp,
                            distanceTraveled: distanceInMiles,
                            totalRunTime: durationMinutes,
                            batteryUsed: 0, // Ford API doesn't provide this
                            isActive: false,
                            dataSource: 'ford-api-historical',
                            startLocation: {
                                address: 'Ford API Location',
                                latitude: fordTrip.startPosition?.latitude || 0,
                                longitude: fordTrip.startPosition?.longitude || 0
                            },
                            endLocation: {
                                address: 'Ford API Location',
                                latitude: fordTrip.endPosition?.latitude || 0,
                                longitude: fordTrip.endPosition?.longitude || 0
                            }
                        });
                    } else {
                        console.log(`❌ Skipping Ford trip: distance is ${distance}`);
                    }
                });

            } catch (error) {
                console.warn(`⚠️ Failed to get Ford API trips for ${vehicleName}:`, error);
            }
        }

        // Get route points from MongoDB to find actual start/end coordinates
        console.log(`📍 Fetching route points from MongoDB to get actual coordinates...`);
        const { getDatabase } = await import('../db/index');
        const db = await getDatabase();
        const routePointsCollection = db.collection('routePoints');

        // Enrich each trip with actual coordinates from route points
        for (const trip of allTrips) {
            try {
                // Find route points for this trip timeframe (±5 minutes buffer)
                const tripStart = new Date(trip.ignitionOnTime);
                const tripEnd = new Date(trip.ignitionOffTime);
                const startBuffer = new Date(tripStart.getTime() - 5 * 60 * 1000);
                const endBuffer = new Date(tripEnd.getTime() + 5 * 60 * 1000);

                // Get first route point (trip start)
                const startPoint = await routePointsCollection.findOne({
                    vehicleId: trip.vehicleId,
                    timestamp: { $gte: startBuffer, $lte: new Date(tripStart.getTime() + 5 * 60 * 1000) }
                }, {
                    sort: { timestamp: 1 }
                });

                // Get last route point (trip end)
                const endPoint = await routePointsCollection.findOne({
                    vehicleId: trip.vehicleId,
                    timestamp: { $gte: new Date(tripEnd.getTime() - 5 * 60 * 1000), $lte: endBuffer }
                }, {
                    sort: { timestamp: -1 }
                });

                if (startPoint && startPoint.latitude && startPoint.longitude) {
                    trip.startLocation.latitude = startPoint.latitude;
                    trip.startLocation.longitude = startPoint.longitude;
                    trip.startLocation.address = startPoint.address || 'Unknown Location';
                    console.log(`✅ Found start coordinates for ${trip.vehicleName}: ${startPoint.latitude}, ${startPoint.longitude}`);
                }

                if (endPoint && endPoint.latitude && endPoint.longitude) {
                    trip.endLocation.latitude = endPoint.latitude;
                    trip.endLocation.longitude = endPoint.longitude;
                    trip.endLocation.address = endPoint.address || 'Unknown Location';
                    console.log(`✅ Found end coordinates for ${trip.vehicleName}: ${endPoint.latitude}, ${endPoint.longitude}`);
                }
            } catch (error) {
                console.warn(`⚠️ Failed to get route points for trip ${trip._id}:`, error);
            }
        }

        // Enrich trips with addresses and client correlation
        console.log(`📍 Enriching ${allTrips.length} trips with addresses and client correlation...`);

        for (const trip of allTrips) {
            // Process start location
            if (trip.startLocation.latitude && trip.startLocation.longitude) {
                // First try client correlation
                const startMatch = await clientLocationService.findLocationMatch(
                    trip.startLocation.latitude,
                    trip.startLocation.longitude
                );

                if (startMatch) {
                    trip.startLocation.address = startMatch.name;
                    if (startMatch.type === 'client') {
                        trip.startLocation.clientName = startMatch.name;
                    }
                } else {
                    // Fallback to Google Places API geocoding
                    const startGeocode = await geocodingService.getAddress(
                        trip.startLocation.latitude,
                        trip.startLocation.longitude
                    );
                    if (startGeocode) {
                        trip.startLocation.address = startGeocode;
                    }
                }
            }

            // Process end location
            if (trip.endLocation.latitude && trip.endLocation.longitude) {
                // First try client correlation
                const endMatch = await clientLocationService.findLocationMatch(
                    trip.endLocation.latitude,
                    trip.endLocation.longitude
                );

                if (endMatch) {
                    trip.endLocation.address = endMatch.name;
                    if (endMatch.type === 'client') {
                        trip.endLocation.clientName = endMatch.name;
                    }
                } else {
                    // Fallback to Google Places API geocoding
                    const endGeocode = await geocodingService.getAddress(
                        trip.endLocation.latitude,
                        trip.endLocation.longitude
                    );
                    if (endGeocode) {
                        trip.endLocation.address = endGeocode;
                    }
                }
            }
        }

        console.log(`✅ Address enrichment complete`);

        // Calculate totals from Ford API historical data
        const totalDistance = allTrips.reduce((sum, trip) => sum + trip.distanceTraveled, 0);
        const totalDriveTime = allTrips.reduce((sum, trip) => sum + trip.totalRunTime, 0);

        console.log(`✅ Ford API historical summary: ${allTrips.length} trips, ${totalDistance.toFixed(2)} miles, ${totalDriveTime} minutes`);

        res.json({
            trips: allTrips,
            count: allTrips.length,
            totalDistance: totalDistance,
            totalDriveTime: totalDriveTime,
            source: 'ford-api-historical',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error getting Ford API historical trips:', error);
        res.status(500).json({
            error: 'Failed to get Ford API historical trip data',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export default router;