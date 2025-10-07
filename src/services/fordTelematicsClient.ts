import fetch from 'node-fetch';

interface FordTelematicsConfig {
    clientId: string;
    clientSecret: string;
    baseUrl: string;
}

interface FordTelematicsToken {
    access_token: string;
    token_type: string;
    expires_in: string;
}

interface VehicleSignal {
    timestamp: string;
    value: any;
}

interface VehicleStatus {
    vin: string;
    fuelType: string;
    signals: {
        [key: string]: VehicleSignal;
    };
}

interface VehicleMetadata {
    vin: string;
    vehicle_name: string;
    make: string;
    model: string;
    year: number;
}

export interface TripSummary {
    tripStartTime: string;
    startPosition: {
        latitude: number;
        longitude: number;
    };
    startOdometer: number;
    tripEndTime: string;
    endPosition: {
        latitude: number;
        longitude: number;
    };
    endOdometer: number;
    tripDistance: number;
}

export class FordTelematicsClient {
    private config: FordTelematicsConfig;
    private cachedToken: FordTelematicsToken | null = null;
    private tokenExpiry: Date | null = null;
    private tokenRefreshTimer: NodeJS.Timeout | null = null;
    private isRefreshing: boolean = false;

    constructor(config: FordTelematicsConfig) {
        this.config = config;
    }

    /**
     * Start proactive token refresh mechanism
     * Refreshes token automatically 30 seconds before expiration
     */
    private startTokenRefreshTimer(): void {
        // Clear existing timer if any
        if (this.tokenRefreshTimer) {
            clearTimeout(this.tokenRefreshTimer);
        }

        if (!this.tokenExpiry) {
            return;
        }

        // Calculate when to refresh (30 seconds before expiry)
        const refreshBuffer = 30000; // 30 seconds
        const now = Date.now();
        const expiryTime = this.tokenExpiry.getTime();
        const refreshTime = expiryTime - refreshBuffer;
        const timeUntilRefresh = Math.max(0, refreshTime - now);

        console.log(`⏰ Scheduling token refresh in ${Math.round(timeUntilRefresh / 1000)}s (30s before expiry)`);

        this.tokenRefreshTimer = setTimeout(async () => {
            console.log('🔄 Proactive token refresh triggered');
            try {
                await this.refreshToken();
            } catch (error) {
                console.error('❌ Proactive token refresh failed:', error);
                // Retry in 10 seconds if refresh fails
                setTimeout(() => this.refreshToken(), 10000);
            }
        }, timeUntilRefresh);
    }

    /**
     * Force refresh the token
     */
    private async refreshToken(): Promise<string> {
        // Prevent concurrent refresh attempts
        if (this.isRefreshing) {
            console.log('⏳ Token refresh already in progress, waiting...');
            while (this.isRefreshing) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            if (this.cachedToken) {
                return this.cachedToken.access_token;
            }
        }

        this.isRefreshing = true;

        try {
            console.log('🔑 Refreshing Ford Telematics auth token...');

            const url = `${this.config.baseUrl}/token`;
            const body = `clientId=${encodeURIComponent(this.config.clientId)}&clientSecret=${encodeURIComponent(this.config.clientSecret)}`;

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: body
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Ford Telematics auth failed: ${response.status} ${response.statusText} - ${errorText}`);
            }

            const tokenData = await response.json() as FordTelematicsToken;
            this.cachedToken = tokenData;

            // Parse expires_in timestamp (5 minutes from now)
            this.tokenExpiry = new Date(parseInt(tokenData.expires_in));

            console.log(`✅ Ford Telematics token acquired, expires: ${this.tokenExpiry.toISOString()}`);

            // Start automatic refresh timer
            this.startTokenRefreshTimer();

            return tokenData.access_token;

        } catch (error) {
            console.error('❌ Ford Telematics authentication failed:', error);
            throw new Error(`Ford Telematics authentication failed: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            this.isRefreshing = false;
        }
    }

    /**
     * Get authentication token from Ford Telematics API
     * Now with automatic proactive refresh
     */
    async getAuthToken(): Promise<string> {
        // Return cached token if still valid (with 30 second buffer)
        if (this.cachedToken && this.tokenExpiry && new Date() < new Date(this.tokenExpiry.getTime() - 30000)) {
            return this.cachedToken.access_token;
        }

        // Token expired or doesn't exist, refresh it
        return await this.refreshToken();
    }

