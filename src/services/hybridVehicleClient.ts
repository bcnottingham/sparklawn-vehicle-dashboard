import { tripHistoryService } from './tripHistoryService';
import { geocodingService } from './geocoding';
import { clientLocationService } from './clientLocations';
import { getDatabase, getLatestSmartSignal } from '../db/index';
import { vehicleNaming } from './vehicleNaming';
import { parkingDetectionService } from './parkingDetectionService';
import TimezoneUtils from '../utils/timezone';

export interface HybridVehicleData {
    id: string;
    name: string;
    vin: string;
    location: {
        latitude: number;
        longitude: number;
        address?: string;
        clientName?: string;
    };
    battery: {
        percentRemaining: number;
        range: number;
        isPluggedIn: boolean;
        isCharging: boolean;
        _isMockData: boolean;
        _dataSource: 'ford-telematics' | 'mock';
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
    isOnTrip?: boolean;
    isMoving?: boolean;
    parkedDurationMinutes?: number;
    state?: string;
    stateDuration?: string;
}

export class HybridVehicleClient {
    private initialized: boolean = false;
    private vehicleVINs: string[] = [];

    constructor() {
        // Don't initialize in constructor - let it be lazy loaded
    }

    private async initialize(): Promise<void> {
        try {
            console.log('🔧 Initializing Ford Telematics client...');
            
            // Get VINs from environment variables
            const vins = [
                process.env.LIGHTNING_VIN,
                process.env.LIGHTNING_PRO_VIN,
                process.env.LIGHTNING_XLT_VIN,
                process.env.TRANSIT_VIN,
                process.env.ETRANSIT_VIN,
                process.env.LIGHTNING_2_VIN
            ].filter(Boolean) as string[];

            if (vins.length === 0) {
                throw new Error('No vehicle VINs configured in environment variables');
            }

            this.vehicleVINs = vins;
            this.initialized = true;
            
            console.log(`✅ Ford Telematics client initialized with ${vins.length} vehicles`);
            console.log(`   VINs: ${vins.join(', ')}`);
            
        } catch (error) {
            console.error('❌ Failed to initialize Ford Telematics client:', error);
            throw error;
        }
    }

    async getVehicles(): Promise<{ vehicles: string[] }> {
        if (!this.initialized) {
            await this.initialize();
        }
        
        return { vehicles: this.vehicleVINs };
    }

