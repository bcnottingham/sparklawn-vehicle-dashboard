import { geocodingService } from './geocoding';
import { jobberClient, JobberProperty } from './jobberClient';
import * as fs from 'fs';
import * as path from 'path';

interface ClientLocation {
    client: string;
    job: string;
    address: string;
    lat: number | null;
    lng: number | null;
    radius: number;
    type: 'client_job_site' | 'home_base';
}

interface HomeBaseLocation {
    name: string;
    address: string;
    lat: number;
    lng: number;
    radius: number;
    type: 'home_base';
}

class ClientLocationService {
    private clientLocations: ClientLocation[] = [];
    private geocodedLocations: Map<string, ClientLocation> = new Map();
    private homeBase: HomeBaseLocation;
    private initialized = false;

    constructor() {
        // Define SparkLawn home base - McRay Shop coordinates (from actual vehicle data)
        this.homeBase = {
            name: 'McRay Shop',
            address: 'McRay Shop, Springdale, AR',
            lat: 36.183115, // Actual coordinates from client location cache
            lng: -94.169488,
            radius: 200, // 200m radius for home base detection
            type: 'home_base'
        };
        // Don't initialize in constructor - let it happen on first use
    }

    private async initializeClientLocations() {
        console.log('🏗️ Initializing SparkLawn client locations from MongoDB...');

        try {
            // Try to load from MongoDB first
            const { getDatabase } = await import('../db/index');
            const db = await getDatabase();
            const collection = db.collection('client_locations');

            const clientDocs = await collection.find({}).toArray();

            if (clientDocs.length > 0) {
                console.log(`📊 Fetched ${clientDocs.length} locations from MongoDB`);

                this.clientLocations = clientDocs.map((doc: any) => ({
                    client: doc.clientName,
                    job: 'Property Service',
                    address: doc._id,
                    lat: doc.lat,
                    lng: doc.lng,
                    radius: this.getReasonableRadius(doc.clientName, doc.radius),
                    type: 'client_job_site' as const
                }));

                console.log(`✅ Loaded ${this.clientLocations.length} client locations from MongoDB`);
                return;
            }

            console.log('⚠️ No locations in MongoDB, checking legacy file cache...');

            // Fallback: Check legacy file cache and migrate if found
            const cacheFilePath = path.join(__dirname, '../../client-coordinates-cache.json');

            if (fs.existsSync(cacheFilePath)) {
                console.log('📁 Found legacy cache file, migrating to MongoDB...');
                const cachedData = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));

                // Migrate to MongoDB
                const docsToInsert = Object.entries(cachedData).map(([address, data]: [string, any]) => ({
                    _id: address,
                    lat: data.lat,
                    lng: data.lng,
                    source: data.source || 'legacy',
                    clientName: data.clientName,
                    lastUpdated: data.lastUpdated || new Date().toISOString(),
                    priority: data.priority || 1,
                    radius: data.radius || 100,
                    isClient: data.isClient !== false,
                    clientType: data.clientType || 'residential',
                    isActive: data.isActive !== false
                }));

                if (docsToInsert.length > 0) {
                    await collection.insertMany(docsToInsert as any);
                    console.log(`✅ Migrated ${docsToInsert.length} locations from legacy cache to MongoDB`);
                }

                this.clientLocations = docsToInsert.map(doc => ({
                    client: doc.clientName,
                    job: 'Property Service',
                    address: doc._id,
                    lat: doc.lat,
                    lng: doc.lng,
                    radius: this.getReasonableRadius(doc.clientName, doc.radius),
                    type: 'client_job_site' as const
                }));

                console.log(`✅ Loaded ${this.clientLocations.length} client locations after migration`);
                return;
            }

            // Fallback: Try Jobber API
            console.log('⏳ No cache found, trying Jobber API...');
            const properties = await jobberClient.getAllProperties();
            console.log(`📊 Fetched ${properties.length} properties from Jobber API`);

            this.clientLocations = properties.map(property => ({
                client: property.client.companyName || `${property.client.firstName} ${property.client.lastName}`,
                job: 'Property Service',
                address: this.formatAddress(property.address),
                lat: null,
                lng: null,
                radius: 100,
                type: 'client_job_site' as const
            }));