    /**
     * Make authenticated request to Ford Telematics API with retry logic
     */
    private async authenticatedRequest(endpoint: string, options: any = {}): Promise<any> {
        const maxRetries = 3;
        const baseDelay = 1000; // 1 second
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const token = await this.getAuthToken();
                
                const response = await fetch(`${this.config.baseUrl}${endpoint}`, {
                    ...options,
                    timeout: 10000, // 10 second timeout
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        ...options.headers
                    }
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Ford Telematics API error: ${response.status} ${response.statusText} - ${errorText}`);
                }

                return response.json();
            } catch (error) {
                console.warn(`🔄 Ford API attempt ${attempt}/${maxRetries} failed for ${endpoint}:`, error instanceof Error ? error.message : error);
                
                if (attempt === maxRetries) {
                    throw error; // Final attempt failed
                }
                
                // Exponential backoff: wait 1s, 2s, 4s
                const delay = baseDelay * Math.pow(2, attempt - 1);
                console.log(`⏳ Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    /**
     * Get list of all enrolled vehicles
     */
    async getVehicles(): Promise<VehicleMetadata[]> {
        console.log('🚗 Fetching vehicle list from Ford Telematics...');
        
        try {
            const data = await this.authenticatedRequest('/v1/vehicles?page-size=100');
            console.log(`✅ Found ${data.vehicles.length} vehicles in fleet`);
            return data.vehicles;
        } catch (error) {
            console.error('❌ Failed to fetch vehicles:', error);
            throw error;
        }
    }

    /**
     * Get current status/signals for a specific vehicle
     */
    async getVehicleStatus(vin: string, signalFilter?: string[]): Promise<VehicleStatus> {
        console.log(`📡 Fetching status for vehicle ${vin}...`);
        
        let endpoint = `/v1/vehicle/${vin}/status`;
        if (signalFilter && signalFilter.length > 0) {
            endpoint += `?signal-filter=${signalFilter.join(',')}`;
        }

        try {
            const data = await this.authenticatedRequest(endpoint);
            console.log(`✅ Retrieved ${Object.keys(data.signals).length} signals for ${vin}`);

            // Debug: Show available signal names to troubleshoot missing GPS/battery data
            console.log(`🔍 Available signals for ${vin}:`, Object.keys(data.signals));

            // Debug: Show sample signal values for troubleshooting
            for (const [signalName, signal] of Object.entries(data.signals)) {
                console.log(`📊 ${signalName}: ${JSON.stringify(signal).substring(0, 100)}...`);
            }

            return data;
        } catch (error) {
            console.error(`❌ Failed to fetch status for ${vin}:`, error);
            throw error;
        }
    }

    /**
     * Get trip history for a specific vehicle
     */
    async getVehicleTrips(vin: string, startTime: string, endTime: string, pageSize: number = 100): Promise<TripSummary[]> {
        console.log(`🛣️ Fetching trips for vehicle ${vin} from ${startTime} to ${endTime}...`);
        
        const endpoint = `/v1/vehicle/${vin}/trip?start-time=${startTime}&end-time=${endTime}&page-size=${pageSize}`;

        try {
            const data = await this.authenticatedRequest(endpoint);
            console.log(`✅ Retrieved ${data.trips.length} trips for ${vin}`);
            return data.trips;
        } catch (error) {
            console.error(`❌ Failed to fetch trips for ${vin}:`, error);
            throw error;
        }
    }

    /**
     * Get historical signals for a specific vehicle
     */
    async getVehicleHistorical(
        vin: string, 
        startTime: string, 
        endTime: string, 
        signalFilter?: string[],
        pageSize: number = 1000
    ): Promise<any> {
        console.log(`📊 Fetching historical data for vehicle ${vin}...`);
        
        let endpoint = `/v1/vehicle/${vin}/historical?start-time=${startTime}&end-time=${endTime}&page-size=${pageSize}`;
        if (signalFilter && signalFilter.length > 0) {
            endpoint += `&signal-filter=${signalFilter.join(',')}`;
        }

        try {
            const data = await this.authenticatedRequest(endpoint);
            console.log(`✅ Retrieved ${data.signals.length} historical signals for ${vin}`);
            return data;
        } catch (error) {
            console.error(`❌ Failed to fetch historical data for ${vin}:`, error);
            throw error;
        }
    }
}

// Lazy singleton instance to ensure environment variables are loaded
let _fordTelematicsClient: FordTelematicsClient | null = null;

export const fordTelematicsClient = {
    get instance(): FordTelematicsClient {
        if (!_fordTelematicsClient) {
            console.log('🔧 Creating Ford Telematics client with env vars:');
            console.log('  FORD_TELEMATICS_CLIENT_ID:', process.env.FORD_TELEMATICS_CLIENT_ID ? 'SET' : 'MISSING');
            console.log('  FORD_TELEMATICS_CLIENT_SECRET:', process.env.FORD_TELEMATICS_CLIENT_SECRET ? 'SET' : 'MISSING');
            console.log('  FORD_TELEMATICS_BASE_URL:', process.env.FORD_TELEMATICS_BASE_URL || 'DEFAULT');
            
            _fordTelematicsClient = new FordTelematicsClient({
                clientId: process.env.FORD_TELEMATICS_CLIENT_ID || '',
                clientSecret: process.env.FORD_TELEMATICS_CLIENT_SECRET || '',
                baseUrl: process.env.FORD_TELEMATICS_BASE_URL || 'https://api.fordpro.com/vehicle-status-api'
            });
        }
        return _fordTelematicsClient;
    }
};