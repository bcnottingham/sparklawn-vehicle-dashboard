import express from 'express';
import { geocodingService } from '../services/geocoding';
import { backgroundMonitoringService } from '../services/backgroundMonitoringService';

const router = express.Router();

// Test geocoding endpoint
router.post('/geocode', async (req, res) => {
    try {
        const { latitude, longitude } = req.body;
        
        if (!latitude || !longitude) {
            return res.status(400).json({
                error: 'Latitude and longitude are required'
            });
        }
        
        console.log(`🧪 Test geocoding request: ${latitude}, ${longitude}`);
        
        const address = await geocodingService.getAddress(latitude, longitude);
        
        res.json({
            latitude,
            longitude,
            address,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Test geocoding error:', error);
        res.status(500).json({
            error: 'Geocoding failed',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Test endpoint to manually complete active trips (for debugging drive time calculations)
router.post('/complete-active-trips', async (req, res) => {
    try {
        console.log('🧪 Test: Manually completing active trips for testing');

        // Get active trips
        const activeTrips = await backgroundMonitoringService.getActiveTrips();
        console.log(`🧪 Found ${activeTrips.length} active trips to complete`);

        let completedCount = 0;
        const now = new Date();

        // Complete the first 3 active trips for testing
        for (const trip of activeTrips.slice(0, 3)) {
            if (!trip._id) continue;

            // Calculate estimated end time (30 minutes after start)
            const estimatedEndTime = new Date(new Date(trip.ignitionOnTime).getTime() + 30 * 60 * 1000);
            const ignitionOffTime = estimatedEndTime < now ? estimatedEndTime : now;

            // Create end location (same as start location for simplicity)
            const endLocation = {
                latitude: trip.startLocation.latitude,
                longitude: trip.startLocation.longitude,
                address: trip.startLocation.address || 'Test End Location',
                clientName: trip.startLocation.clientName
            };

            // Calculate duration in minutes
            const duration = Math.max(15, (ignitionOffTime.getTime() - new Date(trip.ignitionOnTime).getTime()) / (1000 * 60));

            // Update trip in database directly (since no completeTrip method exists)
            // This simulates what should happen when ignition goes OFF
            const { getDatabase } = await import('../db/index');
            const db = await getDatabase();
            const result = await db.collection('ignition_trips').updateOne(
                { _id: trip._id as any },
                {
                    $set: {
                        isActive: false,
                        ignitionOffTime: ignitionOffTime,
                        endLocation: endLocation,
                        totalRunTime: Math.round(duration),
                        distanceTraveled: 2.5, // Estimated distance in miles
                        lastUpdated: now
                    }
                }
            );

            if (result.modifiedCount > 0) {
                completedCount++;
                console.log(`🧪 ✅ Completed trip ${trip._id} for ${trip.vehicleName}: ${Math.round(duration)}min duration`);
            }
        }

        res.json({
            message: `Successfully completed ${completedCount} active trips`,
            completedCount,
            totalActiveTrips: activeTrips.length,
            timestamp: now.toISOString()
        });

    } catch (error) {
        console.error('❌ Test trip completion error:', error);
        res.status(500).json({
            error: 'Failed to complete active trips',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Fix street address cache entries by finding nearby businesses
router.post('/fix-street-addresses', async (req, res) => {
    try {
        console.log('🔧 Starting street address cache fix...');

        const fixedCount = await geocodingService.fixStreetAddressCacheEntries();

        res.json({
            message: 'Street address cache fix completed',
            fixedCount,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Street address fix error:', error);
        res.status(500).json({
            error: 'Failed to fix street addresses',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export default router;