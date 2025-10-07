import { Router } from 'express';
import { hybridVehicleClient } from '../services/hybridVehicleClient';
import { vehicleNaming } from '../services/vehicleNaming';
import { geocodingService } from '../services/geocoding';
import { smartAlertsService } from '../services/smartAlertsService';

const router = Router();

// Basic vehicles endpoint - redirect to with-names for compatibility
router.get('/', async (req, res) => {
    try {
        // For now, return a basic response indicating the service is running
        // but the main data is available through other endpoints
        res.json({
            message: 'Vehicle service is running',
            availableEndpoints: [
                '/api/vehicles/with-names - Get all vehicles with detailed information',
                '/api/vehicles/recent-activity - Get recent fleet activity',
                '/api/vehicles/{vehicleId}/daily-stats - Get daily statistics',
                '/api/vehicles/debug - System debug information'
            ],
            timestamp: new Date().toISOString(),
            status: 'service_running'
        });
    } catch (error) {
        res.status(500).json({
            error: 'Vehicle service error',
            details: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString()
        });
    }
});

// Get vehicles with names and locations
// Debug endpoint to check system status
router.get('/debug', async (req, res) => {
    try {
        res.json({
            mongodb_uri: process.env.MONGODB_URI ? 'Set' : 'Not set',
            fordpass_configured: !!(process.env.FORDPASS_USERNAME && process.env.FORDPASS_PASSWORD && process.env.FORDPASS_VIN),
            fordpass_username: process.env.FORDPASS_USERNAME ? 'Set' : 'Not set',
            fordpass_vin: process.env.FORDPASS_VIN ? 'Set' : 'Not set'
        });
    } catch (error) {
        res.json({
            error: error instanceof Error ? error.message : 'Unknown error',
            mongodb_uri: process.env.MONGODB_URI ? 'Set' : 'Not set'
        });
    }
});

// Get all vehicles with detailed information - FordPass only
router.get('/with-names', async (req, res) => {
    try {
        console.log('🚗 Fetching vehicles using FordPass client');
        
        // Clear geocoding cache if requested
        if (req.query.clearCache === 'true') {
            geocodingService.clearAllCaches();
        }
        
        const result = await hybridVehicleClient.getVehiclesWithDetails();
        
        // Sort vehicles: real data first, placeholders last, van at the very bottom
        const sortedVehicles = result.vehicles.sort((a, b) => {
            // eTransit Van always goes to the bottom
            if (a.name === 'eTransit Van') return 1;
            if (b.name === 'eTransit Van') return -1;
            
            // Vehicles with real location data come first
            const aHasData = a.location.latitude !== 0 && a.location.longitude !== 0 && !a.location.address?.includes('Error');
            const bHasData = b.location.latitude !== 0 && b.location.longitude !== 0 && !b.location.address?.includes('Error');
            
            if (aHasData && !bHasData) return -1;
            if (!aHasData && bHasData) return 1;
            return 0;
        });
        
        // Add vehicleId field for frontend compatibility (matching the vin field)
        const vehiclesWithVehicleId = sortedVehicles.map(vehicle => ({
            ...vehicle,
            vehicleId: vehicle.vin
        }));
        
        res.json({ 
            vehicles: vehiclesWithVehicleId,
            count: vehiclesWithVehicleId.length,
            timestamp: new Date().toISOString(),
            dataSources: sortedVehicles.map(v => ({
                id: v.id,
                name: v.name,
                source: v.battery._dataSource,
                isMockData: v.battery._isMockData,
                hasRealData: v.location.latitude !== 0 && v.location.longitude !== 0 && !v.location.address?.includes('Error')
            }))
        });
        
        console.log(`✅ Successfully retrieved ${result.vehicles.length} vehicles`);
        
    } catch (error) {
        console.error('❌ FordPass client failed:', error);
        res.status(500).json({ 
            error: 'Vehicle data source failed',
            details: 'FordPass API is unavailable',
            timestamp: new Date().toISOString()
        });
    }
});