            console.log(`✅ Loaded ${this.clientLocations.length} client locations from Jobber API`);

        } catch (error) {
            console.warn('⚠️ Failed to fetch from MongoDB and API, falling back to minimal hardcoded locations:', error);

            // Last resort fallback to hardcoded locations
            const hardcodedLocations = [
                { client: 'Shiloh Museum of Ozark History', job: 'Weekly Mowing Maintenance', address: '118 West Johnson Ave, Springdale, AR 72764', lat: 36.1873, lng: -94.13121, radius: 100 },
                { client: 'Circle of Life Springdale', job: 'Weekly Maintenance', address: '901 Jones Road, Springdale, AR 72762', lat: 36.178393, lng: -94.2095189, radius: 100 }
            ];

            this.clientLocations = hardcodedLocations.map(location => ({
                ...location,
                type: 'client_job_site' as const
            }));

            console.log(`✅ Loaded ${this.clientLocations.length} fallback client locations`);
        }
    }

    private formatAddress(address: any): string {
        const parts = [
            address.street,
            address.city,
            address.province,
            address.postalCode,
            address.country
        ].filter(part => part && part.trim());
        
        return parts.join(', ');
    }

    private getReasonableRadius(clientName: string, cachedRadius?: number): number {
        // Use cached radius if available
        if (cachedRadius) return cachedRadius;
        
        // Set reasonable radii based on property type
        const name = clientName.toLowerCase();
        
        // Large commercial/institutional properties
        if (name.includes('crossmar') || name.includes('trailside')) return 600; // 600m for large developments
        if (name.includes('asset living') && name.includes('hawthorne grove')) return 1200; // Larger radius for Hawthorne Grove complex with access roads
        if (name.includes('asset living') || name.includes('apartments')) return 400;
        if (name.includes('buffington homes') || name.includes('poa') || name.includes('estates')) return 400;
        if (name.includes('retirement') || name.includes('primrose')) return 300;
        if (name.includes('school') || name.includes('thaden')) return 300;
        if (name.includes('hospice') || name.includes('circle of life')) return 200;
        if (name.includes('bank') || name.includes('financial')) return 150;
        
        // SparkLawn HQ - highest priority location
        if (name.toLowerCase().includes('mcray shop') || name.toLowerCase().includes('mcray')) return 1000; // Largest radius for HQ

        // Specific adjustments for locations with GPS precision issues
        if (name.includes('casa')) return 50; // Smaller radius for CASA to reduce false positives
        if (name.includes('stoneridge')) return 350; // Larger radius for 8-acre StoneRidge development
        if (name.includes('brian clark') && name.includes('shaver')) return 30; // 100ft radius for Brian Clark Shaver St property
        
        // Medium commercial properties
        if (name.includes('freight')) return 350; // Larger radius for freight/logistics companies
        if (name.includes('llc') || name.includes('investments')) return 200;
        if (name.includes('museum') || name.includes('center') || name.includes('services')) return 150;
        
        // Residential properties (default)
        return 100; // 100m for residential
    }

    // Build geocoded cache from client locations
    async buildGeocodedCache(): Promise<void> {
        if (this.initialized) return;
        
        // Initialize client locations from cache/API first
        if (this.clientLocations.length === 0) {
            await this.initializeClientLocations();
        }
        
        console.log('📍 Building geocoded cache for client locations...');
        
        let geocodedCount = 0;
        let alreadyGeocodedCount = 0;
        
        for (const location of this.clientLocations) {
            if (location.lat && location.lng) {
                // Already has coordinates from cache
                const key = `${location.client}:${location.address}`;
                this.geocodedLocations.set(key, { ...location, isClient: true } as any);
                alreadyGeocodedCount++;
            } else {
                // Need to geocode (only if not loaded from cache)
                console.log(`🔍 Geocoding ${location.client}: ${location.address}`);
                try {
                    const result = await geocodingService.getCoordinates(location.address);
                    if (result) {
                        const geocodedLocation = {
                            ...location,
                            lat: result.latitude,
                            lng: result.longitude,
                            isClient: true
                        };
                        const key = `${location.client}:${location.address}`;
                        this.geocodedLocations.set(key, geocodedLocation as any);
                        geocodedCount++;
                        console.log(`✅ ${location.client}: Geocoded to (${result.latitude}, ${result.longitude})`);
                    }
                } catch (error) {
                    console.warn(`❌ Failed to geocode ${location.client}: ${location.address}`, error);
                }

                // Small delay to respect geocoding rate limits
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        this.initialized = true;
        console.log(`🎯 Client location cache built with ${this.geocodedLocations.size} total locations (${alreadyGeocodedCount} from cache, ${geocodedCount} newly geocoded)`);
    }

    // Check if coordinates are at home base
    isAtHomeBase(latitude: number, longitude: number): boolean {
        const distance = this.calculateDistance(latitude, longitude, this.homeBase.lat, this.homeBase.lng);
        const isHome = distance <= this.homeBase.radius;
        if (isHome) {
            console.log(`🏠 HOME BASE DETECTED: ${this.homeBase.name} (${distance.toFixed(1)}m within ${this.homeBase.radius}m radius)`);
        }
        return isHome;
    }

    // Get home base information
    getHomeBase(): HomeBaseLocation {
        return { ...this.homeBase };
    }

    // Find location type - returns 'home_base', client name, or null
    async findLocationMatch(latitude: number, longitude: number): Promise<{ type: 'home_base' | 'client'; name: string } | null> {
        // First check if at home base
        if (this.isAtHomeBase(latitude, longitude)) {
            return { type: 'home_base', name: this.homeBase.name };
        }

        // Then check client locations
        const clientMatch = await this.findClientLocationMatch(latitude, longitude);
        if (clientMatch) {
            return { type: 'client', name: clientMatch };
        }

        return null;
    }

    // Find client location match by checking distance to all known client locations (excluding home base)
    async findClientLocationMatch(latitude: number, longitude: number): Promise<string | null> {
        if (!this.initialized) {
            await this.buildGeocodedCache();
        }

        console.log(`🎯 Checking ${this.geocodedLocations.size} client locations for match at ${latitude}, ${longitude}`);
        
        const matches: { client: string, distance: number, radius: number }[] = [];
        
        for (const [key, location] of this.geocodedLocations) {
            if (!location.lat || !location.lng) continue;

            // Skip non-client locations (only match actual clients, not other locations like Garden City Nursery)
            if (!(location as any).isClient) continue;

            const distance = this.calculateDistance(latitude, longitude, location.lat, location.lng);
            
            // Self-healing validation: double-check distance with alternative calculation
            const distanceCheck = this.calculateDistanceAlternative(latitude, longitude, location.lat, location.lng);
            const distanceDiff = Math.abs(distance - distanceCheck);
            
            // Log if distance calculations differ significantly (indicates bug)
            if (distanceDiff > 100) { // 100m difference threshold
                console.warn(`⚠️  DISTANCE CALCULATION MISMATCH for ${location.client}:`);
                console.warn(`   Haversine: ${distance.toFixed(1)}m, Euclidean: ${distanceCheck.toFixed(1)}m (diff: ${distanceDiff.toFixed(1)}m)`);
                console.warn(`   Vehicle: ${latitude}, ${longitude} | Client: ${location.lat}, ${location.lng}`);
            }
            
            // Use the more conservative (larger) distance to prevent false positives
            const safeDistance = Math.max(distance, distanceCheck);
            
            // Reduced logging to prevent performance issues - only log when close
            if (safeDistance <= location.radius * 2) {
                console.log(`📏 ${location.client}: ${safeDistance.toFixed(1)}m away (radius: ${location.radius}m)`);
            }
            
            if (safeDistance <= location.radius) {
                // Additional validation: reject matches that are unreasonably far
                // For lawn care, anything over 500m is suspicious unless it's a massive property
                const maxReasonableDistance = location.radius > 500 ? location.radius * 1.5 : 500;
                
                if (safeDistance > maxReasonableDistance) {
                    console.warn(`🚨 REJECTED: ${location.client} at ${safeDistance.toFixed(1)}m (too far for lawn service, max reasonable: ${maxReasonableDistance}m)`);
                    console.warn(`   Vehicle GPS: ${latitude}, ${longitude} | Client GPS: ${location.lat}, ${location.lng}`);
                    console.warn(`   Radius: ${location.radius}m - This looks like a calculation error!`);
                    continue;
                }
                
                // Additional sanity check: if distance > 300m, require explicit large property radius
                if (safeDistance > 300 && location.radius < 300) {
                    console.warn(`🚨 REJECTED: ${location.client} at ${safeDistance.toFixed(1)}m (too far for residential property)`);
                    console.warn(`   Vehicle GPS: ${latitude}, ${longitude} | Client GPS: ${location.lat}, ${location.lng}`);
                    continue;
                }
                
                matches.push({
                    client: location.client,
                    distance: safeDistance,
                    radius: location.radius
                });
                console.log(`✅ CLIENT MATCH! ${location.client} (${safeDistance.toFixed(1)}m within ${location.radius}m radius)`);
                console.log(`   📍 Vehicle: ${latitude}, ${longitude} | Client: ${location.lat}, ${location.lng}`);
            }
        }
        
        if (matches.length > 0) {
            // Prioritize McRay Shop (HQ) over other locations when multiple matches exist
            const mcrayMatch = matches.find(m => m.client.toLowerCase().includes('mcray shop') || m.client.toLowerCase().includes('mcray'));
            if (mcrayMatch) {
                console.log(`🎯 HQ Priority Match: "${mcrayMatch.client}" (${mcrayMatch.distance.toFixed(1)}m) - SparkLawn HQ takes priority`);
                return mcrayMatch.client;
            }

            // Otherwise return the closest match
            matches.sort((a, b) => a.distance - b.distance);
            const closest = matches[0];
            console.log(`🎯 Closest client match: "${closest.client}" (${closest.distance.toFixed(1)}m)`);
            return closest.client;
        }
        
        console.log(`❌ No client locations match these coordinates`);
        return null;
    }

    // Haversine distance calculation (same as geocoding service)
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

    // Alternative distance calculation for validation (using simplified Euclidean approximation)
    private calculateDistanceAlternative(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const degToMeters = 111320; // Approximate meters per degree at equator
        const latDiff = (lat2 - lat1) * degToMeters;
        const lonDiff = (lon2 - lon1) * degToMeters * Math.cos(lat1 * Math.PI / 180);
        return Math.sqrt(latDiff * latDiff + lonDiff * lonDiff);
    }

    // Get all client locations
    getClientLocations(): ClientLocation[] {
        return [...this.clientLocations];
    }

    // Get geocoded cache
    getGeocodedCache(): Map<string, ClientLocation> {
        return new Map(this.geocodedLocations);
    }
}

// Export singleton instance
export const clientLocationService = new ClientLocationService();
export type { ClientLocation };