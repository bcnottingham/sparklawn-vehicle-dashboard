#!/usr/bin/env node

/**
 * Historical Data Backfill Script
 * Fetches Ford Telematics historical data and populates MongoDB
 */

import dotenv from 'dotenv';
import pkg from 'mongodb';
const { MongoClient } = pkg;
import { FordTelematicsClient } from '../dist/services/fordTelematicsClient.js';

dotenv.config();

class HistoricalBackfill {
    constructor() {
        this.mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/sparklawn_fleet';
        
        // Initialize Ford Telematics client with proper config
        const fordConfig = {
            clientId: process.env.FORD_TELEMATICS_CLIENT_ID,
            clientSecret: process.env.FORD_TELEMATICS_CLIENT_SECRET,
            baseUrl: process.env.FORD_TELEMATICS_BASE_URL || 'https://api.fordpro.com/vehicle-status-api'
        };
        
        this.fordClient = new FordTelematicsClient(fordConfig);
        this.client = null;
        this.db = null;
        
        // Target VINs for backfill
        this.vins = [
            '1FT6W1EV3PWG37779',  // Lightning 1
            '1FTVW1EL3NWG00285',  // Lightning 2  
            '1FTBW1XK6PKA30591'   // eTransit Van
        ];
    }

    async initialize() {
        console.log('🔌 Connecting to MongoDB...');
        this.client = new MongoClient(this.mongoUri);
        await this.client.connect();
        this.db = this.client.db();
        console.log('✅ Connected to MongoDB');
    }

