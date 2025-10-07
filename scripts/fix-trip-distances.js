const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Vehicle UUID to VIN mapping
const uuidToVinMap = new Map([
    ['35658624-018d-4041-ab6b-fa396f06af16', '1FT6W1EV3PWG37779'], // Lightning 1
    ['810bd9c5-a531-4984-8e5b-c59ef8a4a47c', '1FTBW1XK6PKA30591'], // eTransit Van
    ['2dc0332a-d8fc-4ef8-b0e3-31ec20caeee0', '1FTVW1EV3NWG07402'], // Lightning XLT
    ['c0a4d743-eb5d-4dd8-8ce2-1216bf359bda', '1FTVW1EL3NWG00285']  // Lightning 2
]);

// Simple Ford Telematics client for the script
class FordTelematicsClient {
    constructor() {
        this.baseUrl = process.env.FORD_TELEMATICS_BASE_URL;
        this.clientId = process.env.FORD_TELEMATICS_CLIENT_ID;
        this.clientSecret = process.env.FORD_TELEMATICS_CLIENT_SECRET;
        this.accessToken = null;
    }

    async getAccessToken() {
        try {
            const response = await fetch(`${this.baseUrl}/token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: `clientId=${this.clientId}&clientSecret=${this.clientSecret}`
            });

            const data = await response.json();
            this.accessToken = data.accessToken;
            return this.accessToken;
        } catch (error) {
            console.error('Failed to get Ford access token:', error);
            throw error;
        }
    }

    async getVehicleTrips(vin, startTime, endTime, limit = 10) {
        if (!this.accessToken) {
            await this.getAccessToken();
        }

        try {
            const url = `${this.baseUrl}/vehicles/${vin}/trips?startTime=${startTime}&endTime=${endTime}&limit=${limit}`;
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();
            return data.trips || [];
        } catch (error) {
            console.error(`Failed to get trips for ${vin}:`, error);
            return [];
        }
    }
}

const fordClient = new FordTelematicsClient();

async function getAccurateTripDistance(trip) {
    try {
        const vehicleVin = uuidToVinMap.get(trip.vehicleId) || trip.vehicleId;

        const startTime = trip.ignitionOnTime.toISOString().substring(0, 19) + 'Z';
        const endTime = trip.ignitionOffTime?.toISOString().substring(0, 19) + 'Z' || new Date().toISOString().substring(0, 19) + 'Z';

        console.log(`🔍 Getting Ford API trip distance for ${trip.vehicleName} (VIN: ${vehicleVin}): ${startTime} to ${endTime}`);

        const fordTrips = await fordClient.getVehicleTrips(vehicleVin, startTime, endTime, 10);

        const matchingTrip = fordTrips.find(fordTrip => {
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

        // Get recent trips with inflated distances (>10 miles) - last 7 days
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const inflatedTrips = await tripsCollection.find({
            ignitionOnTime: { $gte: sevenDaysAgo },
            distanceTraveled: { $gt: 10 }, // Likely inflated trips
            ignitionOffTime: { $exists: true, $ne: null }
        }).sort({ ignitionOnTime: -1 }).limit(10).toArray();

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

// Run the script
fixTripDistances().then(() => {
    console.log('🏁 Script completed');
    process.exit(0);
}).catch(error => {
    console.error('💥 Script failed:', error);
    process.exit(1);
});