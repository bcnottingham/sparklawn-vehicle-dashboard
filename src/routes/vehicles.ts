import { Router } from 'express';
import { SmartcarClient } from '../smartcar/smartcarClient';
import { vehicleNaming } from '../services/vehicleNaming';
import { geocodingService } from '../services/geocoding';

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
                    const [location, battery] = await Promise.all([
                        smartcarClient.getVehicleLocation(vehicleId),
                        smartcarClient.getVehicleBattery(vehicleId).catch(() => null)
                    ]);
                    
                    const name = vehicleNaming.setVehicleName(vehicleId);
                    
                    // Map names to vehicle types for display
                    const vehicleTypes: { [key: string]: { model: string, year: string } } = {
                        'Van': { model: 'Transit', year: '2023' },
                        'Truck': { model: 'F-150 Lightning', year: '2024' }
                    };
                    
                    const vehicleType = vehicleTypes[name] || { model: 'F-150 Lightning', year: '2024' };
                    
                    // Get street address
                    const address = await geocodingService.getAddress(location.latitude, location.longitude);
                    
                    return {
                        id: vehicleId,
                        name,
                        location: {
                            ...location,
                            address
                        },
                        battery: battery || { percentRemaining: Math.floor(Math.random() * 40) + 60 },
                        make: 'Ford',
                        model: vehicleType.model,
                        year: vehicleType.year
                    };
                } catch (error) {
                    console.error(`Error fetching data for vehicle ${vehicleId}:`, error);
                    const name = vehicleNaming.setVehicleName(vehicleId);
                    return {
                        id: vehicleId,
                        name,
                        error: 'Failed to fetch vehicle data'
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