import { FordPassClient, VehicleStatus } from './fordpassClient';
import { SmartcarClient } from '../smartcar/smartcarClient';
import { tripHistoryService } from './tripHistoryService';

export interface HybridVehicleData {
    id: string;
    name: string;
    location: {
        latitude: number;
        longitude: number;
        address?: string;
    };
    battery: {
        percentRemaining: number;
        range: number;
        isPluggedIn: boolean;
        isCharging: boolean;
        _isMockData: boolean;
        _dataSource: 'fordpass' | 'smartcar' | 'mock';
    };
    fuel?: {
        level: number;
        range: number;
    };
    locks?: {
        status: string;
    };
    ignition?: {
        status: string;
    };
    temperature?: {
        outside: number;
    };
    odometer?: number;
    make: string;
    model: string;
    year: string;
    lastUpdated: string;
}

export class HybridVehicleClient {
    private fordPassClient?: FordPassClient;
    private smartcarClient: SmartcarClient;
    private fordPassEnabled: boolean = false;
    
    constructor() {
        this.smartcarClient = new SmartcarClient();
        this.initializeFordPass();
    }
    
    private initializeFordPass(): void {
        try {
            // Check if FordPass credentials are configured
            const fordPassConfig = {
                username: process.env.FORDPASS_USERNAME || '',
                password: process.env.FORDPASS_PASSWORD || '',
                vin: process.env.FORDPASS_VIN || ''
            };
            
            if (fordPassConfig.username && fordPassConfig.password && fordPassConfig.vin) {
                this.fordPassClient = new FordPassClient(fordPassConfig);
                this.fordPassEnabled = true;
                console.log('✅ FordPass client initialized');
            } else {
                console.log('⚠️ FordPass credentials not configured, using Smartcar only');
            }
        } catch (error) {
            console.error('❌ Failed to initialize FordPass client:', error);
        }
    }
    
    async getVehicles(): Promise<{ vehicles: string[] }> {
        // Try FordPass first
        if (this.fordPassEnabled && this.fordPassClient) {
            try {
                // For now, return the configured VIN
                // In future, we could fetch vehicle list from FordPass
                return { vehicles: [process.env.FORDPASS_VIN || ''] };
            } catch (error) {
                console.warn('⚠️ FordPass getVehicles failed, falling back to Smartcar:', error);
            }
        }
        
        // Fallback to Smartcar
        return this.smartcarClient.getVehicles();
    }
    
    async getVehicleData(vehicleId: string): Promise<HybridVehicleData> {
        let vehicleData: HybridVehicleData;
        
        // Try FordPass first
        if (this.fordPassEnabled && this.fordPassClient) {
            try {
                console.log(`🔋 Attempting FordPass data for vehicle: ${vehicleId}`);
                const fordPassStatus = await this.fordPassClient.getVehicleStatus();
                const convertedData = this.fordPassClient.convertToStandardFormat(fordPassStatus);
                
                vehicleData = {
                    ...convertedData,
                    name: this.getVehicleName(vehicleId),
                    make: 'Ford',
                    model: 'F-150 Lightning', // TODO: Extract from FordPass data
                    year: '2024', // TODO: Extract from FordPass data
                    battery: {
                        ...convertedData.battery,
                        _dataSource: 'fordpass' as const
                    }
                };
                
                // Add geocoded address
                if (vehicleData.location.latitude && vehicleData.location.longitude) {
                    try {
                        const { geocodingService } = await import('./geocoding');
                        const address = await geocodingService.getAddress(
                            vehicleData.location.latitude,
                            vehicleData.location.longitude
                        );
                        vehicleData.location.address = address;
                    } catch (geocodeError) {
                        console.warn('Geocoding failed:', geocodeError);
                    }
                }
                
                console.log('✅ FordPass data retrieved successfully');
                
                // Record location for trip history
                await this.recordLocationForTrip(vehicleData);
                
                return vehicleData;
                
            } catch (error) {
                console.warn('⚠️ FordPass failed, falling back to Smartcar:', error);
            }
        }
        
        // Fallback to Smartcar
        console.log(`🔄 Using Smartcar fallback for vehicle: ${vehicleId}`);
        try {
            const [location, battery, info] = await Promise.all([
                this.smartcarClient.getVehicleLocation(vehicleId),
                this.smartcarClient.getVehicleBattery(vehicleId),
                this.smartcarClient.getVehicleInfo(vehicleId)
            ]);
            
            // Add geocoded address
            let address = '';
            if (location.latitude && location.longitude) {
                try {
                    const { geocodingService } = await import('./geocoding');
                    address = await geocodingService.getAddress(location.latitude, location.longitude);
                } catch (geocodeError) {
                    console.warn('Geocoding failed:', geocodeError);
                }
            }
            
            vehicleData = {
                id: vehicleId,
                name: this.getVehicleName(vehicleId),
                location: {
                    latitude: location.latitude,
                    longitude: location.longitude,
                    address
                },
                battery: {
                    percentRemaining: battery.percentRemaining || 0,
                    range: battery.range || 0,
                    isPluggedIn: battery.isPluggedIn || false,
                    isCharging: battery.isPluggedIn || false,
                    _isMockData: battery._isMockData || false,
                    _dataSource: 'smartcar' as const
                },
                make: info.make || 'Ford',
                model: info.model || 'Vehicle',
                year: info.year?.toString() || '2024',
                lastUpdated: new Date().toISOString()
            };
            
            // Record location for trip history
            await this.recordLocationForTrip(vehicleData);
            
            return vehicleData;
            
        } catch (smartcarError) {
            console.error('❌ Both FordPass and Smartcar failed:', smartcarError);
            throw new Error('Unable to retrieve vehicle data from any source');
        }
    }
    
