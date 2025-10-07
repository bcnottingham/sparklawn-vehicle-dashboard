const { MongoClient } = require('mongodb');
const moment = require('moment-timezone');

async function checkMongoDBData() {
    require('dotenv').config();
    
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/sparklawn-fleet';
    const client = new MongoClient(mongoUri);
    
    try {
        await client.connect();
        console.log('✅ Connected to MongoDB');
        
        const db = client.db();
        
        // List all collections
        console.log('\n📁 COLLECTIONS IN DATABASE:');
        const collections = await db.listCollections().toArray();
        console.log(collections.map(c => `   - ${c.name}`).join('\n'));
        
        // Check each collection for data
        for (const collection of collections) {
            const count = await db.collection(collection.name).countDocuments();
            console.log(`\n📊 Collection: ${collection.name} - ${count} documents`);
            
            if (count > 0) {
                // Show sample documents and date ranges
                const sample = await db.collection(collection.name).findOne();
                const allDocs = await db.collection(collection.name).find().limit(10).toArray();
                
                console.log('   📋 Sample document:');
                console.log('   ', JSON.stringify(sample, null, 2).substring(0, 500));
                
                // Try to find date fields
                const dateFields = ['timestamp', 'ignitionOnTime', 'ignitionOffTime', 'createdAt'];
                for (const field of dateFields) {
                    if (sample && sample[field]) {
                        const oldest = await db.collection(collection.name).find().sort({[field]: 1}).limit(1).toArray();
                        const newest = await db.collection(collection.name).find().sort({[field]: -1}).limit(1).toArray();
                        
                        if (oldest.length > 0 && newest.length > 0) {
                            console.log(`   📅 Date range (${field}): ${oldest[0][field]} to ${newest[0][field]}`);
                        }
                        break;
                    }
                }
                
                // Show all documents if small collection
                if (count <= 20) {
                    console.log('   📄 All documents:');
                    allDocs.forEach((doc, idx) => {
                        console.log(`   ${idx + 1}. ${JSON.stringify(doc, null, 2)}`);
                    });
                }
            }
        }
        
        // Check for the historical backfill collections specifically
        console.log('\n🔍 CHECKING HISTORICAL BACKFILL DATA:');
        
        const tripCollection = 'ignition_trips';
        const pointsCollection = 'route_points';
        
        const tripCount = await db.collection(tripCollection).countDocuments();
        const pointsCount = await db.collection(pointsCollection).countDocuments();
        
        console.log(`   ${tripCollection}: ${tripCount} documents`);
        console.log(`   ${pointsCollection}: ${pointsCount} documents`);
        
        if (tripCount > 0) {
            const allTrips = await db.collection(tripCollection).find().sort({ignitionOnTime: 1}).toArray();
            console.log('\n🛣️  ALL TRIPS IN DATABASE:');
            allTrips.forEach((trip, idx) => {
                console.log(`\n${idx + 1}. ${trip.vehicleName || trip.vehicleId}`);
                console.log(`   Start: ${trip.ignitionOnTime}`);
                console.log(`   End: ${trip.ignitionOffTime}`);
                console.log(`   Duration: ${trip.totalRunTime || 'N/A'} minutes`);
                console.log(`   Distance: ${trip.distanceTraveled || 'N/A'} miles`);
                console.log(`   Route Points: ${trip.routePoints ? trip.routePoints.length : 0}`);
                if (trip.startLocation) console.log(`   Start Location: ${trip.startLocation}`);
                if (trip.endLocation) console.log(`   End Location: ${trip.endLocation}`);
            });
        }
        
        if (pointsCount > 0) {
            console.log(`\n📍 ROUTE POINTS SUMMARY:`);
            
            // Group by vehicle
            const pipeline = [
                {
                    $group: {
                        _id: '$vehicleId',
                        count: { $sum: 1 },
                        earliest: { $min: '$timestamp' },
                        latest: { $max: '$timestamp' },
                        locations: { 
                            $push: {
                                timestamp: '$timestamp',
                                lat: '$latitude',
                                lng: '$longitude',
                                ignition: '$ignitionStatus'
                            }
                        }
                    }
                }
            ];
            
            const vehicleSummary = await db.collection(pointsCollection).aggregate(pipeline).toArray();
            
            vehicleSummary.forEach(vehicle => {
                console.log(`\n🚗 Vehicle: ${vehicle._id}`);
                console.log(`   Points: ${vehicle.count}`);
                console.log(`   Time Range: ${vehicle.earliest} to ${vehicle.latest}`);
                console.log(`   Sample locations:`);
                vehicle.locations.slice(0, 5).forEach((loc, idx) => {
                    console.log(`      ${idx + 1}. ${loc.timestamp} - (${loc.lat}, ${loc.lng}) - ${loc.ignition || 'N/A'}`);
                });
            });
        }
        
        // Check current time vs data dates
        console.log('\n⏰ TIME ANALYSIS:');
        console.log(`   Current time: ${new Date().toISOString()}`);
        console.log(`   2 weeks ago: ${new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()}`);
        console.log(`   30 days ago: ${new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()}`);
        
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await client.close();
        console.log('\n✅ Disconnected from MongoDB');
    }
}

checkMongoDBData();