    async getVehicleData(vin: string): Promise<HybridVehicleData> {
        console.log(`📊 Fetching vehicle data for VIN: ${vin} from Ford Telematics API`);

        try {
            const db = await getDatabase();

            // Get vehicle state from MongoDB for trip tracking
            const vehicleState = await db.collection('vehicle_state').findOne({ vin: vin });

            // Use Ford Telematics API as primary data source - contains ALL vehicle data
            const { fordTelematicsClient } = await import('./fordTelematicsClient');

            // Request all available signals for electric vehicles
            const signalFilter = [
                'position',
                'odometer',
                'ignition_status',
                'xev_battery_state_of_charge',
                'xev_battery_range',
                'xev_plug_charger_status',
                'xev_battery_charge_display_status'
            ];

            const fordData = await fordTelematicsClient.instance.getVehicleStatus(vin, signalFilter);

            if (!fordData || !fordData.signals || Object.keys(fordData.signals).length === 0) {
                throw new Error(`No signals data available for ${vin} from Ford API`);
            }

            // Extract signals from Ford API response - signals are in an array with nested objects
            const signals = fordData.signals[0] as any; // Type as any since Ford API structure is complex

            console.log(`📊 Using Ford Telematics API for ${vin} - received ${Object.keys(signals).length} signals`);

            // Extract battery and vehicle data from Ford API signals (needed for state determination)
            let batterySOC = signals.xev_battery_state_of_charge?.value || 0;
            let batteryRangeKm = signals.xev_battery_range?.value || 0;
            let batteryRange = batteryRangeKm > 0 ? Math.round(batteryRangeKm * 0.621371) : 0; // Convert km to miles
            let isPluggedIn = signals.xev_plug_charger_status?.value === 'CONNECTED';
            let isCharging = signals.xev_battery_charge_display_status?.value === 'IN_PROGRESS';
            let odometerKm = signals.odometer?.value || 0;
            let odometer = odometerKm > 0 ? Math.round(odometerKm * 0.621371) : 0; // Convert km to miles

            // Extract ignition status from Ford API signals
            const ignitionStatus = signals.ignition_status?.value || 'Unknown';
            const isOnTripByIgnition = ['On', 'Run', 'Running', 'Started'].includes(ignitionStatus);

            // Use vehicle state from MongoDB for trip detection
            const isOnTrip = vehicleState?.state === 'TRIP' || isOnTripByIgnition;

            // Determine vehicle state early (before geocoding) for Places API fallback
            const preliminaryVehicleState = isOnTrip ? 'TRIP' : (isCharging ? 'CHARGING' : 'PARKED');

            // Extract position data from Ford API signals
            let latitude = signals.position?.value?.latitude || 0;
            let longitude = signals.position?.value?.longitude || 0;
            let address = 'Unknown Location';
            let clientName: string | undefined;

            console.log(`🔍 DEBUG: Extracted coordinates for ${vin}: lat=${latitude}, lng=${longitude}`);
            if (latitude !== 0 && longitude !== 0) {
                console.log(`🎯 Starting client location matching for ${vin} at ${latitude}, ${longitude}`);
                // Check for client location match first
                try {
                    clientName = await clientLocationService.findClientLocationMatch(latitude, longitude) || undefined;

                    // Check for client departure - if was at a client but now is not
                    const lastKnownClient = (vehicleState as any)?.lastKnownClient;
                    if (lastKnownClient && !clientName) {
                        // Vehicle has left a client location
                        const vehicleName = vehicleNaming.getVehicleName(vin);
                        console.log(`🚪 Vehicle ${vin} left client location: ${lastKnownClient}`);

                        // DISABLED: Only background monitoring should create departure alerts
                        // This prevents false alerts from frontend API refresh calls
                        console.log(`⚠️ Departure alert generation disabled for API calls to prevent false positives`);
                    }

                    if (clientName) {
                        console.log(`🎯 Vehicle ${vin} is at client location: ${clientName}`);
                        address = clientName; // Use client name as address

                        // Check for client arrival - if not previously at this client but now is
                        const lastKnownClient = (vehicleState as any)?.lastKnownClient;
                        if (lastKnownClient !== clientName) {
                            // Vehicle has arrived at a new client location or first time detection
                            const vehicleName = vehicleNaming.getVehicleName(vin);
                            console.log(`🎯 Vehicle ${vin} arrived at client location: ${clientName}`);

                            // DISABLED: Constant arrival alert generation from API calls
                            // Only background monitoring should create arrival/departure alerts
                            // This prevents false alerts from frontend refresh calls
                            console.log(`⚠️ Arrival alert generation disabled for API calls to prevent false positives`);

                            // Update lastKnownClient in vehicle state to prevent repeated processing
                            try {
                                await db.collection('vehicle_state').updateOne(
                                    { vin: vin },
                                    { $set: { lastKnownClient: clientName, lastUpdated: new Date() } }
                                );
                            } catch (error) {
                                console.warn(`Failed to update lastKnownClient for ${vin}:`, error);
                            }
                        }
                    } else {
                        // No client match - fallback to Google Places geocoding with vehicle state
                        try {
                            console.log(`🌐 No client match found, geocoding ${latitude}, ${longitude} (vehicle state: ${preliminaryVehicleState})...`);
                            address = await geocodingService.getAddress(latitude, longitude, preliminaryVehicleState);
                            console.log(`🌐 Geocoded address: ${address}`);
                        } catch (error) {
                            console.warn(`❌ Failed to geocode ${latitude}, ${longitude}:`, error);
                            // Final fallback: use stored address or coordinates
                            address = vehicleState?.lastKnownAddress || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
                        }
                    }
                } catch (error) {
                    console.warn(`Failed to check client location for ${vin}:`, error);
                    address = vehicleState?.lastKnownAddress || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
                }
            }

            console.log(`📊 Ford API telematics for ${vin}: Battery: ${batterySOC}%, Range: ${batteryRange}mi (${batteryRangeKm}km), Odometer: ${odometer}mi (${odometerKm}km), Charging: ${isCharging}, Plugged: ${isPluggedIn}`);

            // Get vehicle name
            const vehicleName = vehicleNaming.getVehicleName(vin);

            // Calculate state duration using proper trip tracking logic
            let stateDuration: string | undefined;
            let stateDurationMinutes: number | undefined;
            let vehicleStateValue: string | undefined;

            console.log(`🔍 DEBUG: Starting state duration calculation for ${vin}`);
            console.log(`🔍 DEBUG: isOnTrip=${isOnTrip}, isCharging=${isCharging}, ignitionStatus=${ignitionStatus}`);

            try {
                // Determine the current vehicle state
                if (isOnTrip) {
                    vehicleStateValue = 'TRIP';
                    console.log(`🔍 DEBUG: Vehicle ${vin} is ON TRIP - importing backgroundMonitoringService...`);

                    // Use trip duration calculation for ON TRIP vehicles
                    const { backgroundMonitoringService } = await import('./backgroundMonitoringService');
                    console.log(`🔍 DEBUG: Successfully imported backgroundMonitoringService for ${vin}`);

                    const tripStatus = await backgroundMonitoringService.getResilientTripStatus(vin);
                    console.log(`🔍 DEBUG: Trip status for ${vin}:`, JSON.stringify(tripStatus, null, 2));

                    if (tripStatus.isOnTrip) {
                        stateDuration = tripStatus.duration;
                        const durationMatch = stateDuration.match(/(\d+)/);
                        stateDurationMinutes = durationMatch ? parseInt(durationMatch[1]) : 0;
                        console.log(`🚗 ${vehicleName} (${vin}) ON TRIP for ${stateDuration} (trip tracking)`);
                    } else {
                        stateDuration = 'Less than 1m';
                        stateDurationMinutes = 0;
                        console.log(`🔍 DEBUG: Trip status says vehicle ${vin} is NOT on trip, using fallback duration`);
                    }
                } else {
                    // For CHARGING and PARKED vehicles, use corrected MongoDB stateSince timestamp
                    vehicleStateValue = isCharging ? 'CHARGING' : 'PARKED';
                    console.log(`🔍 DEBUG: Vehicle ${vin} is ${vehicleStateValue} - calculating duration from MongoDB stateSince...`);

                    // Use MongoDB vehicle_state.stateSince timestamp (already corrected for 18:16/18:17 arrival times)
                    if (vehicleState && vehicleState.stateSince) {
                        const stateSinceTime = new Date(vehicleState.stateSince);
                        const now = new Date();
                        const durationMs = now.getTime() - stateSinceTime.getTime();
                        const durationMinutes = Math.floor(durationMs / (1000 * 60));
                        const durationHours = Math.floor(durationMinutes / 60);
                        const durationDays = Math.floor(durationHours / 24);

                        // Format the duration
                        if (durationDays > 0) {
                            stateDuration = `${durationDays}d ${durationHours % 24}h ${durationMinutes % 60}m`;
                        } else if (durationHours > 0) {
                            stateDuration = `${durationHours}h ${durationMinutes % 60}m`;
                        } else if (durationMinutes > 0) {
                            stateDuration = `${durationMinutes}m`;
                        } else {
                            stateDuration = 'Less than 1m';
                        }

                        stateDurationMinutes = durationMinutes;

                        console.log(`📅 MongoDB stateSince: ${vehicleState.stateSince}`);
                        console.log(`⏰ Current time: ${now.toISOString()}`);
                        console.log(`⌛ Duration since state change: ${stateDuration} (${durationMinutes} minutes)`);
                        console.log(`${isCharging ? '🔌' : '🅿️'} ${vehicleName} (${vin}) ${vehicleStateValue} for ${stateDuration} (MongoDB stateSince-based)`);
                    } else {
                        // Fallback to backgroundMonitoringService if no MongoDB stateSince available
                        console.log(`🔍 DEBUG: No MongoDB stateSince available for ${vin}, falling back to backgroundMonitoringService...`);

                        const { backgroundMonitoringService } = await import('./backgroundMonitoringService');
                        const parkingStatus = await backgroundMonitoringService.getResilientParkingStatus(vin);
                        console.log(`🔍 DEBUG: Fallback parking status for ${vin}:`, JSON.stringify(parkingStatus, null, 2));

                        if (parkingStatus.isParked) {
                            stateDuration = parkingStatus.duration;
                            const durationMatch = stateDuration.match(/(\d+)/);
                            stateDurationMinutes = durationMatch ? parseInt(durationMatch[1]) : 0;
                            console.log(`${isCharging ? '🔌' : '🅿️'} ${vehicleName} (${vin}) ${vehicleStateValue} for ${stateDuration} (fallback parking tracking: ${parkingStatus.source})`);
                        } else {
                            stateDuration = 'Less than 1m';
                            stateDurationMinutes = 0;
                            console.log(`🔍 DEBUG: Fallback parking status says vehicle ${vin} is NOT parked, using default duration`);
                        }
                    }
                }

                console.log(`🔍 DEBUG: Final duration calculation for ${vin}: stateDuration=${stateDuration}, stateDurationMinutes=${stateDurationMinutes}, vehicleStateValue=${vehicleStateValue}`);

            } catch (error) {
                console.error(`❌ DURATION CALCULATION ERROR for ${vin}:`, error);
                console.error(`❌ Error stack:`, error instanceof Error ? error.stack : 'No stack trace');
                stateDuration = 'Unknown';
                stateDurationMinutes = 0;
            }

            const vehicleData: HybridVehicleData = {
                id: vin,
                name: vehicleName,
                vin: vin,
                location: {
                    latitude,
                    longitude,
                    address,
                    clientName
                },
                battery: {
                    percentRemaining: batterySOC,
                    range: batteryRange, // Already calculated in miles
                    isPluggedIn,
                    isCharging,
                    _isMockData: false,
                    _dataSource: 'ford-telematics'
                },
                fuel: signals.fuel_level ? {
                    level: signals.fuel_level.value,
                    range: 0
                } : undefined,
                ignition: {
                    status: ignitionStatus
                },
                odometer: odometer,
                make: 'Ford',
                model: this.getVehicleModel(vin),
                year: this.getVehicleYear(vin),
                lastUpdated: signals.position?.timestamp || signals.ignition_status?.timestamp || new Date().toISOString(),
                isOnTrip,
                isMoving: isOnTrip,
                parkedDurationMinutes: stateDurationMinutes,
                state: vehicleStateValue,
                stateDuration: stateDuration
            };

            console.log(`✅ Successfully processed MongoDB data for ${vehicleName} (${vin})`);
            console.log(`   Battery: ${batterySOC}%, Range: ${vehicleData.battery.range} mi, Status: ${ignitionStatus}`);

            return vehicleData;

        } catch (error) {
            console.error(`❌ Failed to get MongoDB data for ${vin}:`, error);

            // Return a placeholder with error info
            return {
                id: vin,
                name: vehicleNaming.getVehicleName(vin),
                vin: vin,
                location: {
                    latitude: 0,
                    longitude: 0,
                    address: 'Error: Unable to fetch location from MongoDB'
                },
                battery: {
                    percentRemaining: 0,
                    range: 0,
                    isPluggedIn: false,
                    isCharging: false,
                    _isMockData: false,
                    _dataSource: 'ford-telematics'
                },
                ignition: {
                    status: 'Unknown'
                },
                make: 'Ford',
                model: this.getVehicleModel(vin),
                year: this.getVehicleYear(vin),
                lastUpdated: new Date().toISOString(),
                isOnTrip: false,
                isMoving: false
            };
        }
    }

