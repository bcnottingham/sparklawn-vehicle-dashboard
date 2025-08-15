import { tokenManager } from '../services/tokenManager';

export class SmartcarClient {
    private async getAccessToken(): Promise<string | null> {
        try {
            const tokens = await tokenManager.getCurrentTokens();
            return tokens?.accessToken || null;
        } catch (error) {
            console.error('Error getting access token:', error);
            return null;
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
}

export default SmartcarClient;