import express from 'express';
import { getDatabase } from '../db/index';

const router = express.Router();

// Get charging history for a specific vehicle
router.get('/:vehicleId/charging-history', async (req, res) => {
    try {
        const { vehicleId } = req.params;
        console.log(`📊 Fetching charging history for vehicle: ${vehicleId}`);
        
        const db = await getDatabase();
        const collection = db.collection('vehicle-monitoring');
        
        // Build aggregation pipeline to find charging sessions
        const pipeline = [
            {
                $match: {
                    vehicleId: vehicleId,
                    'vehicle.battery.isPluggedIn': true,
                    timestamp: { 
                        $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
                    }
                }
            },
            {
                $sort: { timestamp: 1 }
            }
        ];
        
        const chargingData = await collection.aggregate(pipeline).toArray();
        console.log(`📊 Found ${chargingData.length} charging data points for ${vehicleId}`);
        
        // Process data to identify charging sessions
        const chargingSessions = identifyChargingSessions(chargingData);
        
        console.log(`📊 Identified ${chargingSessions.length} charging sessions for ${vehicleId}`);
        
        res.json({
            vehicleId,
            sessions: chargingSessions,
            totalSessions: chargingSessions.length
        });
        
    } catch (error) {
        console.error('❌ Error fetching charging history:', error);
        res.status(500).json({
            error: 'Failed to fetch charging history',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

function identifyChargingSessions(chargingData: any[]): any[] {
    if (chargingData.length === 0) return [];
    
    const sessions: any[] = [];
    let currentSession: any = null;
    
    // Group consecutive charging events into sessions
    for (let i = 0; i < chargingData.length; i++) {
        const dataPoint = chargingData[i];
        const battery = dataPoint.vehicle?.battery;
        const location = dataPoint.vehicle?.location;
        
        if (!battery) continue;
        
        const isCharging = battery.isCharging || battery.isPluggedIn;
        const batteryLevel = battery.percentRemaining;
        const timestamp = new Date(dataPoint.timestamp);
        
        if (isCharging) {
            if (!currentSession) {
                // Start new charging session
                currentSession = {
                    vehicleId: dataPoint.vehicleId,
                    startTime: timestamp,
                    startBatteryLevel: batteryLevel,
                    location: getLocationName(location),
                    maxBatteryLevel: batteryLevel,
                    dataPoints: []
                };
            }
            
            // Update session data
            currentSession.maxBatteryLevel = Math.max(currentSession.maxBatteryLevel, batteryLevel);
            currentSession.dataPoints.push({
                timestamp,
                batteryLevel,
                isCharging: battery.isCharging,
                isPluggedIn: battery.isPluggedIn
            });
            
        } else {
            // Not charging - end current session if it exists
            if (currentSession) {
                // Only save sessions that lasted more than 5 minutes and gained charge
                const duration = (timestamp.getTime() - new Date(currentSession.startTime).getTime()) / (1000 * 60);
                const chargeGained = currentSession.maxBatteryLevel - currentSession.startBatteryLevel;
                
                if (duration >= 5 && chargeGained >= 1) {
                    currentSession.endTime = timestamp;
                    currentSession.endBatteryLevel = currentSession.maxBatteryLevel;
                    currentSession.duration = duration;
                    currentSession.chargeAdded = chargeGained;
                    
                    // Calculate charge rate (% per hour)
                    const durationHours = duration / 60;
                    currentSession.chargeRate = chargeGained / durationHours;
                    
                    // Remove dataPoints to reduce response size
                    delete currentSession.dataPoints;
                    delete currentSession.maxBatteryLevel;
                    
                    sessions.push(currentSession);
                }
                
                currentSession = null;
            }
        }
    }
    
    // Handle ongoing charging session
    if (currentSession) {
        const now = new Date();
        const duration = (now.getTime() - new Date(currentSession.startTime).getTime()) / (1000 * 60);
        const chargeGained = currentSession.maxBatteryLevel - currentSession.startBatteryLevel;
        
        if (duration >= 5) {
            currentSession.duration = duration;
            currentSession.chargeAdded = chargeGained;
            currentSession.isOngoing = true;
            
            // Calculate charge rate for ongoing session
            const durationHours = duration / 60;
            currentSession.chargeRate = durationHours > 0 ? chargeGained / durationHours : 0;
            
            // Remove dataPoints to reduce response size
            delete currentSession.dataPoints;
            delete currentSession.maxBatteryLevel;
            
            sessions.push(currentSession);
        }
    }
    
    return sessions.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
}

function getLocationName(location: any): string {
    if (!location) return 'Unknown Location';
    
    if (location.clientName) {
        return location.clientName;
    }
    
    if (location.address) {
        return location.address;
    }
    
    if (location.latitude && location.longitude) {
        return `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`;
    }
    
    return 'Unknown Location';
}

export default router;