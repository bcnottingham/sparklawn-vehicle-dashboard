const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');

dotenv.config();

async function debugCollections() {
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

        // List all collections
        const collections = await db.listCollections().toArray();
        console.log(`\n📋 Available collections (${collections.length}):`);
        collections.forEach(col => {
            console.log(`   - ${col.name}`);
        });

        // Check each collection for recent documents
        console.log('\n🔍 Checking collection contents:');
        for (const col of collections) {
            const collection = db.collection(col.name);
            const count = await collection.countDocuments();
            console.log(`\n   ${col.name}: ${count} documents`);

            if (count > 0 && count < 1000) {
                const sample = await collection.findOne();
                if (sample.timestamp || sample.ts || sample.time || sample.ignitionOnTime) {
                    console.log(`     Sample timestamp: ${sample.timestamp || sample.ts || sample.time || sample.ignitionOnTime}`);
                }
                if (sample.vehicleId || sample.vin || sample.vehicleName) {
                    console.log(`     Sample vehicle: ${sample.vehicleId || sample.vin || sample.vehicleName}`);
                }
            }
        }

        // Specifically look for Lightning 1 data in any collection
        console.log('\n🔍 Looking for Lightning 1 data specifically:');
        for (const col of collections) {
            const collection = db.collection(col.name);
            const lightning1Data = await collection.findOne({
                $or: [
                    { vehicleName: /Lightning 1/i },
                    { vehicleName: /Lightning1/i },
                    { vin: '1FTVW1EL3NWG00285' },
                    { vehicleId: '1FTVW1EL3NWG00285' }
                ]
            });

            if (lightning1Data) {
                console.log(`     Found in ${col.name}:`, Object.keys(lightning1Data));
            }
        }

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await client.close();
        console.log('🔌 MongoDB connection closed');
    }
}

debugCollections();