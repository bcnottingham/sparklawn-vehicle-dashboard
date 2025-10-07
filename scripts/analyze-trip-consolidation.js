const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');

dotenv.config();

function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lng2 - lng1) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c; // Distance in meters
}

function simulateGpsBasedParking(routePoints, pointIndex) {
    // Look at 2.5 minutes of data around this point (adjusting from 5 minutes)
    const currentPoint = routePoints[pointIndex];
    const timeWindow = 2.5 * 60 * 1000; // 2.5 minutes in milliseconds

    const windowStart = new Date(currentPoint.timestamp.getTime() - timeWindow);
    const windowEnd = new Date(currentPoint.timestamp.getTime() + timeWindow);

    const pointsInWindow = routePoints.filter(p =>
        p.timestamp >= windowStart && p.timestamp <= windowEnd
    );

    if (pointsInWindow.length < 3) {
        return false; // Not enough data
    }

    // Calculate distances between consecutive points
    const distances = [];
    for (let i = 1; i < pointsInWindow.length; i++) {
        const prev = pointsInWindow[i-1];
        const curr = pointsInWindow[i];
        const distance = calculateDistance(
            prev.latitude, prev.longitude,
            curr.latitude, curr.longitude
        );
        distances.push(distance);
    }

    if (distances.length === 0) return false;

    const maxMovement = Math.max(...distances);
    const totalMovement = distances.reduce((sum, d) => sum + d, 0);
    const avgMovement = totalMovement / distances.length;

    // Time span check
    const timeSpan = pointsInWindow[pointsInWindow.length-1].timestamp.getTime() - pointsInWindow[0].timestamp.getTime();
    const hasBeenStationary = timeSpan >= 2.5 * 60 * 1000; // At least 2.5 minutes of data

    // Movement threshold analysis (more lenient thresholds)
    const isParkingMovement = maxMovement < 50 && avgMovement < 15; // 50m max, 15m average

    const isGpsParked = hasBeenStationary && isParkingMovement;

    if (isGpsParked) {
        return {
            isParked: true,
            maxMovement: maxMovement.toFixed(1),
            avgMovement: avgMovement.toFixed(1),
            timeSpan: (timeSpan/60000).toFixed(1),
            pointsAnalyzed: pointsInWindow.length
        };
    }

    return { isParked: false, maxMovement: maxMovement.toFixed(1), avgMovement: avgMovement.toFixed(1) };
}

function consolidateTrips(trips, routePoints) {
    console.log(`\n🔄 Simulating trip consolidation for ${trips.length} original trips...`);

    const consolidatedTrips = [];
    let currentTrip = null;

    for (const trip of trips) {
        const tripRoutePoints = trip.routePoints || [];

        if (tripRoutePoints.length === 0) {
            console.log(`   ⚠️ Skipping trip with no route points`);
            continue;
        }

        // For trips with very few points, assume they represent parking/stationary behavior
        if (tripRoutePoints.length <= 2) {
            console.log(`   🅿️ Trip ${trip._id} would be marked as PARKING (${tripRoutePoints.length} route points - likely stationary)`);
            // This trip would be ignored/merged with adjacent real trips
            continue;
        }

        // This is a legitimate trip
        if (!currentTrip) {
            currentTrip = {
                ...trip,
                consolidatedFrom: [trip._id],
                routePointsCount: tripRoutePoints.length
            };
        } else {
            // Merge with current trip if they're close in time (within 10 minutes)
            const timeDiff = Math.abs(new Date(trip.ignitionOnTime) - new Date(currentTrip.ignitionOffTime || currentTrip.ignitionOnTime));
            if (timeDiff <= 10 * 60 * 1000) { // 10 minutes
                console.log(`   🔗 Merging trip ${trip._id} with previous trip (${(timeDiff/60000).toFixed(1)}min gap)`);
                currentTrip.consolidatedFrom.push(trip._id);
                currentTrip.ignitionOffTime = trip.ignitionOffTime;
                currentTrip.routePointsCount += tripRoutePoints.length;
                if (trip.endLocation) {
                    currentTrip.endLocation = trip.endLocation;
                }
            } else {
                // Save current trip and start new one
                consolidatedTrips.push(currentTrip);
                currentTrip = {
                    ...trip,
                    consolidatedFrom: [trip._id],
                    routePointsCount: tripRoutePoints.length
                };
            }
        }
    }

    // Don't forget the last trip
    if (currentTrip) {
        consolidatedTrips.push(currentTrip);
    }

    return consolidatedTrips;
}

