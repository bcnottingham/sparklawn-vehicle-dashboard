const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');

dotenv.config();

async function debugGapPeriod() {
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

        // Gap period: 11:56 AM to 14:16 PM
        const gapStart = new Date(today);
        gapStart.setHours(11, 56, 0, 0);
        const gapEnd = new Date(today);
        gapEnd.setHours(14, 16, 0, 0);

        console.log(`🔍 Checking gap period: ${gapStart.toLocaleTimeString()} - ${gapEnd.toLocaleTimeString()}`);

        for (const lightning of lightningVINs) {
            console.log(`\n📍 ${lightning.name} (${lightning.vin}):`);

            // Check route points during gap period
            const routePointsCollection = db.collection('route_points');
            const gapRoutePoints = await routePointsCollection.find({
                vehicleId: lightning.vin,
                timestamp: {
                    $gte: gapStart,
                    $lte: gapEnd
                }
            }).sort({ timestamp: 1 }).toArray();

            console.log(`   Found ${gapRoutePoints.length} route points during gap period`);

            if (gapRoutePoints.length === 0) {
                console.log('   ❌ NO DATA during gap period - this explains the missing trip!');
            } else {
                console.log(`   ✅ Route points exist:`);

                // Show first and last points
                console.log(`     First: ${gapRoutePoints[0].timestamp.toLocaleTimeString()} at (${gapRoutePoints[0].latitude}, ${gapRoutePoints[0].longitude}) - ignition: ${gapRoutePoints[0].ignitionStatus}`);
                console.log(`     Last:  ${gapRoutePoints[gapRoutePoints.length-1].timestamp.toLocaleTimeString()} at (${gapRoutePoints[gapRoutePoints.length-1].latitude}, ${gapRoutePoints[gapRoutePoints.length-1].longitude}) - ignition: ${gapRoutePoints[gapRoutePoints.length-1].ignitionStatus}`);

                // Look for movement (ignition on periods)
                const ignitionOnPoints = gapRoutePoints.filter(p => p.ignitionStatus === 'On');
                console.log(`     Ignition ON points: ${ignitionOnPoints.length}`);

                if (ignitionOnPoints.length > 0) {
                    console.log(`     Movement detected from ${ignitionOnPoints[0].timestamp.toLocaleTimeString()} to ${ignitionOnPoints[ignitionOnPoints.length-1].timestamp.toLocaleTimeString()}`);

                    // Check if they reached Jurgensmeyers area (around 36.303, -94.198)
                    const jurgensmeyers = { lat: 36.303, lng: -94.198 };
                    const nearJurgensmeyers = gapRoutePoints.filter(p => {
                        const distance = Math.sqrt(Math.pow(p.latitude - jurgensmeyers.lat, 2) + Math.pow(p.longitude - jurgensmeyers.lng, 2));
                        return distance < 0.01; // roughly 1km radius
                    });

                    if (nearJurgensmeyers.length > 0) {
                        console.log(`     🎯 Found ${nearJurgensmeyers.length} points near Jurgensmeyers area!`);
                        console.log(`         At: ${nearJurgensmeyers[0].timestamp.toLocaleTimeString()} - (${nearJurgensmeyers[0].latitude}, ${nearJurgensmeyers[0].longitude})`);
                    } else {
                        console.log(`     ❌ No points near Jurgensmeyers area found`);
                    }
                }
            }

            // Also check ignition trips during this period
            const ignitionTripsCollection = db.collection('ignition_trips');
            const gapTrips = await ignitionTripsCollection.find({
                vehicleId: lightning.vin,
                $or: [
                    { ignitionOnTime: { $gte: gapStart, $lte: gapEnd } },
                    { ignitionOffTime: { $gte: gapStart, $lte: gapEnd } },
                    {
                        ignitionOnTime: { $lt: gapStart },
                        $or: [
                            { ignitionOffTime: { $gt: gapEnd } },
                            { ignitionOffTime: null },
                            { isActive: true }
                        ]
                    }
                ]
            }).sort({ ignitionOnTime: 1 }).toArray();

            console.log(`   Ignition trips overlapping gap period: ${gapTrips.length}`);
            gapTrips.forEach(trip => {
                const start = trip.ignitionOnTime ? trip.ignitionOnTime.toLocaleTimeString() : 'unknown';
                const end = trip.ignitionOffTime ? trip.ignitionOffTime.toLocaleTimeString() : 'ongoing';
                console.log(`     ${start} - ${end} (${trip.routePoints ? trip.routePoints.length : 0} route points)`);
            });
        }

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await client.close();
        console.log('🔌 MongoDB connection closed');
    }
}

debugGapPeriod();