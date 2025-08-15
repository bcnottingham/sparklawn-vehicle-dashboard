export class SmartcarClient {
    private clientId: string;
    private clientSecret: string;
    private accessToken: string | null = null;

    constructor() {
        this.clientId = process.env.SMARTCAR_CLIENT_ID || '';
        this.clientSecret = process.env.SMARTCAR_CLIENT_SECRET || '';
        this.accessToken = process.env.SMARTCAR_ACCESS_TOKEN || null;
    }

    async getVehicles(): Promise<any> {
        if (!this.accessToken) {
            throw new Error('Access token not available');
        }

        const response = await fetch('https://api.smartcar.com/v2.0/vehicles', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch vehicles: ${response.statusText}`);
        }

        return response.json();
    }

    async getVehicleLocation(vehicleId: string): Promise<any> {
        if (!this.accessToken) {
            throw new Error('Access token not available');
        }

        const response = await fetch(`https://api.smartcar.com/v2.0/vehicles/${vehicleId}/location`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
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
        if (!this.accessToken) {
            throw new Error('Access token not available');
        }

        const response = await fetch(`https://api.smartcar.com/v2.0/vehicles/${vehicleId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch vehicle info: ${response.statusText}`);
        }

        return response.json();
    }

    async getVehicleDiagnostics(vehicleId: string): Promise<any> {
        if (!this.accessToken) {
            throw new Error('Access token not available');
        }

        const response = await fetch(`https://api.smartcar.com/v2.0/vehicles/${vehicleId}/engine/oil`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
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