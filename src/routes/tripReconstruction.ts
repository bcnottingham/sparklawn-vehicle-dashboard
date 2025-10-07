import express from 'express';
import { tripReconstructionService } from '../services/tripReconstructionService';

const router = express.Router();

// Find missed trips in historical data
router.get('/analyze', async (req, res) => {
    try {
        const hoursBack = parseInt(req.query.hours as string) || 24;
        const startDate = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
        
        console.log(`🔍 Starting trip reconstruction analysis for last ${hoursBack} hours...`);
        
        const missedTrips = await tripReconstructionService.findMissedTrips(startDate);
        
        res.json({
            success: true,
            analysis: {
                timeRange: {
                    startDate: startDate.toISOString(),
                    endDate: new Date().toISOString(),
                    hoursAnalyzed: hoursBack
                },
                missedTrips: missedTrips.length,
                candidates: missedTrips
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error in trip reconstruction analysis:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to analyze missed trips',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Reconstruct a specific missed trip
router.post('/reconstruct/:candidateIndex', async (req, res) => {
    try {
        const candidateIndex = parseInt(req.params.candidateIndex);
        const hoursBack = parseInt(req.body.hoursBack) || 24;
        const startDate = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
        
        // Get missed trips again
        const missedTrips = await tripReconstructionService.findMissedTrips(startDate);
        
        if (candidateIndex < 0 || candidateIndex >= missedTrips.length) {
            return res.status(400).json({
                success: false,
                error: 'Invalid candidate index'
            });
        }
        
        const candidate = missedTrips[candidateIndex];
        console.log(`🔧 Reconstructing trip for ${candidate.vehicleName}...`);
        
        const reconstructedTrip = await tripReconstructionService.reconstructTrip(candidate);
        
        res.json({
            success: true,
            message: 'Trip successfully reconstructed',
            trip: reconstructedTrip,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error reconstructing trip:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to reconstruct trip',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Reconstruct all high-confidence missed trips
router.post('/reconstruct-all', async (req, res) => {
    try {
        const hoursBack = parseInt(req.body.hoursBack) || 24;
        const minConfidence = parseInt(req.body.minConfidence) || 70;
        const startDate = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
        
        console.log(`🔧 Auto-reconstructing all trips with confidence >= ${minConfidence}%...`);
        
        const missedTrips = await tripReconstructionService.findMissedTrips(startDate);
        const highConfidenceTrips = missedTrips.filter(trip => trip.confidence >= minConfidence);
        
        const reconstructedTrips = [];
        for (const candidate of highConfidenceTrips) {
            try {
                const trip = await tripReconstructionService.reconstructTrip(candidate);
                reconstructedTrips.push(trip);
            } catch (error) {
                console.error(`Failed to reconstruct trip for ${candidate.vehicleName}:`, error);
            }
        }
        
        res.json({
            success: true,
            message: `Successfully reconstructed ${reconstructedTrips.length} trips`,
            analysis: {
                totalCandidates: missedTrips.length,
                highConfidenceCandidates: highConfidenceTrips.length,
                successfullyReconstructed: reconstructedTrips.length,
                minConfidence
            },
            trips: reconstructedTrips,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error in bulk trip reconstruction:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to reconstruct trips',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Ford API validation removed - MongoDB is single source of truth

// Ford API comparison removed - MongoDB is single source of truth

export default router;