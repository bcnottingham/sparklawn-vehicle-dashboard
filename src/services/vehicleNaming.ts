// Vehicle naming service - maps vehicle IDs to friendly names
export class VehicleNamingService {
    private vehicleNames: { [key: string]: string } = {};

    // Set custom names based on vehicle ID (since we can't access vehicle info)
    public setVehicleName(vehicleId: string, vehicleInfo?: any): string {
        // If already named, return existing name
        if (this.vehicleNames[vehicleId]) {
            return this.vehicleNames[vehicleId];
        }

        // Assign names based on vehicle ID order
        const vehicleIds = [
            '2dc0332a-d8fc-4ef8-b0e3-31ec20caeee0',
            '35658624-018d-4041-ab6b-fa396f06af16', 
            '810bd9c5-a531-4984-8e5b-c59ef8a4a47c',
            'c0a4d743-eb5d-4dd8-8ce2-1216bf359bda'
        ];

        const names = ['Van', 'Truck 1', 'Truck 2', 'Truck 3'];
        
        let name = '';
        const index = vehicleIds.indexOf(vehicleId);
        if (index !== -1) {
            name = names[index];
        } else {
            name = `Vehicle ${vehicleId.substring(0, 8)}`;
        }

        this.vehicleNames[vehicleId] = name;
        return name;
    }

    // Get vehicle name by ID
    public getVehicleName(vehicleId: string): string {
        return this.vehicleNames[vehicleId] || `Vehicle ${vehicleId.substring(0, 8)}`;
    }

    // Get all vehicle names
    public getAllVehicleNames(): { [key: string]: string } {
        return { ...this.vehicleNames };
    }

    // Set name manually if needed
    public setCustomName(vehicleId: string, name: string): void {
        this.vehicleNames[vehicleId] = name;
    }
}

export const vehicleNaming = new VehicleNamingService();