import { JobberProperty, jobberClient } from './jobberClient';
import { geocodingService } from './geocoding';

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
    eventType: 'ENTER' | 'EXIT' | 'ARRIVED' | 'DEPARTED';
    timestamp: Date;
    location: {
        latitude: number;
        longitude: number;
    };
    duration?: number; // minutes spent in zone (for EXIT/DEPARTED events)
    workDuration?: number; // minutes parked at location (for DEPARTED events)
}

export interface VehicleLocation {
    vehicleId: string;
    vehicleName: string;
    latitude: number;
    longitude: number;
    timestamp: Date;
    isMoving?: boolean; // true if vehicle is moving, false if stationary
}

export interface VehicleStatus {
    vehicleId: string;
    zoneId: string;
    enteredAt: Date;
    arrivedAt?: Date; // when vehicle stopped moving in zone
    departedAt?: Date; // when vehicle started moving to leave
    lastMovingCheck: Date;
    isCurrentlyParked: boolean;
}

export class GeofencingService {
    private zones: GeofenceZone[] = [];
    private vehicleZoneHistory: Map<string, { zoneId: string; enteredAt: Date }[]> = new Map();
    private vehicleStatus: Map<string, VehicleStatus[]> = new Map(); // Track detailed status per vehicle
    private vehicleMovementHistory: Map<string, { location: { lat: number; lng: number }; timestamp: Date }[]> = new Map();
    
    // Configuration
    private readonly STATIONARY_THRESHOLD_MINUTES = 3; // Consider parked after 3 minutes
    private readonly MOVEMENT_THRESHOLD_METERS = 20; // Movement detection threshold
    
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

    async loadJobberProperties(): Promise<number> {
        try {
            const properties = await jobberClient.getAllProperties();
            let successCount = 0;
            let failCount = 0;
            
            console.log(`🏠 Processing ${properties.length} Jobber properties for geofencing...`);
            
            // Process properties with rate limiting (1 per second to respect Nominatim)
            for (const property of properties) {
                try {
                    const clientName = property.client.companyName || 
                                     `${property.client.firstName} ${property.client.lastName}`;
                    
                    const address = `${property.address.street}, ${property.address.city}, ${property.address.province}`;
                    console.log(`📍 Geocoding: ${clientName} at ${address}`);
                    
                    // Get coordinates for the address
                    const coordinates = await geocodingService.getCoordinates(address);
                    
                    if (coordinates) {
                        // Create geofence zone
                        const geofenceZone: GeofenceZone = {
                            id: `customer-${property.id}`,
                            name: clientName,
                            type: 'customer',
                            center: {
                                latitude: coordinates.latitude,
                                longitude: coordinates.longitude
                            },
                            radius: 50, // 50 meter radius for customer properties
                            address: coordinates.formattedAddress,
                            clientInfo: {
                                id: property.client.id,
                                name: clientName,
                                companyName: property.client.companyName
                            }
                        };
                        
                        // Add to zones array (avoid duplicates)
                        const existingIndex = this.zones.findIndex(z => z.id === geofenceZone.id);
                        if (existingIndex >= 0) {
                            this.zones[existingIndex] = geofenceZone;
                        } else {
                            this.zones.push(geofenceZone);
                        }
                        
                        successCount++;
                        console.log(`✅ Created geofence: ${clientName} (${coordinates.latitude.toFixed(4)}, ${coordinates.longitude.toFixed(4)})`);
                    } else {
                        failCount++;
                        console.warn(`❌ Could not geocode address for ${clientName}: ${address}`);
                    }
                    
                    // Rate limit: Wait 1 second between requests to respect Nominatim terms
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                } catch (error) {
                    failCount++;
                    console.error(`❌ Error processing property ${property.id}:`, error);
                }
            }
            
            console.log(`🎯 Geofencing setup complete:`);
            console.log(`   ✅ ${successCount} customer geofences created`);
            console.log(`   ❌ ${failCount} properties failed`);
            console.log(`   📊 Total zones: ${this.zones.length}`);
            
            return successCount;
        } catch (error) {
            console.error('❌ Failed to load Jobber properties:', error);
            return 0;
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
    
    getVehicleWorkStatus(vehicleId: string): VehicleStatus[] {
        return this.vehicleStatus.get(vehicleId) || [];
    }
    
    // Get active job sites (where vehicles are currently parked and working)
    getActiveJobSites(): { zone: GeofenceZone; vehicles: VehicleStatus[] }[] {
        const activeJobs: { zone: GeofenceZone; vehicles: VehicleStatus[] }[] = [];
        
        for (const [vehicleId, statuses] of this.vehicleStatus.entries()) {
            for (const status of statuses) {
                if (status.isCurrentlyParked && status.arrivedAt) {
                    const zone = this.zones.find(z => z.id === status.zoneId);
                    if (zone && zone.type === 'customer') {
                        let existingJob = activeJobs.find(job => job.zone.id === zone.id);
                        if (!existingJob) {
                            existingJob = { zone, vehicles: [] };
                            activeJobs.push(existingJob);
                        }
                        existingJob.vehicles.push(status);
                    }
                }
            }
        }
        
        return activeJobs;
    }
}

export const geofencingService = new GeofencingService();