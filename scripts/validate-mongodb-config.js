#!/usr/bin/env node

const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');

dotenv.config();

async function validateMongoDBConfig() {
    console.log('🔍 MongoDB Configuration Validator');
    console.log('=====================================\n');

    const uri = process.env.MONGODB_URI;

    if (!uri) {
        console.error('❌ MONGODB_URI environment variable not found');
        process.exit(1);
    }

    console.log('✅ MONGODB_URI found');

    // Parse connection string for validation
    try {
        const url = new URL(uri.replace('mongodb+srv://', 'https://').replace('mongodb://', 'http://'));
        console.log(`✅ Connection string format: Valid`);
        console.log(`   Protocol: ${uri.startsWith('mongodb+srv://') ? 'mongodb+srv' : 'mongodb'}`);
        console.log(`   Host: ${url.hostname}`);
        console.log(`   Database: ${url.pathname.substring(1).split('?')[0]}`);

        // Check for common issues
        if (uri.includes('%40') && !uri.includes('@')) {
            console.warn('⚠️ Password contains encoded @ symbol but no @ delimiter found');
        }

        if (uri.includes('retryWrites=true')) {
            console.log('✅ Retry writes enabled');
        }

        if (uri.includes('w=majority')) {
            console.log('✅ Write concern set to majority');
        }

    } catch (error) {
        console.error('❌ Connection string format: Invalid', error.message);
        process.exit(1);
    }

    // Test actual connection
    console.log('\n🔗 Testing MongoDB Connection...');

    const client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
        useUnifiedTopology: true,
        useNewUrlParser: true
    });

    try {
        await client.connect();
        console.log('✅ Connection: Successful');

        // Test database operations
        const db = client.db();
        await db.admin().ping();
        console.log('✅ Ping: Successful');

        // Check server info
        const serverInfo = await db.admin().serverInfo();
        console.log(`✅ MongoDB Version: ${serverInfo.version}`);

        // List collections to verify database access
        const collections = await db.listCollections().toArray();
        console.log(`✅ Database Access: ${collections.length} collections found`);

    } catch (error) {
        console.error('❌ Connection failed:', error.message);

        // Provide specific guidance based on error
        if (error.message.includes('authentication')) {
            console.log('\n💡 Authentication issues detected:');
            console.log('   1. Verify username and password in connection string');
            console.log('   2. Check if user exists in MongoDB Atlas');
            console.log('   3. Ensure user has proper database permissions');
        }

        if (error.message.includes('network') || error.message.includes('ENOTFOUND')) {
            console.log('\n💡 Network issues detected:');
            console.log('   1. Check internet connection');
            console.log('   2. Verify cluster hostname in connection string');
            console.log('   3. Ensure IP is whitelisted in MongoDB Atlas');
        }

        if (error.message.includes('timeout')) {
            console.log('\n💡 Timeout issues detected:');
            console.log('   1. Network may be slow or unstable');
            console.log('   2. MongoDB Atlas cluster may be under load');
            console.log('   3. Consider increasing timeout values');
        }

        process.exit(1);
    } finally {
        await client.close();
    }

    console.log('\n🎉 MongoDB configuration validation complete!');
    console.log('   Your connection is properly configured and working.');
}

// Run validation
validateMongoDBConfig().catch(error => {
    console.error('🚨 Validation script failed:', error.message);
    process.exit(1);
});