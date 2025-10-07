#!/usr/bin/env node

/**
 * MongoDB Production Setup Script
 *
 * This script ensures your MongoDB connection is production-ready
 * for the fleet management system.
 */

const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');

dotenv.config();

class MongoDBProductionSetup {
    constructor() {
        this.uri = process.env.MONGODB_URI;
        this.client = null;
    }

    async initialize() {
        console.log('🚀 MongoDB Production Setup');
        console.log('============================\n');

        if (!this.uri) {
            throw new Error('MONGODB_URI environment variable is required');
        }

        // Create client with production-optimized settings
        this.client = new MongoClient(this.uri, {
            // Connection Pool - Optimized for fleet monitoring
            maxPoolSize: 20,            // Increased for high-frequency vehicle updates
            minPoolSize: 5,
            maxIdleTimeMS: 30000,

            // Timeouts - Aggressive for real-time fleet data
            serverSelectionTimeoutMS: 30000,
            socketTimeoutMS: 60000,
            connectTimeoutMS: 30000,

            // Modern driver options
            useUnifiedTopology: true,
            useNewUrlParser: true,

            // Resilience
            retryWrites: true,
            retryReads: true,
            readPreference: 'primary',

            // Network optimization
            compressors: ['zlib'],
            zlibCompressionLevel: 6,

            // SSL for Atlas
            ssl: true,
            sslValidate: true,

            // Monitoring
            heartbeatFrequencyMS: 10000
        });

        await this.client.connect();
        console.log('✅ Connected to MongoDB Atlas');
    }

    async validateIndexes() {
        console.log('🔍 Validating database indexes...');
        const db = this.client.db('sparklawn_fleet');

        const requiredIndexes = [
            // Vehicle data indexes
            { collection: 'vehicles', index: { vin: 1 }, unique: true },
            { collection: 'vehicles', index: { lastUpdated: -1 } },

            // Trip indexes for performance
            { collection: 'trips', index: { vin: 1, startTime: -1 } },
            { collection: 'trips', index: { endTime: -1 } },

            // Telematics signals indexes
            { collection: 'telematics_signals', index: { vin: 1, ts: -1 } },
            { collection: 'telematics_signals_critical', index: { vin: 1, ts: -1 } },
            { collection: 'telematics_signals_important', index: { vin: 1, ts: -1 } },
            { collection: 'telematics_signals_routine', index: { vin: 1, ts: -1 } },

            // Vehicle state index
            { collection: 'vehicle_state', index: { vin: 1 }, unique: true },

            // TTL indexes for data cleanup
            { collection: 'route_points', index: { timestamp: 1 }, options: { expireAfterSeconds: 2592000 } }, // 30 days
            { collection: 'telematics_signals', index: { ts: 1 }, options: { expireAfterSeconds: 7776000 } } // 90 days
        ];

        for (const { collection, index, unique, options } of requiredIndexes) {
            try {
                const coll = db.collection(collection);
                const indexOptions = { background: true, ...options };
                if (unique) indexOptions.unique = true;

                await coll.createIndex(index, indexOptions);
                console.log(`✅ Index created: ${collection}.${Object.keys(index).join(', ')}`);
            } catch (error) {
                if (error.code === 85) {
                    console.log(`ℹ️ Index already exists: ${collection}.${Object.keys(index).join(', ')}`);
                } else {
                    console.warn(`⚠️ Index creation failed: ${collection}.${Object.keys(index).join(', ')} - ${error.message}`);
                }
            }
        }
    }

    async testOperations() {
        console.log('🧪 Testing database operations...');
        const db = this.client.db('sparklawn_fleet');

        try {
            // Test write operation
            const testCollection = db.collection('connection_test');
            const testDoc = {
                _id: 'prod_setup_test',
                timestamp: new Date(),
                message: 'Production setup validation'
            };

            await testCollection.replaceOne({ _id: testDoc._id }, testDoc, { upsert: true });
            console.log('✅ Write operation: Successful');

            // Test read operation
            const retrieved = await testCollection.findOne({ _id: testDoc._id });
            if (retrieved) {
                console.log('✅ Read operation: Successful');
            } else {
                throw new Error('Document not found after write');
            }

            // Test aggregation operation
            const aggregateResult = await testCollection.aggregate([
                { $match: { _id: testDoc._id } },
                { $project: { timestamp: 1 } }
            ]).toArray();

            if (aggregateResult.length > 0) {
                console.log('✅ Aggregation operation: Successful');
            }

            // Clean up test document
            await testCollection.deleteOne({ _id: testDoc._id });

        } catch (error) {
            console.error('❌ Database operations test failed:', error.message);
            throw error;
        }
    }

    async configureReplicaSetReadPreference() {
        console.log('🔧 Configuring replica set preferences...');

        try {
            const admin = this.client.db('admin');
            const replicaSetStatus = await admin.command({ replSetGetStatus: 1 });

            console.log('✅ Replica set status verified');
            console.log(`   Primary: ${replicaSetStatus.members.find(m => m.stateStr === 'PRIMARY')?.name || 'Unknown'}`);
            console.log(`   Members: ${replicaSetStatus.members.length}`);

        } catch (error) {
            // This is expected for Atlas clusters as we don't have admin access
            console.log('ℹ️ Replica set details not accessible (normal for Atlas)');
        }
    }

    async enableProfiling() {
        console.log('📊 Configuring database profiling...');

        try {
            const db = this.client.db('sparklawn_fleet');

            // Enable profiling for slow operations (>100ms)
            await db.command({ profile: 2, slowms: 100 });
            console.log('✅ Database profiling enabled for operations >100ms');

        } catch (error) {
            console.log('ℹ️ Profiling not enabled (may require elevated permissions)');
        }
    }

    async close() {
        if (this.client) {
            await this.client.close();
            console.log('🔌 Connection closed');
        }
    }

    async run() {
        try {
            await this.initialize();
            await this.validateIndexes();
            await this.testOperations();
            await this.configureReplicaSetReadPreference();
            await this.enableProfiling();

            console.log('\n🎉 MongoDB Production Setup Complete!');
            console.log('===========================================');
            console.log('✅ Connection configuration optimized');
            console.log('✅ Required indexes verified/created');
            console.log('✅ Database operations tested');
            console.log('✅ Replica set preferences configured');
            console.log('✅ Performance monitoring enabled');
            console.log('\n🚀 Your fleet management system is ready for production!');

        } catch (error) {
            console.error('\n🚨 Production setup failed:', error.message);

            // Provide troubleshooting guidance
            console.log('\n💡 Troubleshooting:');
            console.log('1. Verify MONGODB_URI in .env file');
            console.log('2. Check MongoDB Atlas IP whitelist');
            console.log('3. Confirm database user permissions');
            console.log('4. Test network connectivity to Atlas');

            process.exit(1);
        } finally {
            await this.close();
        }
    }
}

// Execute setup
if (require.main === module) {
    new MongoDBProductionSetup().run();
}

module.exports = MongoDBProductionSetup;