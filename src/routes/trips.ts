import { Router } from 'express';
import { tripHistoryService } from '../services/tripHistoryService';

const router = Router();

// Get trip history for all vehicles or specific vehicle
router.get('/', async (req, res) => {
    try {
        const { vehicleId, limit } = req.query;
        const trips = await tripHistoryService.getTripHistory(
            vehicleId as string,
            parseInt(limit as string) || 50
        );
        
        res.json({
            trips,
            count: trips.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching trip history:', error);
        res.status(500).json({
            error: 'Failed to fetch trip history',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Get active trips
router.get('/active', async (req, res) => {
    try {
        const activeTrips = await tripHistoryService.getActiveTrips();
        
        res.json({
            activeTrips,
            count: activeTrips.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching active trips:', error);
        res.status(500).json({
            error: 'Failed to fetch active trips',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Get specific trip by ID
router.get('/:tripId', async (req, res) => {
    try {
        const { tripId } = req.params;
        const trip = await tripHistoryService.getTripById(tripId);
        
        if (!trip) {
            return res.status(404).json({
                error: 'Trip not found'
            });
        }
        
        res.json({
            trip,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching trip:', error);
        res.status(500).json({
            error: 'Failed to fetch trip',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Get vehicle statistics
router.get('/stats/:vehicleId', async (req, res) => {
    try {
        const { vehicleId } = req.params;
        const { days } = req.query;
        
        const stats = await tripHistoryService.getVehicleStats(
            vehicleId,
            parseInt(days as string) || 30
        );
        
        res.json({
            vehicleId,
            period: `${days || 30} days`,
            stats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching vehicle stats:', error);
        res.status(500).json({
            error: 'Failed to fetch vehicle statistics',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Get fleet statistics
router.get('/stats/fleet/overview', async (req, res) => {
    try {
        const { days } = req.query;
        
        const stats = await tripHistoryService.getFleetStats(
            parseInt(days as string) || 7
        );
        
        res.json({
            period: `${days || 7} days`,
            stats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching fleet stats:', error);
        res.status(500).json({
            error: 'Failed to fetch fleet statistics',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export default router;