const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');

dotenv.config();

async function checkTrips() {
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

        // Check all trips
        const allTrips = await tripsCollection.find({}).sort({ ignitionOnTime: -1 }).limit(10).toArray();
        console.log(`🔍 Found ${allTrips.length} recent trips total`);

        allTrips.forEach((trip, index) => {
            console.log(`\nTrip ${index + 1}:`);
            console.log(`   Vehicle: ${trip.vehicleName || trip.vehicleId}`);
            console.log(`   Time: ${trip.ignitionOnTime?.toISOString()} to ${trip.ignitionOffTime?.toISOString() || 'ongoing'}`);
            console.log(`   Distance: ${trip.distanceTraveled?.toFixed(2) || 'unknown'} miles`);
            console.log(`   Active: ${trip.isActive}`);
        });

        // Check high distance trips specifically
        const highDistanceTrips = await tripsCollection.find({
            distanceTraveled: { $gt: 5 }
        }).sort({ ignitionOnTime: -1 }).limit(5).toArray();

        console.log(`\n🔍 High distance trips (>5 miles): ${highDistanceTrips.length}`);
        highDistanceTrips.forEach((trip, index) => {
            console.log(`   ${index + 1}. ${trip.vehicleName}: ${trip.distanceTraveled?.toFixed(2)} miles at ${trip.ignitionOnTime?.toISOString()}`);
        });

    } catch (error) {
        console.error('❌ Error checking trips:', error);
    } finally {
        await client.close();
        console.log('🔌 MongoDB connection closed');
    }
}

checkTrips();