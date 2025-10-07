import { Router } from 'express';

const router = Router();

// Get Google Maps API key for client-side use
router.get('/google-maps-key', (req, res) => {
    try {
        const apiKey = process.env.GOOGLE_MAPS_API_KEY || '';
        res.json({ apiKey });
    } catch (error) {
        console.error('Error serving Google Maps API key:', error);
        res.status(500).json({ error: 'Failed to get API key' });
    }
});

export default router;