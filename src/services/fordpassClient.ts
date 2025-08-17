import fetch from 'node-fetch';

// FordPass API endpoints (reverse engineered)
const FORDPASS_BASE_URL = 'https://usapi.cv.ford.com';
const AUTH_URL = 'https://sso.ci.ford.com';
const APPLICATION_ID = '71A3AD0A-CF46-4CCF-B473-FC7FE5BC4592';

export interface FordPassConfig {
    username: string;
    password: string;
    vin: string;
}

export interface FordPassCredentials {
    username: string;
    password: string;
    vehicles: Array<{
        vin: string;
        nickname?: string;
    }>;
}

export interface VehicleStatus {
    // Location data
    gps: {
        latitude: number;
        longitude: number;
        speed?: number;
    };
    
    // Battery data (for EVs)
    batteryFillLevel: {
        value: number; // percentage 0-100
        distanceToEmpty: number; // miles
        timestamp: string;
    };
    
    // Charging data
    chargingStatus: {
        value: string; // "ChargingAC", "ChargingDC", "NotCharging"
        chargeEndTime?: string;
        chargeStartTime?: string;
        chargerPowerType?: string;
    };
    
    // Plug status
    plugStatus: {
        value: number; // 0 = unplugged, 1 = plugged
    };
    
    // Fuel data (for hybrids/gas)
    fuel: {
        fuelLevel: number; // percentage
        distanceToEmpty: number; // miles
    };
    
    // Vehicle status
    ignitionStatus: {
        value: string; // "Off", "Run", "Accessory"
    };
    
    // Door/Lock status
    doorStatus: Array<{
        direction: string;
        doorStatus: {
            value: string; // "Closed", "Open"
        };
    }>;
    
    lockStatus: {
        value: string; // "Locked", "Unlocked"
    };
    
    // Temperature
    outsideTemperature: {
        value: number; // Fahrenheit
    };
    
    // Other sensors
    odometer: {
        value: number;
    };
    
    alarmStatus: {
        value: string;
    };
    
    // Tire pressure
    tirePressure: Array<{
        location: string;
        value: number; // PSI
    }>;
    
    // Oil life
    oilLife: {
        value: number; // percentage
    };
    
    // 12V battery
    battery: {
        batteryStatusActual: {
            value: string; // "STATUS_GOOD", "STATUS_LOW"
        };
    };
}

export class FordPassClient {
    private username: string;
    private password: string;
    private vin: string;
    private accessToken?: string;
    private refreshToken?: string;
    private tokenExpiry?: Date;
    
    constructor(config: FordPassConfig) {
        this.username = config.username;
        this.password = config.password;
        this.vin = config.vin;
    }
    
    private async authenticate(): Promise<void> {
        try {
            console.log('🔐 Authenticating with FordPass...');
            
            // Step 1: Get auth code
            const authResponse = await fetch(`${AUTH_URL}/oidc/endpoint/default/authorize`, {
                method: 'GET',
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-us',
                    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_6_1 like Mac OS X) AppleWebKit/605.1.15'
                }
            });
            
            // Step 2: Login with credentials
            const loginData = new URLSearchParams({
                'operation': 'verify',
                'login-form-type': 'pwd',
                'username': this.username,
                'password': this.password
            });
            