// Get daily stats for a vehicle
router.get('/:vehicleId/daily-stats', async (req, res) => {
    try {
        const { vehicleId } = req.params;
        const { date } = req.query;
        
        // For now, return mock data since we need to integrate with backgroundMonitoringService
        // This will be replaced with real data from MongoDB trips
        const mockStats = {
            date: date || new Date().toISOString().split('T')[0],
            vehicleId,
            totalTrips: 0,
            totalRunTime: 0, // minutes
            totalDistance: 0, // miles
            totalBatteryUsed: 0, // percentage
            firstTripStart: null,
            lastTripEnd: null,
            operatingHours: 0
        };
        
        res.json(mockStats);
        
    } catch (error) {
        console.error('❌ Failed to get daily stats:', error);
        res.status(500).json({
            error: 'Failed to fetch daily stats',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Charging history endpoint  
router.get('/:vehicleId/charging-history', async (req, res) => {
    try {
        const { vehicleId } = req.params;
        
        // TODO: Implement charging history from MongoDB or Ford Telematics
        // For now, return placeholder data
        const chargingHistory = [
            {
                date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
                startTime: '22:30',
                endTime: '06:00',
                duration: '7.5 hours',
                energyAdded: '45 kWh',
                batteryBefore: '15%',
                batteryAfter: '95%',
                chargingRate: '6 kW',
                location: 'Home/Base'
            },
            {
                date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
                startTime: '19:15',
                endTime: '23:45',
                duration: '4.5 hours',
                energyAdded: '28 kWh',
                batteryBefore: '35%',
                batteryAfter: '85%',
                chargingRate: '6.2 kW',
                location: 'Client Location'
            }
        ];
        
        res.json({
            success: true,
            vehicleId,
            history: chargingHistory || [],
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Failed to get charging history for', req.params.vehicleId, ':', error);
        res.status(500).json({
            error: 'Failed to fetch charging history',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Recent Fleet Activity endpoint
router.get('/recent-activity', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
        const unreadOnly = req.query.unreadOnly === 'true';

        // Get recent alerts from smart alerts service with MongoDB connection check
        let alerts;
        try {
            alerts = await smartAlertsService.getRecentAlerts(limit, unreadOnly);
        } catch (mongoError) {
            console.log('⚠️ MongoDB alerts unavailable, returning empty activity list');
            return res.json({
                success: true,
                activities: [],
                totalCount: 0,
                unreadCount: 0,
                timestamp: new Date().toISOString(),
                message: 'No recent activity available - alert system offline'
            });
        }

        // Transform alerts into activity log format
        const activityLogs = alerts.map(alert => {
            let message = '';
            const activityType = alert.alertType;

            // Format activity messages based on alert type
            switch (alert.alertType) {
                case 'client_arrival':
                    message = `Arrived at ${alert.location.clientName || alert.location.address}`;
                    break;
                case 'client_departure':
                    message = `Left ${alert.metadata.previousLocation || 'location'}`;
                    break;
                case 'ignition_on':
                    message = `Started at ${alert.location.address || 'unknown location'}`;
                    break;
                case 'ignition_off':
                    message = `Stopped at ${alert.location.clientName || alert.location.address || 'unknown location'}`;
                    break;
                case 'trip_start':
                    message = `Trip started from ${alert.location.address || 'unknown location'}`;
                    break;
                case 'trip_end':
                    message = `Trip ended at ${alert.location.clientName || alert.location.address || 'unknown location'}`;
                    if (alert.metadata.duration && alert.metadata.distance) {
                        message += ` (${alert.metadata.duration.toFixed(1)} min, ${alert.metadata.distance.toFixed(1)} mi)`;
                    }
                    break;
                case 'client_visit':
                    message = `Visiting ${alert.location.clientName || alert.location.address}`;
                    break;
                default:
                    message = alert.metadata.alertReason || `${alert.alertType.replace('_', ' ')} at ${alert.location.address || 'unknown location'}`;
                    break;
            }

            return {
                id: alert._id,
                vehicleId: alert.vehicleId,
                vehicleName: alert.vehicleName,
                activityType,
                message,
                timestamp: alert.timestamp,
                location: {
                    latitude: alert.location.latitude,
                    longitude: alert.location.longitude,
                    address: alert.location.address,
                    clientName: alert.location.clientName
                },
                metadata: {
                    batteryLevel: alert.metadata.batteryLevel,
                    duration: alert.metadata.duration,
                    distance: alert.metadata.distance,
                    batteryUsed: alert.metadata.batteryUsed,
                    tripId: alert.metadata.tripId
                },
                priority: alert.priority,
                isRead: alert.isRead
            };
        });

        // Get unread count for summary
        const unreadCount = await smartAlertsService.getUnreadCount();

        res.json({
            success: true,
            activities: activityLogs,
            totalCount: activityLogs.length,
            unreadCount,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Failed to get recent fleet activity:', error);
        res.status(500).json({
            error: 'Failed to fetch recent fleet activity',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export default router;