import express from 'express';
import { parkingDetectionService } from '../services/parkingDetectionService';
import { backgroundMonitoringService } from '../services/backgroundMonitoringService';

const router = express.Router();

// Get current parking status for a vehicle (supports both VIN and UUID)
router.get('/status/:vehicleId', async (req, res) => {
    try {
        const vehicleId = req.params.vehicleId;
        const parkingStatus = await parkingDetectionService.getCurrentParkingStatusByVinOrId(vehicleId);
        
        res.json({
            success: true,
            status: parkingStatus,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error getting parking status:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get parking status',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Get parking sessions for a vehicle
router.get('/sessions/:vehicleId', async (req, res) => {
    try {
        const vehicleId = req.params.vehicleId;
        const limit = parseInt(req.query.limit as string) || 10;
        
        const sessions = await parkingDetectionService.getParkingSessions(vehicleId, limit);
        
        res.json({
            success: true,
            sessions,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error getting parking sessions:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get parking sessions',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Enhanced real-time parking status using movement-based detection
router.get('/enhanced-status/:vehicleId', async (req, res) => {
    try {
        const vehicleId = req.params.vehicleId;
        
        // Use the resilient parking status method for best accuracy
        const parkingStatus = await backgroundMonitoringService.getResilientParkingStatus(vehicleId);
        
        res.json({
            success: true,
            status: {
                isParked: parkingStatus.isParked,
                duration: parkingStatus.duration,
                cycles: 0 // Not used in this implementation
            },
            source: parkingStatus.source,
            lastIgnitionOffTime: parkingStatus.lastIgnitionOffTime,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error getting enhanced parking status:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get enhanced parking status',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Real-time parking status (fastest but may have less fallbacks)
router.get('/realtime-status/:vehicleId', async (req, res) => {
    try {
        const vehicleId = req.params.vehicleId;
        
        // Use the simple parking status method for speed
        const parkingStatus = await backgroundMonitoringService.getSimpleParkingStatus(vehicleId);
        
        res.json({
            success: true,
            status: {
                isParked: parkingStatus.isParked,
                duration: parkingStatus.duration,
                cycles: 0
            },
            lastIgnitionOffTime: parkingStatus.lastIgnitionOffTime,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error getting realtime parking status:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get realtime parking status',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Database-based parking status (most reliable for historical data)
router.get('/database-status/:vehicleId', async (req, res) => {
    try {
        const vehicleId = req.params.vehicleId;
        
        // Use database-based calculation
        const parkingStatus = await backgroundMonitoringService.getDatabaseParkingStatus(vehicleId);
        
        res.json({
            success: true,
            status: {
                isParked: parkingStatus.isParked,
                duration: parkingStatus.duration,
                cycles: 0
            },
            source: parkingStatus.source,
            lastIgnitionOffTime: parkingStatus.lastIgnitionOffTime,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error getting database parking status:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get database parking status',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export default router;