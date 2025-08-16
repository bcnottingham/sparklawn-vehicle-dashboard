import { JobberProperty, jobberClient } from './jobberClient';

export interface GeofenceZone {
    id: string;
    name: string;
    type: 'customer' | 'supplier' | 'shop' | 'other';
    center: {
        latitude: number;
        longitude: number;
    };
    radius: number; // meters
    address: string;
    clientInfo?: {
        id: string;
        name: string;
        companyName?: string;
    };
}

export interface GeofenceEvent {
    id: string;
    vehicleId: string;
    vehicleName: string;
    zoneId: string;
    zoneName: string;
    eventType: 'ENTER' | 'EXIT';
    timestamp: Date;
    location: {
        latitude: number;
        longitude: number;
    };
    duration?: number; // minutes spent in zone (for EXIT events)
}

export interface VehicleLocation {
    vehicleId: string;
    vehicleName: string;
    latitude: number;
    longitude: number;
    timestamp: Date;
}

export class GeofencingService {
    private zones: GeofenceZone[] = [];
    private vehicleZoneHistory: Map<string, { zoneId: string; enteredAt: Date }[]> = new Map();
    
    constructor() {
        this.initializeStaticZones();
    }

    private initializeStaticZones(): void {
        // SparkLawn business locations
        this.zones = [
            {
                id: 'sparklawn-hq',
                name: 'SparkLawn HQ (The Shop)',
                type: 'shop',
                center: { latitude: 36.1823732, longitude: -94.1689725 },
                radius: 100, // 100 meter radius
                address: '3510 McRay Ave, Springdale, AR 72762 - Building E'
            },
            {
                id: 'home-depot-rogers',
                name: 'Home Depot - Rogers',
                type: 'supplier',
                center: { latitude: 36.3319, longitude: -94.1186 },
                radius: 150,
                address: 'Home Depot, Rogers, AR'
            },
            {
                id: 'lowes-bentonville',
                name: "Lowe's - Bentonville",
                type: 'supplier',
                center: { latitude: 36.3728, longitude: -94.2088 },
                radius: 150,
                address: "Lowe's, Bentonville, AR"
            },
            {
                id: 'the-sod-store',
                name: 'The Sod Store',
                type: 'supplier',
                center: { latitude: 36.2019, longitude: -94.1302 },
                radius: 100,
                address: 'The Sod Store, Springdale, AR'
            },
            {
                id: 'garden-city-nursery',
                name: 'Garden City Nursery',
                type: 'supplier',
                center: { latitude: 36.1847, longitude: -94.1574 },
                radius: 100,
                address: 'Garden City Nursery, Springdale, AR'
            },
            {
                id: 'westwood-gardens',
                name: 'Westwood Gardens',
                type: 'supplier',
                center: { latitude: 36.0662, longitude: -94.1574 },
                radius: 100,
                address: 'Westwood Gardens, Fayetteville, AR'
            },
            {
                id: 'hardware-store-fayetteville',
                name: 'The Hardware Store - Fayetteville',
                type: 'supplier',
                center: { latitude: 36.0625, longitude: -94.1574 },
                radius: 100,
                address: 'The Hardware Store, Fayetteville, AR'
            },
            {
                id: 'smileys-services',
                name: "Smiley's Services",
                type: 'supplier',
                center: { latitude: 36.1847, longitude: -94.1689 },
                radius: 100,
                address: "Smiley's Services (Lawn Mower Dealer), Springdale, AR"
            }
        ];
    }

