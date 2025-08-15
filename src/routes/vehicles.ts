import { Router } from 'express';
import { SmartcarClient } from '../smartcar/smartcarClient';
import { vehicleNaming } from '../services/vehicleNaming';

const router = Router();
const smartcarClient = new SmartcarClient();

router.get('/', async (req, res) => {
    try {
        const vehicles = await smartcarClient.getVehicles();
        res.json(vehicles);
    } catch (error) {
        console.error('Error fetching vehicles:', error);
        res.status(500).json({ error: 'Failed to fetch vehicles' });
    }
});

router.get('/locations', async (req, res) => {
    try {
        const locations = await smartcarClient.getVehicleLocations();
        res.json(locations);
    } catch (error) {
        console.error('Error fetching vehicle locations:', error);
        res.status(500).json({ error: 'Failed to fetch vehicle locations' });
    }
});

router.get('/:vehicleId/location', async (req, res) => {
    try {
        const { vehicleId } = req.params;
        const location = await smartcarClient.getVehicleLocation(vehicleId);
        res.json(location);
    } catch (error) {
        console.error('Error fetching vehicle location:', error);
        res.status(500).json({ error: 'Failed to fetch vehicle location' });
    }
});

router.get('/:vehicleId/info', async (req, res) => {
    try {
        const { vehicleId } = req.params;
        const info = await smartcarClient.getVehicleInfo(vehicleId);
        res.json(info);
    } catch (error) {
        console.error('Error fetching vehicle info:', error);
        res.status(500).json({ error: 'Failed to fetch vehicle info' });
    }
});

router.get('/:vehicleId/diagnostics', async (req, res) => {
    try {
        const { vehicleId } = req.params;
        const diagnostics = await smartcarClient.getVehicleDiagnostics(vehicleId);
        res.json(diagnostics);
    } catch (error) {
        console.error('Error fetching vehicle diagnostics:', error);
        res.status(500).json({ error: 'Failed to fetch vehicle diagnostics' });
    }
});

// Get vehicles with names and locations
router.get('/with-names', async (req, res) => {
    try {
        const vehicles = await smartcarClient.getVehicles();
        const vehiclesWithNames = await Promise.all(
            vehicles.vehicles.map(async (vehicleId: string) => {
                try {
                    const location = await smartcarClient.getVehicleLocation(vehicleId);
                    const name = vehicleNaming.setVehicleName(vehicleId);
                    
                    // Map names to vehicle types for display
                    const vehicleTypes: { [key: string]: { model: string, year: string } } = {
                        'Van': { model: 'Transit', year: '2023' },
                        'Truck 1': { model: 'Lightning Pro', year: '2024' },
                        'Truck 2': { model: 'Lightning', year: '2023' },
                        'Truck 3': { model: 'F-150', year: '2023' }
                    };
                    
                    const vehicleType = vehicleTypes[name] || { model: 'Unknown', year: '2023' };
                    
                    return {
                        id: vehicleId,
                        name,
                        location,
                        make: 'Ford',
                        model: vehicleType.model,
                        year: vehicleType.year
                    };
                } catch (error) {
                    console.error(`Error fetching location for vehicle ${vehicleId}:`, error);
                    const name = vehicleNaming.setVehicleName(vehicleId);
                    return {
                        id: vehicleId,
                        name,
                        error: 'Failed to fetch location'
                    };
                }
            })
        );
        
        res.json({ vehicles: vehiclesWithNames });
    } catch (error) {
        console.error('Error fetching vehicles with names:', error);
        res.status(500).json({ error: 'Failed to fetch vehicles with names' });
    }
});

export default router;