            const loginResponse = await fetch(`${AUTH_URL}/oidc/endpoint/default/authorize`, {
                method: 'POST',
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_6_1 like Mac OS X) AppleWebKit/605.1.15'
                },
                body: loginData
            });
            
            // Step 3: Get access token
            const tokenData = {
                'client_id': APPLICATION_ID,
                'grant_type': 'authorization_code',
                'code': 'extracted_auth_code' // This needs to be extracted from the login response
            };
            
            const tokenResponse = await fetch(`${AUTH_URL}/oidc/endpoint/default/token`, {
                method: 'POST',
                headers: {
                    'Accept': '*/*',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'FordPass/5 CFNetwork/1197 Darwin/20.0.0'
                },
                body: new URLSearchParams(tokenData)
            });
            
            const tokenResult = await tokenResponse.json() as any;
            this.accessToken = tokenResult.access_token;
            this.refreshToken = tokenResult.refresh_token;
            this.tokenExpiry = new Date(Date.now() + (tokenResult.expires_in * 1000));
            
            console.log('✅ FordPass authentication successful');
        } catch (error) {
            console.error('❌ FordPass authentication failed:', error);
            throw new Error('FordPass authentication failed');
        }
    }
    
    private async ensureValidToken(): Promise<void> {
        if (!this.accessToken || !this.tokenExpiry || this.tokenExpiry <= new Date()) {
            await this.authenticate();
        }
    }
    
    private async makeApiCall(endpoint: string, method: string = 'GET', body?: any): Promise<any> {
        await this.ensureValidToken();
        
        const response = await fetch(`${FORDPASS_BASE_URL}${endpoint}`, {
            method,
            headers: {
                'Accept': '*/*',
                'Accept-Language': 'en-us',
                'Authorization': `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json',
                'Application-Id': APPLICATION_ID,
                'User-Agent': 'FordPass/5 CFNetwork/1197 Darwin/20.0.0'
            },
            body: body ? JSON.stringify(body) : undefined
        });
        
        if (!response.ok) {
            throw new Error(`FordPass API error: ${response.status} ${response.statusText}`);
        }
        
        return response.json();
    }
    
    async getVehicleStatus(): Promise<VehicleStatus> {
        try {
            console.log(`🚗 Fetching FordPass vehicle status for VIN: ${this.vin}`);
            const data = await this.makeApiCall(`/api/vehicles/v4/${this.vin}/status`);
            console.log('✅ FordPass vehicle status retrieved');
            return data.vehiclestatus;
        } catch (error) {
            console.error('❌ Failed to get FordPass vehicle status:', error);
            throw error;
        }
    }
    
    async startVehicle(): Promise<any> {
        console.log(`🚗 Starting vehicle via FordPass...`);
        return this.makeApiCall(`/api/vehicles/v2/${this.vin}/engine/start`, 'PUT');
    }
    
    async stopVehicle(): Promise<any> {
        console.log(`🚗 Stopping vehicle via FordPass...`);
        return this.makeApiCall(`/api/vehicles/v2/${this.vin}/engine/stop`, 'DELETE');
    }
    
    async lockVehicle(): Promise<any> {
        console.log(`🔒 Locking vehicle via FordPass...`);
        return this.makeApiCall(`/api/vehicles/v2/${this.vin}/doors/lock`, 'PUT');
    }
    
    async unlockVehicle(): Promise<any> {
        console.log(`🔓 Unlocking vehicle via FordPass...`);
        return this.makeApiCall(`/api/vehicles/v2/${this.vin}/doors/unlock`, 'DELETE');
    }
    
    // Convert FordPass data to our standard format
    convertToStandardFormat(fordPassData: VehicleStatus): any {
        return {
            id: this.vin,
            location: {
                latitude: fordPassData.gps?.latitude || 0,
                longitude: fordPassData.gps?.longitude || 0
            },
            battery: {
                percentRemaining: fordPassData.batteryFillLevel?.value || 0,
                range: fordPassData.batteryFillLevel?.distanceToEmpty || 0,
                isPluggedIn: fordPassData.plugStatus?.value === 1,
                isCharging: fordPassData.chargingStatus?.value?.includes('Charging') || false,
                _isMockData: false
            },
            fuel: {
                level: fordPassData.fuel?.fuelLevel || 0,
                range: fordPassData.fuel?.distanceToEmpty || 0
            },
            locks: {
                status: fordPassData.lockStatus?.value || 'Unknown'
            },
            ignition: {
                status: fordPassData.ignitionStatus?.value || 'Unknown'
            },
            temperature: {
                outside: fordPassData.outsideTemperature?.value || 0
            },
            odometer: fordPassData.odometer?.value || 0,
            lastUpdated: new Date().toISOString()
        };
    }
}