    async loadJobberProperties(): Promise<void> {
        try {
            const properties = await jobberClient.getAllProperties();
            
            for (const property of properties) {
                if (property.address.latitude && property.address.longitude) {
                    const clientName = property.client.companyName || 
                                     `${property.client.firstName} ${property.client.lastName}`;
                    
                    const zone: GeofenceZone = {
                        id: `jobber-${property.id}`,
                        name: clientName,
                        type: 'customer',
                        center: {
                            latitude: property.address.latitude,
                            longitude: property.address.longitude
                        },
                        radius: 75, // 75 meter radius for customer properties
                        address: `${property.address.street}, ${property.address.city}, ${property.address.province}`,
                        clientInfo: {
                            id: property.client.id,
                            name: clientName,
                            companyName: property.client.companyName
                        }
                    };
                    
                    this.zones.push(zone);
                }
            }
            
            console.log(`✅ Loaded ${properties.length} Jobber properties as geofence zones`);
        } catch (error) {
            console.error('❌ Failed to load Jobber properties:', error);
        }
    }

    private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const R = 6371000; // Earth's radius in meters
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c; // Distance in meters
    }

    checkGeofences(vehicleLocation: VehicleLocation): GeofenceEvent[] {
        const events: GeofenceEvent[] = [];
        const vehicleHistory = this.vehicleZoneHistory.get(vehicleLocation.vehicleId) || [];
        const currentZones = new Set<string>();

        // Check which zones the vehicle is currently in
        for (const zone of this.zones) {
            const distance = this.calculateDistance(
                vehicleLocation.latitude,
                vehicleLocation.longitude,
                zone.center.latitude,
                zone.center.longitude
            );

            if (distance <= zone.radius) {
                currentZones.add(zone.id);
                
                // Check if this is a new entry
                const wasInZone = vehicleHistory.some(h => h.zoneId === zone.id);
                if (!wasInZone) {
                    // ENTER event
                    const event: GeofenceEvent = {
                        id: `${vehicleLocation.vehicleId}-${zone.id}-${Date.now()}`,
                        vehicleId: vehicleLocation.vehicleId,
                        vehicleName: vehicleLocation.vehicleName,
                        zoneId: zone.id,
                        zoneName: zone.name,
                        eventType: 'ENTER',
                        timestamp: vehicleLocation.timestamp,
                        location: {
                            latitude: vehicleLocation.latitude,
                            longitude: vehicleLocation.longitude
                        }
                    };
                    events.push(event);

                    // Add to history
                    vehicleHistory.push({
                        zoneId: zone.id,
                        enteredAt: vehicleLocation.timestamp
                    });
                }
            }
        }

        // Check for exits
        const updatedHistory = vehicleHistory.filter(h => {
            if (!currentZones.has(h.zoneId)) {
                // Vehicle exited this zone
                const zone = this.zones.find(z => z.id === h.zoneId);
                if (zone) {
                    const duration = Math.round((vehicleLocation.timestamp.getTime() - h.enteredAt.getTime()) / (1000 * 60));
                    
                    const event: GeofenceEvent = {
                        id: `${vehicleLocation.vehicleId}-${zone.id}-${Date.now()}`,
                        vehicleId: vehicleLocation.vehicleId,
                        vehicleName: vehicleLocation.vehicleName,
                        zoneId: zone.id,
                        zoneName: zone.name,
                        eventType: 'EXIT',
                        timestamp: vehicleLocation.timestamp,
                        location: {
                            latitude: vehicleLocation.latitude,
                            longitude: vehicleLocation.longitude
                        },
                        duration
                    };
                    events.push(event);
                }
                return false; // Remove from history
            }
            return true; // Keep in history
        });

        // Update vehicle history
        this.vehicleZoneHistory.set(vehicleLocation.vehicleId, updatedHistory);

        return events;
    }

    getZones(): GeofenceZone[] {
        return this.zones;
    }

    getZoneById(zoneId: string): GeofenceZone | undefined {
        return this.zones.find(z => z.id === zoneId);
    }

    getZonesByType(type: string): GeofenceZone[] {
        return this.zones.filter(z => z.type === type);
    }

    getVehicleCurrentZones(vehicleId: string): GeofenceZone[] {
        const history = this.vehicleZoneHistory.get(vehicleId) || [];
        return history.map(h => this.zones.find(z => z.id === h.zoneId)).filter(Boolean) as GeofenceZone[];
    }
}

export const geofencingService = new GeofencingService();