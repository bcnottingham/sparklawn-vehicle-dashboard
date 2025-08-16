import { Router } from 'express';
import { geofencingService, VehicleLocation } from '../services/geofencing';
import { jobberClient } from '../services/jobberClient';
import { notificationService } from '../services/notifications';
import { SmartcarClient } from '../smartcar/smartcarClient';
import { vehicleNaming } from '../services/vehicleNaming';

const router = Router();
const smartcarClient = new SmartcarClient();

// Initialize geofencing with Jobber data
router.post('/initialize', async (req, res) => {
    try {
        await geofencingService.loadJobberProperties();
        res.json({ 
            success: true, 
            message: 'Geofencing initialized with Jobber properties',
            zoneCount: geofencingService.getZones().length
        });
    } catch (error) {
        console.error('Error initializing geofencing:', error);
        res.status(500).json({ error: 'Failed to initialize geofencing' });
    }
});

// Get all geofence zones
router.get('/zones', (req, res) => {
    try {
        const zones = geofencingService.getZones();
        res.json({ zones });
    } catch (error) {
        console.error('Error getting zones:', error);
        res.status(500).json({ error: 'Failed to get zones' });
    }
});

// Get zones by type
router.get('/zones/:type', (req, res) => {
    try {
        const { type } = req.params;
        const zones = geofencingService.getZonesByType(type);
        res.json({ zones });
    } catch (error) {
        console.error('Error getting zones by type:', error);
        res.status(500).json({ error: 'Failed to get zones by type' });
    }
});

// Check current vehicle positions against geofences
router.post('/check', async (req, res) => {
    try {
        const vehicles = await smartcarClient.getVehicles();
        const events = [];

        for (const vehicleId of vehicles.vehicles) {
            try {
                const location = await smartcarClient.getVehicleLocation(vehicleId);
                const vehicleName = vehicleNaming.setVehicleName(vehicleId);
                
                const vehicleLocation: VehicleLocation = {
                    vehicleId,
                    vehicleName,
                    latitude: location.latitude,
                    longitude: location.longitude,
                    timestamp: new Date()
                };

                const vehicleEvents = geofencingService.checkGeofences(vehicleLocation);
                
                // Send notifications for each event
                for (const event of vehicleEvents) {
                    const zone = geofencingService.getZoneById(event.zoneId);
                    if (zone) {
                        await notificationService.sendGeofenceAlert(event, zone);
                    }
                }
                
                events.push(...vehicleEvents);
            } catch (error) {
                console.error(`Error checking geofences for vehicle ${vehicleId}:`, error);
            }
        }

        res.json({ events, count: events.length });
    } catch (error) {
        console.error('Error checking geofences:', error);
        res.status(500).json({ error: 'Failed to check geofences' });
    }
});

// Get current zones for all vehicles
router.get('/vehicle-zones', async (req, res) => {
    try {
        const vehicles = await smartcarClient.getVehicles();
        const vehicleZones = [];

        for (const vehicleId of vehicles.vehicles) {
            const vehicleName = vehicleNaming.setVehicleName(vehicleId);
            const currentZones = geofencingService.getVehicleCurrentZones(vehicleId);
            
            vehicleZones.push({
                vehicleId,
                vehicleName,
                zones: currentZones
            });
        }

        res.json({ vehicleZones });
    } catch (error) {
        console.error('Error getting vehicle zones:', error);
        res.status(500).json({ error: 'Failed to get vehicle zones' });
    }
});

// Test Slack notification
router.post('/test-notification', async (req, res) => {
    try {
        await notificationService.sendCustomAlert(
            '🧪 Test Alert',
            'This is a test notification from SparkLawn Fleet Tracker!',
            'good'
        );
        res.json({ success: true, message: 'Test notification sent' });
    } catch (error) {
        console.error('Error sending test notification:', error);
        res.status(500).json({ error: 'Failed to send test notification' });
    }
});

// Get Jobber properties (for debugging)
router.get('/jobber/properties', async (req, res) => {
    try {
        const properties = await jobberClient.getAllProperties();
        res.json({ properties, count: properties.length });
    } catch (error) {
        console.error('Error getting Jobber properties:', error);
        res.status(500).json({ error: 'Failed to get Jobber properties' });
    }
});

// Get today's jobs from Jobber
router.get('/jobber/jobs/today', async (req, res) => {
    try {
        const jobs = await jobberClient.getTodaysJobs();
        res.json({ jobs, count: jobs.length });
    } catch (error) {
        console.error('Error getting today\'s jobs:', error);
        res.status(500).json({ error: 'Failed to get today\'s jobs' });
    }
});

// Manual geofence check for specific vehicle
router.post('/check/:vehicleId', async (req, res) => {
    try {
        const { vehicleId } = req.params;
        const location = await smartcarClient.getVehicleLocation(vehicleId);
        const vehicleName = vehicleNaming.setVehicleName(vehicleId);
        
        const vehicleLocation: VehicleLocation = {
            vehicleId,
            vehicleName,
            latitude: location.latitude,
            longitude: location.longitude,
            timestamp: new Date()
        };

        const events = geofencingService.checkGeofences(vehicleLocation);
        
        // Send notifications
        for (const event of events) {
            const zone = geofencingService.getZoneById(event.zoneId);
            if (zone) {
                await notificationService.sendGeofenceAlert(event, zone);
            }
        }

        res.json({ 
            vehicleLocation,
            events, 
            currentZones: geofencingService.getVehicleCurrentZones(vehicleId)
        });
    } catch (error) {
        console.error('Error checking geofences for vehicle:', error);
        res.status(500).json({ error: 'Failed to check geofences for vehicle' });
    }
});

export default router;