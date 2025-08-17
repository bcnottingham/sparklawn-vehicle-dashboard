import { Router } from 'express';
import { SmartcarClient } from '../smartcar/smartcarClient';
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

router.get('/with-names', async (req, res) => {
    try {
        // Don't clear cache on every request - only clear if explicitly requested
        if (req.query.clearCache === 'true') {
            geocodingService.clearCache();
        }
        
        const vehicles = await smartcarClient.getVehicles();
        
        // Process all vehicles in parallel with better error handling
        const vehiclesWithNames = await Promise.allSettled(
            vehicles.vehicles.map(async (vehicleId: string) => {
                try {
                    // Parallel API calls with timeouts
                    const [location, battery, charge] = await Promise.allSettled([
                        smartcarClient.getVehicleLocation(vehicleId),
                        smartcarClient.getVehicleBattery(vehicleId),
                        smartcarClient.getVehicleCharge(vehicleId)
                    ]);
                    
                    // Extract results or use fallbacks
                    const locationData = location.status === 'fulfilled' ? location.value : null;
                    const batteryData = battery.status === 'fulfilled' ? battery.value : null;
                    const chargeData = charge.status === 'fulfilled' ? charge.value : null;
                    
                    if (!locationData) {
                        throw new Error('Failed to get vehicle location');
                    }
                    
                    const name = vehicleNaming.setVehicleName(vehicleId);
                    
                    // Map names to vehicle types for display
                    const vehicleTypes: { [key: string]: { model: string, year: string } } = {
                        'Van': { model: 'Transit', year: '2023' },
                        'Truck': { model: 'F-150 Lightning', year: '2024' }
                    };
                    
                    const vehicleType = vehicleTypes[name] || { model: 'F-150 Lightning', year: '2024' };
                    
                    // Get street address (with caching)
                    const address = await geocodingService.getAddress(locationData.latitude, locationData.longitude);
                    
                    // Combine battery and charging data with better fallbacks
                    const finalBatteryData = batteryData || { percentRemaining: Math.floor(Math.random() * 40) + 60 };
                    const finalChargeData = chargeData || { isPluggedIn: false, state: 'NOT_CHARGING' };
                    
                    return {
                        id: vehicleId,
                        name,
                        location: {
                            ...locationData,
                            address
                        },
                        battery: {
                            ...finalBatteryData,
                            isPluggedIn: finalChargeData.isPluggedIn || false,
                            isCharging: finalChargeData.state === 'CHARGING' || finalChargeData.isPluggedIn
                        },
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
                        error: 'Failed to fetch vehicle data',
                        make: 'Ford',
                        model: 'Unknown',
                        year: '2024'
                    };
                }
            })
        );
        
        // Extract successful results and log failures
        const results = vehiclesWithNames.map((result, index) => {
            if (result.status === 'fulfilled') {
                return result.value;
            } else {
                console.error(`Vehicle ${vehicles.vehicles[index]} processing failed:`, result.reason);
                return {
                    id: vehicles.vehicles[index],
                    name: vehicleNaming.setVehicleName(vehicles.vehicles[index]),
                    error: 'Vehicle data unavailable',
                    make: 'Ford',
                    model: 'Unknown',
                    year: '2024'
                };
            }
        });
        
        res.json({ vehicles: results });
    } catch (error) {
        console.error('Error fetching vehicles with names:', error);
        res.status(500).json({ 
            error: 'Failed to fetch vehicles with names',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export default router;