    async getVehiclesWithDetails(): Promise<{ vehicles: HybridVehicleData[] }> {
        try {
            const vehicleList = await this.getVehicles();
            const vehicleDetails = await Promise.allSettled(
                vehicleList.vehicles.map(vehicleId => this.getVehicleData(vehicleId))
            );
            
            const successfulVehicles = vehicleDetails
                .filter((result): result is PromiseFulfilledResult<HybridVehicleData> => 
                    result.status === 'fulfilled'
                )
                .map(result => result.value);
            
            return { vehicles: successfulVehicles };
        } catch (error) {
            console.error('❌ Failed to get vehicles with details:', error);
            throw error;
        }
    }
    
    private getVehicleName(vehicleId: string): string {
        // Simple vehicle naming based on ID patterns
        if (vehicleId.includes('2dc0332a')) return 'Van';
        return 'Truck';
    }
    
    private async recordLocationForTrip(vehicleData: HybridVehicleData): Promise<void> {
        try {
            if (vehicleData.location && vehicleData.location.latitude && vehicleData.location.longitude) {
                await tripHistoryService.recordVehicleLocation(
                    vehicleData.id,
                    vehicleData.name,
                    vehicleData.location.latitude,
                    vehicleData.location.longitude,
                    vehicleData.battery.percentRemaining,
                    undefined, // speed - not available from current APIs
                    vehicleData.location.address,
                    vehicleData.battery._dataSource as 'fordpass' | 'smartcar' | 'mock'
                );
            }
        } catch (error) {
            console.error('❌ Failed to record location for trip history:', error);
            // Don't throw - this shouldn't break the main flow
        }
    }
    
    // Vehicle control methods (FordPass only)
    async startVehicle(vehicleId: string): Promise<any> {
        if (!this.fordPassEnabled || !this.fordPassClient) {
            throw new Error('FordPass not configured - vehicle controls unavailable');
        }
        return this.fordPassClient.startVehicle();
    }
    
    async stopVehicle(vehicleId: string): Promise<any> {
        if (!this.fordPassEnabled || !this.fordPassClient) {
            throw new Error('FordPass not configured - vehicle controls unavailable');
        }
        return this.fordPassClient.stopVehicle();
    }
    
    async lockVehicle(vehicleId: string): Promise<any> {
        if (!this.fordPassEnabled || !this.fordPassClient) {
            throw new Error('FordPass not configured - vehicle controls unavailable');
        }
        return this.fordPassClient.lockVehicle();
    }
    
    async unlockVehicle(vehicleId: string): Promise<any> {
        if (!this.fordPassEnabled || !this.fordPassClient) {
            throw new Error('FordPass not configured - vehicle controls unavailable');
        }
        return this.fordPassClient.unlockVehicle();
    }
}

export const hybridVehicleClient = new HybridVehicleClient();