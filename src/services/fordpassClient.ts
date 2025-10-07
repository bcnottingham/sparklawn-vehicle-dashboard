import fetch from 'node-fetch';
import { createHash, randomBytes } from 'crypto';

// FordPass API endpoints (updated August 2024)
const FORDPASS_BASE_URL = 'https://usapi.cv.ford.com/api';
const GUARD_URL = 'https://api.mps.ford.com/api';
const AUTH_URL = 'https://sso.ci.ford.com';
const AUTONOMIC_URL = 'https://api.autonomic.ai/v1';
const AUTONOMIC_ACCOUNT_URL = 'https://accounts.autonomic.ai/v1';
const APPLICATION_ID = '9fb503e0-715b-47e8-adfd-ad4b7770f73b';

// OAuth2 constants from working 1.70 implementation
const OAUTH_CLIENT_ID = '9fb503e0-715b-47e8-adfd-ad4b7770f73b';
const OAUTH_REDIRECT_URI = 'fordapp://userauthorized';
const OAUTH_SCOPE = 'openid';

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
    private codeVerifier?: string;
    private codeChallenge?: string;
    
    constructor(config: FordPassConfig) {
        this.username = config.username;
        this.password = config.password;
        this.vin = config.vin;
    }
    
    // OAuth2 helper methods from working 1.70 implementation
    private generateCodeVerifier(): string {
        return randomBytes(32).toString('base64url');
    }
    
    private generateCodeChallenge(verifier: string): string {
        return createHash('sha256').update(verifier).digest('base64url');
    }
    
    private generateAuthorizationUrl(): string {
        this.codeVerifier = this.generateCodeVerifier();
        this.codeChallenge = this.generateCodeChallenge(this.codeVerifier);
        
        const params = new URLSearchParams({
            'client_id': OAUTH_CLIENT_ID,
            'redirect_uri': OAUTH_REDIRECT_URI,
            'response_type': 'code',
            'scope': OAUTH_SCOPE,
            'code_challenge': this.codeChallenge,
            'code_challenge_method': 'S256'
        });
        
        return `${AUTH_URL}/oidc/endpoint/default/authorize?${params.toString()}`;
    }
    
    // Direct password authentication method (bypass OAuth2 due to Ford SSO DNS issues)
    public async authenticateDirectly(): Promise<void> {
        try {
            console.log('🔐 Attempting direct FordPass authentication...');
            
            const tokenData = new URLSearchParams({
                'client_id': '9fb503e0-715b-47e8-adfd-ad4b7770f73b',
                'grant_type': 'password',
                'username': this.username,
                'password': this.password
            });
            
            const tokenResponse = await fetch('https://fcis.ice.ibmcloud.com/v1.0/endpoint/default/token', {
                method: 'POST',
                headers: {
                    'Accept': '*/*',
                    'Accept-Language': 'en-us',
                    'User-Agent': 'fordpass-na/353 CFNetwork/1121.2.2 Darwin/19.3.0',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: tokenData
            });
            
            if (!tokenResponse.ok) {
                throw new Error(`Direct authentication failed: ${tokenResponse.status} ${tokenResponse.statusText}`);
            }
            
            const tokenResult = await tokenResponse.json() as any;
            this.accessToken = tokenResult.access_token;
            this.refreshToken = tokenResult.refresh_token;
            this.tokenExpiry = new Date(Date.now() + (tokenResult.expires_in * 1000));
            
            console.log('✅ FordPass direct authentication successful');
        } catch (error) {
            console.error('❌ Direct authentication failed:', error);
            throw new Error('FordPass direct authentication failed');
        }
    }
    
    // Public method to get authorization URL for manual token capture (fallback)
    public getAuthorizationUrl(): string {
        console.log('⚠️ Ford SSO domain has DNS issues. Trying direct authentication instead...');
        return 'Direct authentication will be attempted automatically';
    }
    
    // Method to exchange authorization code for tokens
    public async exchangeCodeForTokens(authCode: string): Promise<void> {
        if (!this.codeVerifier) {
            throw new Error('Code verifier not generated. Call getAuthorizationUrl() first.');
        }
        
        try {
            console.log('🔄 Exchanging authorization code for tokens...');
            
            const tokenData = new URLSearchParams({
                'client_id': OAUTH_CLIENT_ID,
                'grant_type': 'authorization_code',
                'code': authCode,
                'redirect_uri': OAUTH_REDIRECT_URI,
                'code_verifier': this.codeVerifier
            });
            
            const tokenResponse = await fetch('https://fcis.ice.ibmcloud.com/v1.0/endpoint/default/token', {
                method: 'POST',
                headers: {
                    'Accept': '*/*',
                    'Accept-Language': 'en-us',
                    'User-Agent': 'fordpass-na/353 CFNetwork/1121.2.2 Darwin/19.3.0',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: tokenData
            });
            
            if (!tokenResponse.ok) {
                throw new Error(`Token exchange failed: ${tokenResponse.status} ${tokenResponse.statusText}`);
            }
            
            const tokenResult = await tokenResponse.json() as any;
            this.accessToken = tokenResult.access_token;
            this.refreshToken = tokenResult.refresh_token;
            this.tokenExpiry = new Date(Date.now() + (tokenResult.expires_in * 1000));
            
            console.log('✅ FordPass OAuth2 tokens obtained successfully');
        } catch (error) {
            console.error('❌ Token exchange failed:', error);
            throw new Error('FordPass token exchange failed');
        }
    }
    
    private async authenticate(): Promise<void> {
        // Use direct authentication method
        await this.authenticateDirectly();
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
                'User-Agent': 'fordpass-na/353 CFNetwork/1121.2.2 Darwin/19.3.0',
                'Accept-Encoding': 'gzip, deflate, br',
                'Application-Id': '71A3AD0A-CF46-4CCF-B473-FC7FE5BC4592',
                'Content-Type': 'application/json',
                'auth-token': this.accessToken || ''
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