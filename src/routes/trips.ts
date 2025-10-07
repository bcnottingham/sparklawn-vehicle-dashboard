import { Router } from 'express';
import { tripHistoryService } from '../services/tripHistoryService';
import { tripTimelineService } from '../services/tripTimelineService';

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

// Get today's detailed timeline for a specific vehicle (or specific date if provided)
router.get('/timeline/:vehicleId', async (req, res) => {
    try {
        const { vehicleId } = req.params;
        const { date } = req.query;

        let timeline;

        if (date && typeof date === 'string') {
            // If date parameter provided (YYYY-MM-DD), get timeline for that specific day
            const requestedDate = new Date(date + 'T00:00:00');
            const startOfDay = new Date(requestedDate);
            startOfDay.setHours(0, 0, 0, 0);

            const endOfDay = new Date(requestedDate);
            endOfDay.setHours(23, 59, 59, 999);

            timeline = await tripTimelineService.getTimelineForPeriod(vehicleId, startOfDay, endOfDay);
        } else {
            // Default: get today's timeline
            timeline = await tripTimelineService.getTodaysTimeline(vehicleId);
        }

        res.json({
            success: true,
            timeline,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching vehicle timeline:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch vehicle timeline',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Get timeline for specific date range
router.get('/timeline/:vehicleId/:startDate/:endDate', async (req, res) => {
    try {
        const { vehicleId, startDate, endDate } = req.params;
        
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return res.status(400).json({
                success: false,
                error: 'Invalid date format. Use YYYY-MM-DD format.'
            });
        }
        
        const timeline = await tripTimelineService.getTimelineForPeriod(vehicleId, start, end);
        
        res.json({
            success: true,
            timeline,
            period: {
                start: startDate,
                end: endDate
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching vehicle timeline for period:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch vehicle timeline for specified period',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Get route points for specific vehicle and time period (for map visualization)
router.get('/route-points/:vehicleId', async (req, res) => {
    try {
        const { vehicleId } = req.params;
        const { startDate, endDate, limit } = req.query;
        
        // Default to today if no dates specified
        const start = startDate ? new Date(startDate as string) : (() => {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            return today;
        })();
        
        const end = endDate ? new Date(endDate as string) : (() => {
            const today = new Date();
            today.setHours(23, 59, 59, 999);
            return today;
        })();
        
        const timeline = await tripTimelineService.getTimelineForPeriod(vehicleId, start, end);
        
        // Extract route points for map visualization
        const routePoints = timeline.summary.routePoints.slice(0, parseInt(limit as string) || 1000);
        
        res.json({
            success: true,
            vehicleId,
            vehicleName: timeline.vehicleName,
            period: {
                start: start.toISOString(),
                end: end.toISOString()
            },
            routePoints,
            count: routePoints.length,
            summary: {
                totalDistance: timeline.summary.totalDistance,
                totalDuration: timeline.summary.totalDuration,
                clientVisits: timeline.summary.clientVisits
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching route points:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch route points',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export default router;