    async getVehiclesWithDetails(): Promise<{ vehicles: HybridVehicleData[] }> {
        try {
            const vehicleList = await this.getVehicles();
            console.log(`🔄 Fetching details for ${vehicleList.vehicles.length} vehicles...`);
            
            const vehicleDetails = await Promise.allSettled(
                vehicleList.vehicles.map(vin => this.getVehicleData(vin))
            );

            const successfulVehicles = vehicleDetails
                .filter((result): result is PromiseFulfilledResult<HybridVehicleData> => 
                    result.status === 'fulfilled'
                )
                .map(result => result.value);

            console.log(`✅ Successfully retrieved data for ${successfulVehicles.length}/${vehicleList.vehicles.length} vehicles`);
            return { vehicles: successfulVehicles };
            
        } catch (error) {
            console.error('❌ Failed to get vehicles with details:', error);
            throw error;
        }
    }

    private getVehicleName(vin: string): string {
        // Direct VIN mapping - VIN ending in 0591 is eTransit Van, others are Lightnings
        if (vin.endsWith('0591')) return 'eTransit Van';
        
        // Map VINs to friendly names based on environment variables
        if (vin === process.env.LIGHTNING_VIN) return 'Lightning 1';
        if (vin === process.env.LIGHTNING_PRO_VIN) return 'Lightning Pro';
        if (vin === process.env.LIGHTNING_XLT_VIN) return 'Lightning XLT';
        if (vin === process.env.TRANSIT_VIN) return 'eTransit Van';
        if (vin === process.env.LIGHTNING_2_VIN) return 'Lightning 2';
        
        // Fallback based on VIN pattern
        if (vin.includes('3FTTK8')) return 'F-150 Lightning';
        if (vin.includes('3PCAJ')) return 'Transit Van';
        if (vin.includes('1FT')) return 'Ford Lightning'; // Ford F-150 Lightning pattern
        if (vin.includes('1FTVW')) return 'Ford Lightning'; // Ford F-150 Lightning pattern
        
        return 'Unknown Vehicle';
    }

    private getVehicleModel(vin: string): string {
        // Direct VIN mapping - VIN ending in 0591 is eTransit Van
        if (vin.endsWith('0591')) return 'eTransit';
        
        if (vin.includes('3FTTK8')) return 'F-150 Lightning';
        if (vin.includes('3PCAJ')) return 'Transit';
        return 'Unknown';
    }

    private getVehicleYear(vin: string): string {
        // VIN position 10 indicates year - simplified mapping
        const yearCode = vin.charAt(9);
        const yearMap: { [key: string]: string } = {
            'N': '2022',
            'P': '2023', 
            'R': '2024',
            'S': '2025'
        };
        
        return yearMap[yearCode] || '2023';
    }
}

export const hybridVehicleClient = new HybridVehicleClient();