    async backfillVehicleHistory(vin, totalDaysBack = 30) {
        console.log(`\n📡 Fetching ${totalDaysBack} days of history for VIN: ${vin} in 3-day chunks`);
        
        let totalTrips = 0;
        let totalPoints = 0;
        const chunkSize = 3; // 3-day chunks due to API limitation
        
        // Work backwards from current time in 3-day chunks
        for (let daysOffset = 0; daysOffset < totalDaysBack; daysOffset += chunkSize) {
            const endTime = new Date(Date.now() - (daysOffset * 24 * 60 * 60 * 1000));
            const startTime = new Date(endTime.getTime() - (chunkSize * 24 * 60 * 60 * 1000));
            
            // Ensure dates are in ISO 8601 format with Z suffix for UTC
            const startTimeISO = startTime.toISOString();
            const endTimeISO = endTime.toISOString();
            
            console.log(`   📅 Chunk ${Math.floor(daysOffset/chunkSize) + 1}: ${startTime.toISOString().split('T')[0]} to ${endTime.toISOString().split('T')[0]}`);

            try {
                // Fetch historical data from Ford API for this 3-day chunk
                const historicalData = await this.fordClient.getVehicleHistorical(vin, startTimeISO, endTimeISO);
                
                if (!historicalData || !historicalData.signals) {
                    console.log(`     ⚠️ No data for this time period`);
                    continue;
                }

                console.log(`     ✅ Retrieved ${historicalData.signals.length} signals`);
                
                // Process and store the historical data
                const results = await this.processHistoricalSignals(vin, historicalData.signals);
                totalTrips += results.tripsCreated;
                totalPoints += results.pointsCreated;
                
                // Rate limiting between chunks
                if (daysOffset + chunkSize < totalDaysBack) {
                    console.log(`     ⏳ Waiting 3 seconds before next chunk...`);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
                
            } catch (error) {
                console.error(`     ❌ Error fetching chunk:`, error.message);
                // Continue with next chunk despite error
            }
        }
        
        console.log(`   📊 ${vin} Total: ${totalTrips} trips, ${totalPoints} route points`);
    }

    async processHistoricalSignals(vin, signals) {
        // Group signals by timestamp for complete data points
        const signalsByTimestamp = this.groupSignalsByTimestamp(signals);
        const timestamps = Object.keys(signalsByTimestamp).sort();
        
        console.log(`   🔄 Processing ${timestamps.length} unique timestamps`);
        
        let currentTrip = null;
        let routePoints = [];
        let tripsCreated = 0;
        let pointsCreated = 0;
        
        for (let i = 0; i < timestamps.length; i++) {
            const timestamp = timestamps[i];
            const signalGroup = signalsByTimestamp[timestamp];
            
            // Extract key signals
            const position = signalGroup.position?.value;
            const ignition = signalGroup.ignition_status?.value;
            const odometer = signalGroup.odometer?.value;
            const speed = signalGroup.speed?.value;
            const battery = signalGroup.xev_battery_state_of_charge?.value;
            
            if (!position || !position.latitude || !position.longitude) {
                continue; // Skip if no GPS data
            }
            
            const date = new Date(timestamp);
            
            // Create route point
            const routePoint = {
                vehicleId: vin,
                latitude: position.latitude,
                longitude: position.longitude,
                timestamp: date,
                speed: speed || 0,
                odometer: odometer,
                batteryLevel: battery,
                ignitionStatus: ignition
            };
            
            routePoints.push(routePoint);
            
            // Trip detection logic
            if (ignition === 'ON' && !currentTrip) {
                // Trip started
                currentTrip = {
                    vehicleId: vin,
                    vehicleName: this.getVehicleName(vin),
                    ignitionOnTime: date,
                    isActive: false, // Historical trip
                    startLocation: {
                        latitude: position.latitude,
                        longitude: position.longitude
                    },
                    startOdometer: odometer,
                    startBattery: battery,
                    routePoints: [],
                    totalStops: 0
                };
                
                console.log(`   🚗 Trip started at ${date.toISOString()}`);
                
            } else if (ignition === 'OFF' && currentTrip) {
                // Trip ended
                currentTrip.ignitionOffTime = date;
                currentTrip.endLocation = {
                    latitude: position.latitude,
                    longitude: position.longitude
                };
                currentTrip.endOdometer = odometer;
                currentTrip.endBattery = battery;
                
                // Calculate trip metrics
                currentTrip.totalRunTime = Math.round((date - currentTrip.ignitionOnTime) / (1000 * 60)); // minutes
                currentTrip.distanceTraveled = currentTrip.endOdometer - currentTrip.startOdometer;
                currentTrip.batteryUsed = currentTrip.startBattery - currentTrip.endBattery;
                
                // Store trip in MongoDB
                await this.storeTrip(currentTrip);
                tripsCreated++;
                
                console.log(`   ✅ Trip completed - Duration: ${currentTrip.totalRunTime}min, Distance: ${currentTrip.distanceTraveled}mi`);
                
                currentTrip = null;
            }
        }
        
        // Store all route points in bulk
        if (routePoints.length > 0) {
            await this.storeRoutePoints(routePoints);
            pointsCreated = routePoints.length;
        }
        
        console.log(`   📊 Summary: ${tripsCreated} trips, ${pointsCreated} route points created`);
    }

    groupSignalsByTimestamp(signals) {
        const grouped = {};
        
        for (const signal of signals) {
            const timestamp = signal.timestamp;
            if (!grouped[timestamp]) {
                grouped[timestamp] = {};
            }
            grouped[timestamp][signal.type] = signal;
        }
        
        return grouped;
    }

    getVehicleName(vin) {
        const nameMap = {
            '1FT6W1EV3PWG37779': 'Lightning 1',
            '1FTVW1EL3NWG00285': 'Lightning 2', 
            '1FTBW1XK6PKA30591': 'eTransit Van'
        };
        return nameMap[vin] || `Vehicle ${vin.slice(-4)}`;
    }

    async storeTrip(trip) {
        const collection = this.db.collection('ignition_trips');
        await collection.insertOne(trip);
    }

    async storeRoutePoints(points) {
        if (points.length === 0) return;
        
        const collection = this.db.collection('route_points');
        await collection.insertMany(points, { ordered: false });
    }

    async runBackfill(daysBack = 3) {
        console.log('🚀 Starting historical backfill process...');
        console.log(`📅 Target: ${daysBack} days of historical data`);
        console.log(`🚗 Vehicles: ${this.vins.length} VINs`);
        
        for (const vin of this.vins) {
            await this.backfillVehicleHistory(vin, daysBack);
            
            // Rate limiting - wait between vehicles
            if (this.vins.indexOf(vin) < this.vins.length - 1) {
                console.log('   ⏳ Waiting 2 seconds before next vehicle...');
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        console.log('\n✅ Historical backfill completed!');
    }

    async close() {
        if (this.client) {
            await this.client.close();
            console.log('🔌 MongoDB connection closed');
        }
    }
}

// Main execution
async function main() {
    const backfill = new HistoricalBackfill();
    
    try {
        await backfill.initialize();
        await backfill.runBackfill(30); // 30 days of history
        
    } catch (error) {
        console.error('❌ Backfill failed:', error);
    } finally {
        await backfill.close();
    }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export { HistoricalBackfill };