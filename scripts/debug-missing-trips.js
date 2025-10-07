const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');

dotenv.config();

async function debugMissingTrips() {
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

        // Lightning 1 VIN
        const lightning1VIN = '1FTVW1EL3NWG00285';

        // Today's date for checking
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        console.log(`🔍 Checking data for Lightning 1 (${lightning1VIN}) on ${today.toDateString()}`);

        // Check route points for today
        const routePointsCollection = db.collection('route_points');
        const todaysRoutePoints = await routePointsCollection.find({
            vehicleId: lightning1VIN,
            timestamp: {
                $gte: today,
                $lt: tomorrow
            }
        }).sort({ timestamp: 1 }).toArray();

        console.log(`📍 Found ${todaysRoutePoints.length} route points for today`);

        if (todaysRoutePoints.length > 0) {
            console.log(`   First: ${todaysRoutePoints[0].timestamp} at ${todaysRoutePoints[0].latitude}, ${todaysRoutePoints[0].longitude}`);
            console.log(`   Last: ${todaysRoutePoints[todaysRoutePoints.length-1].timestamp} at ${todaysRoutePoints[todaysRoutePoints.length-1].latitude}, ${todaysRoutePoints[todaysRoutePoints.length-1].longitude}`);

            // Look for gaps in route points around the missing trip times
            console.log('\n⏰ Route point timeline (showing coordinates and times):');
            todaysRoutePoints.forEach((point, i) => {
                const time = new Date(point.timestamp).toLocaleTimeString();
                console.log(`   ${time}: (${point.latitude}, ${point.longitude}) - ignition: ${point.ignitionStatus}`);

                // Check for gaps > 30 minutes
                if (i > 0) {
                    const prevTime = new Date(todaysRoutePoints[i-1].timestamp);
                    const currentTime = new Date(point.timestamp);
                    const gapMinutes = (currentTime - prevTime) / (1000 * 60);

                    if (gapMinutes > 30) {
                        console.log(`   ⚠️  GAP: ${gapMinutes.toFixed(1)} minutes between points`);
                    }
                }
            });
        }

        // Check ignition trips for today
        const ignitionTripsCollection = db.collection('ignition_trips');
        const todaysTrips = await ignitionTripsCollection.find({
            vehicleId: lightning1VIN,
            ignitionOnTime: {
                $gte: today,
                $lt: tomorrow
            }
        }).sort({ ignitionOnTime: 1 }).toArray();

        console.log(`\n🚗 Found ${todaysTrips.length} ignition trips for today:`);
        todaysTrips.forEach((trip, i) => {
            const startTime = trip.ignitionOnTime ? new Date(trip.ignitionOnTime).toLocaleTimeString() : 'unknown';
            const endTime = trip.ignitionOffTime ? new Date(trip.ignitionOffTime).toLocaleTimeString() : 'ongoing';
            const routePointsCount = trip.routePoints ? trip.routePoints.length : 0;

            console.log(`   Trip ${i+1}: ${startTime} - ${endTime}`);
            console.log(`     Route points: ${routePointsCount}`);
            console.log(`     Start location: ${trip.startLocation?.address || 'unknown'}`);
            console.log(`     Active: ${trip.isActive}`);

            if (trip.routePoints && trip.routePoints.length > 0) {
                const lastPoint = trip.routePoints[trip.routePoints.length - 1];
                console.log(`     Last point: (${lastPoint.latitude}, ${lastPoint.longitude})`);
            }
        });

        // Check telematics signals during specific gap periods
        // Gap period: around 11:56 to 14:16 (2h 20m gap mentioned by user)
        const gapStart = new Date(today);
        gapStart.setHours(11, 56, 0, 0);
        const gapEnd = new Date(today);
        gapEnd.setHours(14, 16, 0, 0);

        console.log(`\n🔍 Checking telematics signals during gap period (11:56 - 14:16):`);
        const telematicsCollection = db.collection('telematics_signals');
        const gapPeriodSignals = await telematicsCollection.find({
            vin: lightning1VIN,
            ts: {
                $gte: gapStart,
                $lte: gapEnd
            }
        }).sort({ ts: 1 }).limit(20).toArray();

        console.log(`📡 Found ${gapPeriodSignals.length} telematics signals during gap period`);
        gapPeriodSignals.forEach(signal => {
            const time = new Date(signal.ts).toLocaleTimeString();
            console.log(`   ${time}: (${signal.latitude}, ${signal.longitude}) - ignition: ${signal.ignition}`);
        });

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await client.close();
        console.log('🔌 MongoDB connection closed');
    }
}

debugMissingTrips();