async function analyzeTripConsolidation() {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        console.error('❌ MONGODB_URI environment variable is required');
        process.exit(1);
    }

    const client = new MongoClient(mongoUri);

    try {
        await client.connect();
        console.log('✅ Connected to MongoDB');

        const db = client.db('sparklawn_fleet');

        // All Lightning VINs
        const lightningVINs = [
            { name: 'Lightning 1', vin: '1FTVW1EL3NWG00285' },
            { name: 'Lightning 2', vin: '1FT6W1EV3PWG37779' },
            { name: 'Lightning 3', vin: '1FTVW1EV3NWG07402' }
        ];

        // Today's date
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        console.log(`🔍 Analyzing trip consolidation impact for ${today.toDateString()}\n`);

        for (const lightning of lightningVINs) {
            console.log(`\n📍 ${lightning.name} (${lightning.vin}):`);

            // Get all route points for today
            const routePointsCollection = db.collection('route_points');
            const todaysRoutePoints = await routePointsCollection.find({
                vehicleId: lightning.vin,
                timestamp: {
                    $gte: today,
                    $lt: tomorrow
                }
            }).sort({ timestamp: 1 }).toArray();

            // Get all ignition trips for today
            const ignitionTripsCollection = db.collection('ignition_trips');
            const todaysTrips = await ignitionTripsCollection.find({
                vehicleId: lightning.vin,
                ignitionOnTime: {
                    $gte: today,
                    $lt: tomorrow
                }
            }).sort({ ignitionOnTime: 1 }).toArray();

            console.log(`   📊 Current state: ${todaysTrips.length} trips, ${todaysRoutePoints.length} route points`);

            if (todaysTrips.length === 0) {
                console.log('   ⚠️ No trips found for analysis');
                continue;
            }

            // Analyze current trip patterns
            const shortTrips = todaysTrips.filter(t => (t.routePoints || []).length <= 3);
            const mediumTrips = todaysTrips.filter(t => (t.routePoints || []).length > 3 && (t.routePoints || []).length <= 10);
            const longTrips = todaysTrips.filter(t => (t.routePoints || []).length > 10);

            console.log(`   📈 Trip breakdown:`);
            console.log(`     - Short trips (≤3 points): ${shortTrips.length}`);
            console.log(`     - Medium trips (4-10 points): ${mediumTrips.length}`);
            console.log(`     - Long trips (>10 points): ${longTrips.length}`);

            // Simulate consolidation
            const consolidatedTrips = consolidateTrips(todaysTrips, todaysRoutePoints);

            console.log(`\n   🎯 CONSOLIDATION IMPACT:`);
            console.log(`     Before: ${todaysTrips.length} trips`);
            console.log(`     After:  ${consolidatedTrips.length} trips`);
            console.log(`     Reduction: ${todaysTrips.length - consolidatedTrips.length} trips (${((todaysTrips.length - consolidatedTrips.length) / todaysTrips.length * 100).toFixed(1)}%)`);

            // Show the consolidated trips
            console.log(`\n   📋 Consolidated trip list:`);
            consolidatedTrips.forEach((trip, i) => {
                const startTime = trip.ignitionOnTime ? new Date(trip.ignitionOnTime).toLocaleTimeString() : 'unknown';
                const endTime = trip.ignitionOffTime ? new Date(trip.ignitionOffTime).toLocaleTimeString() : 'ongoing';
                const duration = trip.ignitionOnTime && trip.ignitionOffTime ?
                    ((new Date(trip.ignitionOffTime) - new Date(trip.ignitionOnTime)) / 60000).toFixed(0) : 'unknown';

                console.log(`     ${i+1}. ${startTime} - ${endTime} (${duration}min)`);
                console.log(`        Route points: ${trip.routePointsCount}`);
                console.log(`        Start: ${trip.startLocation?.address || 'unknown'}`);
                console.log(`        End: ${trip.endLocation?.address || 'unknown'}`);
                if (trip.consolidatedFrom.length > 1) {
                    console.log(`        💡 Consolidated from ${trip.consolidatedFrom.length} original trips`);
                }
            });

            // Calculate time savings
            const totalOriginalTime = todaysTrips.reduce((sum, trip) => {
                if (trip.ignitionOnTime && trip.ignitionOffTime) {
                    return sum + (new Date(trip.ignitionOffTime) - new Date(trip.ignitionOnTime));
                }
                return sum;
            }, 0);

            const totalConsolidatedTime = consolidatedTrips.reduce((sum, trip) => {
                if (trip.ignitionOnTime && trip.ignitionOffTime) {
                    return sum + (new Date(trip.ignitionOffTime) - new Date(trip.ignitionOnTime));
                }
                return sum;
            }, 0);

            if (totalOriginalTime > 0 && totalConsolidatedTime > 0) {
                console.log(`\n   ⏱️ Total trip time:`);
                console.log(`     Original: ${(totalOriginalTime / 60000).toFixed(0)} minutes`);
                console.log(`     Consolidated: ${(totalConsolidatedTime / 60000).toFixed(0)} minutes`);
                console.log(`     Time difference: ${((totalConsolidatedTime - totalOriginalTime) / 60000).toFixed(0)} minutes`);
            }
        }

        console.log(`\n🎉 Analysis complete! This shows what the GPS-based parking detection would achieve.`);
        console.log(`💡 The logic would consolidate fragmented trips into meaningful journeys.`);

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await client.close();
        console.log('🔌 MongoDB connection closed');
    }
}

analyzeTripConsolidation();