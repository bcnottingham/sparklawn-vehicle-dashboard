import { Router } from 'express';
import { SmartcarClient } from '../smartcar/smartcarClient';

const router = Router();
const smartcarClient = new SmartcarClient();

router.get('/vehicles/:vehicleId/diagnostics', async (req, res) => {
    try {
        const { vehicleId } = req.params;
        const diagnostics = await smartcarClient.getVehicleDiagnostics(vehicleId);
        res.json(diagnostics);
    } catch (error) {
        console.error('Error fetching vehicle diagnostics:', error);
        res.status(500).json({ error: 'Failed to fetch diagnostics' });
    }
});

export default router;