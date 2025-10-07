// Vehicle naming service - maps vehicle IDs to friendly names and accurate vehicle data
export class VehicleNamingService {
    private vehicleNames: { [key: string]: string } = {};
    
    // Vehicle year overrides to correct API inaccuracies
    private vehicleYearOverrides: { [key: string]: string } = {
        // I49 truck is actually 2023 (VIN: 1FT6W1EV3PWG37779)
        '35658624-018d-4041-ab6b-fa396f06af16': '2023', // I 49;US 71 truck
    };

    // Set custom names based on vehicle ID (since we can't access vehicle info)
    public setVehicleName(vehicleId: string, vehicleInfo?: any): string {
        // If already named, return existing name
        if (this.vehicleNames[vehicleId]) {
            return this.vehicleNames[vehicleId];
        }

        // Map vehicle UUIDs to new names
        const vehicleIdToName: { [key: string]: string } = {
            '2dc0332a-d8fc-4ef8-b0e3-31ec20caeee0': 'Lightning 3',  // VIN: 1FTVW1EV3NWG07402
            '35658624-018d-4041-ab6b-fa396f06af16': 'Lightning 2',   // VIN: 1FT6W1EV3PWG37779
            '810bd9c5-a531-4984-8e5b-c59ef8a4a47c': 'eTransit 1',   // VIN: 1FTBW1XK6PKA30591
            'c0a4d743-eb5d-4dd8-8ce2-1216bf359bda': 'Lightning 1'   // VIN: 1FTVW1EL3NWG00285
        };

        // Get name from mapping or use fallback
        const name = vehicleIdToName[vehicleId] || `Vehicle ${vehicleId.substring(0, 8)}`;

        this.vehicleNames[vehicleId] = name;
        return name;
    }

    // Get vehicle name by ID - auto-initialize if needed
    public getVehicleName(vehicleId: string): string {
        // First check if already named
        if (this.vehicleNames[vehicleId]) {
            return this.vehicleNames[vehicleId];
        }

        // Auto-initialize VIN-based names
        const vinToName: { [key: string]: string } = {
            '1FT6W1EV3PWG37779': 'Lightning 2',
            '1FTVW1EL3NWG00285': 'Lightning 1',
            '1FTVW1EV3NWG07402': 'Lightning 3',
            '1FTBW1XK6PKA30591': 'eTransit 1'
        };

        if (vinToName[vehicleId]) {
            this.vehicleNames[vehicleId] = vinToName[vehicleId];
            return vinToName[vehicleId];
        }

        // Fallback for unknown vehicles
        const fallbackName = `Vehicle ${vehicleId.substring(0, 8)}`;
        this.vehicleNames[vehicleId] = fallbackName;
        return fallbackName;
    }

    // Get all vehicle names
    public getAllVehicleNames(): { [key: string]: string } {
        return { ...this.vehicleNames };
    }

    // Set name manually if needed
    public setCustomName(vehicleId: string, name: string): void {
        this.vehicleNames[vehicleId] = name;
    }

    // Get corrected vehicle year (overrides API if needed)
    public getVehicleYear(vehicleId: string, apiYear?: string): string {
        return this.vehicleYearOverrides[vehicleId] || apiYear || '';
    }

    // Set year override manually
    public setYearOverride(vehicleId: string, year: string): void {
        this.vehicleYearOverrides[vehicleId] = year;
    }
}

export const vehicleNaming = new VehicleNamingService();