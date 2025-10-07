import { MongoClient } from 'mongodb';
import { fordTelematicsClient } from '../src/services/fordTelematicsClient';

// Vehicle UUID to VIN mapping
const uuidToVinMap = new Map([
    ['35658624-018d-4041-ab6b-fa396f06af16', '1FT6W1EV3PWG37779'], // Lightning 1
    ['810bd9c5-a531-4984-8e5b-c59ef8a4a47c', '1FTBW1XK6PKA30591'], // eTransit Van
    ['2dc0332a-d8fc-4ef8-b0e3-31ec20caeee0', '1FTVW1EV3NWG07402'], // Lightning XLT
    ['c0a4d743-eb5d-4dd8-8ce2-1216bf359bda', '1FTVW1EL3NWG00285']  // Lightning 2
]);

interface IgnitionTrip {
    _id?: string;
    vehicleId: string;
    vehicleName: string;
    ignitionOnTime: Date;
    ignitionOffTime?: Date;
    distanceTraveled?: number;
}

async function getAccurateTripDistance(trip: IgnitionTrip): Promise<number | null> {
    try {
        const vehicleVin = uuidToVinMap.get(trip.vehicleId) || trip.vehicleId;

        const startTime = trip.ignitionOnTime.toISOString().substring(0, 19) + 'Z';
        const endTime = trip.ignitionOffTime?.toISOString().substring(0, 19) + 'Z' || new Date().toISOString().substring(0, 19) + 'Z';

        console.log(`🔍 Getting Ford API trip distance for ${trip.vehicleName} (VIN: ${vehicleVin}): ${startTime} to ${endTime}`);

        const fordTrips = await fordTelematicsClient.instance.getVehicleTrips(vehicleVin, startTime, endTime, 10);

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
            console.log(`✅ Found Ford API trip distance: ${distanceInMiles.toFixed(2)} miles (was inflated GPS: ${trip.distanceTraveled?.toFixed(2) || 'unknown'} miles)`);
            return distanceInMiles;
        }

        console.log(`⚠️ No matching Ford API trip found for ${trip.vehicleName}`);
        return null;

    } catch (error) {
        console.warn(`⚠️ Failed to get Ford API trip distance for ${trip.vehicleName}:`, error);
        return null;
    }
}

async function fixTripDistances() {
    console.log('🔧 Starting trip distance correction using Ford API...');

    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        console.error('❌ MONGODB_URI environment variable is required');
        process.exit(1);
    }

    const client = new MongoClient(mongoUri);

    try {
        await client.connect();
        console.log('✅ Connected to MongoDB');

        const db = client.db('sparklawn-fleet');
        const tripsCollection = db.collection('ignition_trips');

        // Get all trips from today that have inflated distances (>10 miles)
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const inflatedTrips = await tripsCollection.find({
            ignitionOnTime: { $gte: today },
            distanceTraveled: { $gt: 10 }, // Likely inflated trips
            ignitionOffTime: { $exists: true, $ne: null }
        }).toArray() as IgnitionTrip[];

        console.log(`🔍 Found ${inflatedTrips.length} potentially inflated trips from today`);

        let fixedCount = 0;
        let skippedCount = 0;

        for (const trip of inflatedTrips) {
            console.log(`\n📍 Processing trip: ${trip.vehicleName} at ${trip.ignitionOnTime.toISOString()}`);
            console.log(`   Current distance: ${trip.distanceTraveled?.toFixed(2) || 'unknown'} miles`);

            const accurateDistance = await getAccurateTripDistance(trip);

            if (accurateDistance !== null && accurateDistance !== trip.distanceTraveled) {
                // Update the trip with accurate distance
                await tripsCollection.updateOne(
                    { _id: trip._id },
                    {
                        $set: {
                            distanceTraveled: accurateDistance,
                            lastUpdated: new Date(),
                            distanceSource: 'ford-api-corrected'
                        }
                    }
                );

                console.log(`✅ Updated ${trip.vehicleName}: ${trip.distanceTraveled?.toFixed(2)} → ${accurateDistance.toFixed(2)} miles`);
                fixedCount++;
            } else {
                console.log(`⏭️ Skipped ${trip.vehicleName}: No Ford API data available`);
                skippedCount++;
            }

            // Rate limit to avoid API overload
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        console.log(`\n🎯 Trip distance correction complete:`);
        console.log(`   ✅ Fixed: ${fixedCount} trips`);
        console.log(`   ⏭️ Skipped: ${skippedCount} trips`);
        console.log(`   📊 Total processed: ${inflatedTrips.length} trips`);

    } catch (error) {
        console.error('❌ Error fixing trip distances:', error);
    } finally {
        await client.close();
        console.log('🔌 MongoDB connection closed');
    }
}

// Run the script if executed directly
if (require.main === module) {
    fixTripDistances().then(() => {
        console.log('🏁 Script completed');
        process.exit(0);
    }).catch(error => {
        console.error('💥 Script failed:', error);
        process.exit(1);
    });
}