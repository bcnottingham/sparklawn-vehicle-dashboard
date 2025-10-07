import { Router } from 'express';

const router = Router();

router.get('/vehicles/:vehicleId/diagnostics', async (req, res) => {
    try {
        res.status(501).json({ 
            error: 'Diagnostics not available',
            details: 'Smartcar integration removed - diagnostics will be available with FordPass API'
        });
    } catch (error) {
        console.error('Error fetching vehicle diagnostics:', error);
        res.status(500).json({ error: 'Failed to fetch diagnostics' });
    }
});

export default router;