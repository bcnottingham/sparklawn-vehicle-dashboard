export interface Vehicle {
    id: string;
    make: string;
    model: string;
    year: number;
    location: {
        latitude: number;
        longitude: number;
    };
}

export interface Diagnostic {
    id: string;
    vehicleId: string;
    batteryLevel: number;
    fuelLevel: number;
    mileage: number;
    tirePressure: number;
}