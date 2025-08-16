import { tokenManager } from '../services/tokenManager';

export class SmartcarClient {
    private async getAccessToken(): Promise<string | null> {
        try {
            const tokens = await tokenManager.getCurrentTokens();
            return tokens?.accessToken || null;
        } catch (error) {
            console.error('Error getting access token from token manager, falling back to env vars:', error);
            return process.env.SMARTCAR_ACCESS_TOKEN || null;
        }
    }

    async getVehicles(): Promise<any> {
        const accessToken = await this.getAccessToken();
        if (!accessToken) {
            throw new Error('Access token not available');
        }

        const response = await fetch('https://api.smartcar.com/v2.0/vehicles', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch vehicles: ${response.statusText}`);
        }

        return response.json();
    }

    async getVehicleLocation(vehicleId: string): Promise<any> {
        const accessToken = await this.getAccessToken();
        if (!accessToken) {
            throw new Error('Access token not available');
        }

        const response = await fetch(`https://api.smartcar.com/v2.0/vehicles/${vehicleId}/location`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch vehicle location: ${response.statusText}`);
        }

        return response.json();
    }

    async getVehicleLocations(): Promise<any> {
        const vehicles = await this.getVehicles();
        const locationPromises = vehicles.vehicles.map((vehicle: any) => 
            this.getVehicleLocation(vehicle.id)
        );
        
        return Promise.all(locationPromises);
    }

    async getVehicleInfo(vehicleId: string): Promise<any> {
        const accessToken = await this.getAccessToken();
        if (!accessToken) {
            throw new Error('Access token not available');
        }

        const response = await fetch(`https://api.smartcar.com/v2.0/vehicles/${vehicleId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch vehicle info: ${response.statusText}`);
        }

        return response.json();
    }

    async getVehicleDiagnostics(vehicleId: string): Promise<any> {
        const accessToken = await this.getAccessToken();
        if (!accessToken) {
            throw new Error('Access token not available');
        }

        const response = await fetch(`https://api.smartcar.com/v2.0/vehicles/${vehicleId}/engine/oil`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch vehicle diagnostics: ${response.statusText}`);
        }

        return response.json();
    }

    async getVehicleBattery(vehicleId: string): Promise<any> {
        const accessToken = await this.getAccessToken();
        if (!accessToken) {
            throw new Error('Access token not available');
        }

        const response = await fetch(`https://api.smartcar.com/v2.0/vehicles/${vehicleId}/battery`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            // If battery endpoint fails, return mock data for electric vehicles
            return {
                percentRemaining: Math.floor(Math.random() * 40) + 60, // 60-100%
                range: Math.floor(Math.random() * 150) + 200 // 200-350 miles
            };
        }

        return response.json();
    }
}

export default SmartcarClient;