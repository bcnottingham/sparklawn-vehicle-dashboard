import { Router } from 'express';
import { SmartcarClient } from '../smartcar/smartcarClient';
import { hybridVehicleClient } from '../services/hybridVehicleClient';
import { vehicleNaming } from '../services/vehicleNaming';
import { geocodingService } from '../services/geocoding';

const router = Router();
const smartcarClient = new SmartcarClient();

// Smartcar Connect URL for reconnecting vehicles
router.get('/connect', (req, res) => {
    const clientId = process.env.SMARTCAR_CLIENT_ID;
    const redirectUri = process.env.SMARTCAR_REDIRECT_URI || 'https://sparklawn-vehicle-dashboard.onrender.com/auth/smartcar/callback';
    
    if (!clientId) {
        return res.status(400).json({ error: 'Smartcar client ID not configured' });
    }

    const scope = ['read_vehicle_info', 'read_location', 'read_odometer'].join(' ');
    const connectUrl = `https://connect.smartcar.com/oauth/authorize?` +
        `response_type=code&` +
        `client_id=${clientId}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `scope=${encodeURIComponent(scope)}&` +
        `state=sparklawn-connect`;

    res.json({
        message: 'Visit this URL to reconnect your vehicles',
        connectUrl: connectUrl,
        instructions: [
            '1. Click the URL below to open Smartcar Connect',
            '2. Log in with your Ford account',
            '3. Authorize SparkLawn to access your vehicles',
            '4. You will be redirected back with fresh tokens'
        ]
    });
});

router.get('/', async (req, res) => {
    try {
        console.log('🚗 Attempting to fetch vehicles...');
        const vehicles = await smartcarClient.getVehicles();
        console.log('✅ Vehicles fetched successfully:', vehicles);
        res.json(vehicles);
    } catch (error) {
        console.error('❌ Error fetching vehicles:', error);
        res.status(500).json({ 
            error: 'Failed to fetch vehicles',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
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
        
        // Validate vehicle ID format
        if (!vehicleId || vehicleId.length < 10) {
            return res.status(400).json({ 
                error: 'Invalid vehicle ID format',
                details: 'Vehicle ID must be a valid UUID'
            });
        }
        
        const location = await smartcarClient.getVehicleLocation(vehicleId);
        res.json(location);
    } catch (error) {
        console.error('Error fetching vehicle location:', error);
        
        // Better error handling based on error type
        if (error instanceof Error) {
            if (error.message.includes('Unauthorized') || error.message.includes('401')) {
                return res.status(401).json({ 
                    error: 'Authentication failed',
                    details: 'Vehicle access token may be expired'
                });
            }
            if (error.message.includes('Not Found') || error.message.includes('404')) {
                return res.status(404).json({ 
                    error: 'Vehicle not found',
                    details: 'Vehicle ID does not exist or is not accessible'
                });
            }
            if (error.message.includes('Too Many Requests') || error.message.includes('429')) {
                return res.status(429).json({ 
                    error: 'Rate limit exceeded',
                    details: 'Too many requests. Please try again later.'
                });
            }
        }
        
        res.status(500).json({ 
            error: 'Failed to fetch vehicle location',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

router.get('/:vehicleId/info', async (req, res) => {
    try {
        const { vehicleId } = req.params;
        
        // Validate vehicle ID format
        if (!vehicleId || vehicleId.length < 10) {
            return res.status(400).json({ 
                error: 'Invalid vehicle ID format',
                details: 'Vehicle ID must be a valid UUID'
            });
        }
        
        const info = await smartcarClient.getVehicleInfo(vehicleId);
        res.json(info);
    } catch (error) {
        console.error('Error fetching vehicle info:', error);
        
        // Better error handling
        if (error instanceof Error) {
            if (error.message.includes('Unauthorized') || error.message.includes('401')) {
                return res.status(401).json({ error: 'Authentication failed' });
            }
            if (error.message.includes('Not Found') || error.message.includes('404')) {
                return res.status(404).json({ error: 'Vehicle not found' });
            }
        }
        
        res.status(500).json({ 
            error: 'Failed to fetch vehicle info',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Get battery status for a specific vehicle
router.get('/:vehicleId/battery', async (req, res) => {
    try {
        const { vehicleId } = req.params;
        
        // Validate vehicle ID format
        if (!vehicleId || vehicleId.length < 10) {
            return res.status(400).json({ 
                error: 'Invalid vehicle ID format',
                details: 'Vehicle ID must be a valid UUID'
            });
        }
        
        console.log(`🔋 Fetching battery data for vehicle: ${vehicleId}`);
        const battery = await smartcarClient.getVehicleBattery(vehicleId);
        console.log(`🔋 Battery response:`, battery);
        
        res.json({
            vehicleId,
            battery,
            timestamp: new Date().toISOString(),
            dataSource: battery.percentRemaining >= 60 && battery.percentRemaining <= 100 ? 'possibly_mock' : 'likely_real'
        });
    } catch (error) {
        console.error('Error fetching vehicle battery:', error);
        res.status(500).json({ 
            error: 'Failed to fetch vehicle battery',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Get charging status for a specific vehicle
router.get('/:vehicleId/charge', async (req, res) => {
    try {
        const { vehicleId } = req.params;
        
        // Validate vehicle ID format
        if (!vehicleId || vehicleId.length < 10) {
            return res.status(400).json({ 
                error: 'Invalid vehicle ID format',
                details: 'Vehicle ID must be a valid UUID'
            });
        }
        
        console.log(`⚡ Fetching charging data for vehicle: ${vehicleId}`);
        const charge = await smartcarClient.getVehicleCharge(vehicleId);
        console.log(`⚡ Charging response:`, charge);
        
        res.json({
            vehicleId,
            charge,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching vehicle charge:', error);
        res.status(500).json({ 
            error: 'Failed to fetch vehicle charge',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
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
// Debug endpoint to check token manager status
router.get('/debug', async (req, res) => {
    try {
        const { tokenManager } = await import('../services/tokenManager');
        const tokens = await tokenManager.getCurrentTokens();
        res.json({
            mongodb_uri: process.env.MONGODB_URI ? 'Set' : 'Not set',
            has_tokens: !!tokens,
            token_expires_at: tokens?.expiresAt || 'N/A',
            client_id: process.env.SMARTCAR_CLIENT_ID || 'Not set',
            fallback_access_token: process.env.SMARTCAR_ACCESS_TOKEN ? 'Set' : 'Not set'
        });
    } catch (error) {
        res.json({
            error: error instanceof Error ? error.message : 'Unknown error',
            mongodb_uri: process.env.MONGODB_URI ? 'Set' : 'Not set',
            client_id: process.env.SMARTCAR_CLIENT_ID || 'Not set'
        });
    }
});

// Get all vehicles with detailed information - HYBRID FordPass + Smartcar
router.get('/with-names', async (req, res) => {
    try {
        console.log('🚗 Fetching vehicles using hybrid client (FordPass primary, Smartcar fallback)');
        
        // Clear geocoding cache if requested
        if (req.query.clearCache === 'true') {
            geocodingService.clearCache();
        }
        
        const result = await hybridVehicleClient.getVehiclesWithDetails();
        
        res.json({ 
            vehicles: result.vehicles,
            count: result.vehicles.length,
            timestamp: new Date().toISOString(),
            dataSources: result.vehicles.map(v => ({
                id: v.id,
                name: v.name,
                source: v.battery._dataSource,
                isMockData: v.battery._isMockData
            }))
        });
        
        console.log(`✅ Successfully retrieved ${result.vehicles.length} vehicles`);
        
    } catch (error) {
        console.error('❌ Hybrid client failed, attempting emergency Smartcar fallback:', error);
        
        // Emergency fallback to pure Smartcar
        try {
            const vehicles = await smartcarClient.getVehicles();
            const vehiclesWithNames = await Promise.allSettled(
                vehicles.vehicles.map(async (vehicleId: string) => {
                    const [location, battery] = await Promise.allSettled([
                        smartcarClient.getVehicleLocation(vehicleId),
                        smartcarClient.getVehicleBattery(vehicleId)
                    ]);
                    
                    const locationData = location.status === 'fulfilled' ? location.value : null;
                    const batteryData = battery.status === 'fulfilled' ? battery.value : { 
                        percentRemaining: 0, 
                        range: 0, 
                        isPluggedIn: false,
                        _isMockData: true 
                    };
                    
                    const name = vehicleNaming.setVehicleName(vehicleId);
                    const vehicleTypes: { [key: string]: { model: string, year: string } } = {
                        'Van': { model: 'Transit', year: '2023' },
                        'Truck': { model: 'F-150 Lightning', year: '2024' }
                    };
                    const vehicleType = vehicleTypes[name] || { model: 'F-150 Lightning', year: '2024' };
                    
                    let address = 'Location unavailable';
                    if (locationData) {
                        try {
                            address = await geocodingService.getAddress(locationData.latitude, locationData.longitude);
                        } catch (geocodeError) {
                            address = `${locationData.latitude.toFixed(4)}, ${locationData.longitude.toFixed(4)}`;
                        }
                    }
                    
                    return {
                        id: vehicleId,
                        name,
                        location: locationData ? {
                            latitude: locationData.latitude,
                            longitude: locationData.longitude,
                            address
                        } : null,
                        battery: {
                            percentRemaining: batteryData.percentRemaining || 0,
                            range: batteryData.range || 0,
                            isPluggedIn: batteryData.isPluggedIn || false,
                            isCharging: batteryData.isPluggedIn || false,
                            _isMockData: true,
                            _dataSource: 'smartcar-emergency'
                        },
                        make: 'Ford',
                        model: vehicleType.model,
                        year: vehicleType.year,
                        lastUpdated: new Date().toISOString()
                    };
                })
            );
            
            const successfulVehicles = vehiclesWithNames
                .filter((result): result is PromiseFulfilledResult<any> => 
                    result.status === 'fulfilled'
                )
                .map(result => result.value);
            
            res.json({ 
                vehicles: successfulVehicles,
                count: successfulVehicles.length,
                timestamp: new Date().toISOString(),
                warning: '⚠️ Using emergency Smartcar fallback - FordPass unavailable',
                dataSources: successfulVehicles.map(v => ({
                    id: v.id,
                    name: v.name,
                    source: 'smartcar-emergency',
                    isMockData: true
                }))
            });
            
            console.log('⚠️ Emergency Smartcar fallback successful');
            
        } catch (emergencyError) {
            console.error('❌ All vehicle data sources failed:', emergencyError);
            res.status(500).json({ 
                error: 'All vehicle data sources failed',
                details: 'Both FordPass and Smartcar are unavailable',
                timestamp: new Date().toISOString()
            });
        }
    }
});

export default router;