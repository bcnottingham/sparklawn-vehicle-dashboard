import { geofencingService } from './geofencing';
import { clientLocationService } from './clientLocations';
import * as fs from 'fs';
import * as path from 'path';

export interface GeocodeResult {
    latitude: number;
    longitude: number;
    formattedAddress: string;
}

export class GeocodingService {
    private reverseCache: Map<string, string> = new Map();
    private forwardCache: Map<string, GeocodeResult> = new Map();
    private googleApiKey: string | null = null;
    private persistentCacheFile: string = path.join(process.cwd(), 'geocoding-cache.json');

    // Rate limiting to prevent runaway costs
    private placesApiCallsToday: number = 0;
    private lastResetDate: string = new Date().toISOString().split('T')[0];
    private readonly MAX_PLACES_API_CALLS_PER_DAY = 500; // Safety limit - max $8.50/day
    
    // Custom location mappings for known business locations
    private customLocations: Map<string, string> = new Map([
        // McRay Avenue area - known business locations
        ['36.183158,-94.169677', 'McRay Shop'],
        ['36.183006,-94.169719', 'McRay Shop'],
        ['36.183122,-94.169511', 'McRay Shop'],
        // Casey's Gas Station at 36°10'32.8"N 94°13'05.3"W (removed - using Google Places API instead)
        // ['36.175778,-94.218139', "Casey's General Store"],
        // ['36.175374,-94.218591', "Casey's General Store"],
        // Walmart Fuel Station on North 48th St
        ['36.080897,-94.238036', 'Walmart Fuel Station'],
        ['36.080800,-94.238000', 'Walmart Fuel Station'], // Approximate area
        // North 48th Street Walmart (where Lightning 1 is currently parked)
        ['36.195353,-94.184386', 'Walmart Supercenter'],
        ['36.195300,-94.184400', 'Walmart Supercenter'], // Approximate area
        // Add more custom locations as needed
    ]);

    constructor() {
        this.googleApiKey = process.env.GOOGLE_MAPS_API_KEY || null;
        this.loadPersistentCache();
    }
    
    private loadPersistentCache(): void {
        try {
            if (fs.existsSync(this.persistentCacheFile)) {
                const data = JSON.parse(fs.readFileSync(this.persistentCacheFile, 'utf8'));
                this.reverseCache = new Map(data.reverseCache || []);
                console.log(`📁 Loaded ${this.reverseCache.size} geocoding entries from persistent cache`);
            }
        } catch (error) {
            console.warn('⚠️ Could not load persistent geocoding cache:', error);
        }
    }
    
    private savePersistentCache(): void {
        try {
            const data = {
                reverseCache: Array.from(this.reverseCache.entries()),
                lastUpdated: new Date().toISOString()
            };
            fs.writeFileSync(this.persistentCacheFile, JSON.stringify(data, null, 2));
            console.log(`💾 Saved ${this.reverseCache.size} geocoding entries to persistent cache`);
        } catch (error) {
            console.warn('⚠️ Could not save persistent geocoding cache:', error);
        }
    }

    async getAddress(latitude: number, longitude: number, vehicleState?: string): Promise<string> {
        const key = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;

        // Check custom location mappings FIRST (highest priority for known business locations like Casey's)
        const customLocation = this.getCustomLocation(latitude, longitude);
        if (customLocation) {
            this.reverseCache.set(key, customLocation);
            this.savePersistentCache(); // Save custom location mappings
            return customLocation;
        }

        // Check Jobber client locations SECOND (highest priority after custom locations)
        try {
            const clientMatch = await clientLocationService.findClientLocationMatch(latitude, longitude);
            if (clientMatch) {
                console.log(`🎯 Found client location: ${clientMatch} - highest priority, caching permanently`);
                this.reverseCache.set(key, clientMatch);
                this.savePersistentCache(); // Save immediately for client matches
                return clientMatch;
            }
        } catch (error) {
            console.error('❌ Error checking client locations:', error);
        }

        // Check cache THIRD - after client locations have been checked
        if (this.reverseCache.has(key)) {
            const cachedResult = this.reverseCache.get(key)!;
            console.log(`📋 Using cached result: ${cachedResult} (after client location check)`);
            return cachedResult;
        }

        // Check geofencing zones (suppliers, shops) with distance calculation
        const geofenceMatch = this.checkGeofencingZones(latitude, longitude);
        if (geofenceMatch) {
            this.reverseCache.set(key, geofenceMatch);
            return geofenceMatch;
        }

        // ONLY call Google Places API if vehicle is PARKED and rate limit not exceeded
        if (vehicleState === 'PARKED' && this.googleApiKey && this.canCallPlacesApi()) {
            try {
                console.log(`🅿️ Vehicle PARKED - trying Google Places API as fallback (${this.placesApiCallsToday}/${this.MAX_PLACES_API_CALLS_PER_DAY} calls today)`);
                const businessName = await this.getNearbyBusinessSingle(latitude, longitude);
                if (businessName) {
                    console.log(`🏢 Found nearby business: ${businessName} - caching permanently`);
                    this.reverseCache.set(key, businessName);
                    this.savePersistentCache();
                    return businessName;
                }
                // If Places API found nothing, fall through to OpenStreetMap
                console.log(`❌ Places API found no business - falling back to OpenStreetMap`);
            } catch (error) {
                console.error('⚠️ Google Places API failed:', error);
                // Fall through to OpenStreetMap on error
            }
        } else if (vehicleState !== 'PARKED') {
            console.log(`⏭️ Skipping Places API - vehicle not parked (state: ${vehicleState})`);
        } else if (!this.canCallPlacesApi()) {
            console.log(`⛔ Skipping Places API - rate limit exceeded (${this.placesApiCallsToday}/${this.MAX_PLACES_API_CALLS_PER_DAY} calls today)`);
        }

        // Final fallback to free OpenStreetMap (for non-parked vehicles or when Places API fails/exhausted)
        const address = await this.getAddressFromOpenStreetMap(latitude, longitude, key);
        this.savePersistentCache();
        return address;
    }

    // Rate limit check
    private canCallPlacesApi(): boolean {
        const today = new Date().toISOString().split('T')[0];

        // Reset counter if new day
        if (this.lastResetDate !== today) {
            this.placesApiCallsToday = 0;
            this.lastResetDate = today;
        }

        return this.placesApiCallsToday < this.MAX_PLACES_API_CALLS_PER_DAY;
    }

    // Increment Places API call counter
    private incrementPlacesApiCalls(): void {
        this.placesApiCallsToday++;
        console.log(`📊 Places API calls today: ${this.placesApiCallsToday}/${this.MAX_PLACES_API_CALLS_PER_DAY}`);
    }

    private async getAddressFromGoogle(latitude: number, longitude: number, cacheKey: string): Promise<string> {
        const response = await fetch(
            `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${this.googleApiKey}`
        );

        if (!response.ok) {
            throw new Error(`Google Geocoding request failed: ${response.status}`);
        }

        const data = await response.json();
        
        if (data.status !== 'OK' || !data.results || data.results.length === 0) {
            throw new Error(`Google Geocoding API error: ${data.status}`);
        }

        // Get the most specific result (usually the first one)
        const result = data.results[0];
        let address = result.formatted_address;

        // Try to create a more concise address from components
        const components = result.address_components;
        if (components && components.length > 0) {
            const addressParts = [];
            let streetNumber = '';
            let route = '';
            let locality = '';
            let adminArea = '';

            for (const component of components) {
                const types = component.types;
                if (types.includes('street_number')) {
                    streetNumber = component.short_name;
                } else if (types.includes('route')) {
                    route = component.short_name;
                } else if (types.includes('locality')) {
                    locality = component.short_name;
                } else if (types.includes('administrative_area_level_1')) {
                    adminArea = component.short_name;
                }
            }

            // Build concise address
            if (streetNumber && route) {
                addressParts.push(`${streetNumber} ${route}`);
            } else if (route) {
                addressParts.push(route);
            }
            if (locality) addressParts.push(locality);
            if (adminArea) addressParts.push(adminArea);

            if (addressParts.length > 0) {
                address = addressParts.join(', ');
            }
        }

        // Cache the result
        this.reverseCache.set(cacheKey, address);
        
        return address;
    }

    private async getAddressFromOpenStreetMap(latitude: number, longitude: number, cacheKey: string): Promise<string> {
        try {
            // Use OpenStreetMap Nominatim (free reverse geocoding)
            const response = await fetch(
                `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=16&addressdetails=1`,
                {
                    headers: {
                        'User-Agent': 'SparkLawn-Vehicle-Dashboard/1.0'
                    }
                }
            );

            if (!response.ok) {
                throw new Error('OpenStreetMap geocoding request failed');
            }

            const data = await response.json();
            
            let address = '';
            if (data.address) {
                const parts = [];
                if (data.address.house_number) parts.push(data.address.house_number);
                if (data.address.road) parts.push(data.address.road);
                if (data.address.city) parts.push(data.address.city);
                if (data.address.state) parts.push(data.address.state);
                
                address = parts.join(', ');
            }
            
            if (!address && data.display_name) {
                // Fallback to display name, but truncate for readability
                const parts = data.display_name.split(',').slice(0, 3);
                address = parts.join(',');
            }
            
            if (!address) {
                address = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
            }

            // Cache the result
            this.reverseCache.set(cacheKey, address);
            
            return address;

        } catch (error) {
            console.error('OpenStreetMap geocoding error:', error);
            // Final fallback to coordinates
            return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
        }
    }

    async getCoordinates(address: string): Promise<GeocodeResult | null> {
        const key = address.toLowerCase().trim();
        
        // Check cache first
        if (this.forwardCache.has(key)) {
            return this.forwardCache.get(key)!;
        }

        // Try Google Places API first if we have an API key
        if (this.googleApiKey) {
            try {
                return await this.getCoordinatesFromGoogle(address, key);
            } catch (error) {
                console.warn('Google forward geocoding failed, falling back to OpenStreetMap:', error);
                // Fall through to OpenStreetMap fallback
            }
        }

        // Fallback to OpenStreetMap Nominatim
        return await this.getCoordinatesFromOpenStreetMap(address, key);
    }

    private async getCoordinatesFromGoogle(address: string, cacheKey: string): Promise<GeocodeResult | null> {
        const encodedAddress = encodeURIComponent(address);
        const response = await fetch(
            `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${this.googleApiKey}`
        );

        if (!response.ok) {
            throw new Error(`Google forward geocoding request failed: ${response.status}`);
        }

        const data = await response.json();
        
        if (data.status !== 'OK' || !data.results || data.results.length === 0) {
            console.warn(`Google API: No coordinates found for address: ${address} (Status: ${data.status})`);
            return null;
        }

        const firstResult = data.results[0];
        const location = firstResult.geometry.location;

        const result: GeocodeResult = {
            latitude: location.lat,
            longitude: location.lng,
            formattedAddress: firstResult.formatted_address
        };

        // Cache the result
        this.forwardCache.set(cacheKey, result);
        
        return result;
    }

    private async getCoordinatesFromOpenStreetMap(address: string, cacheKey: string): Promise<GeocodeResult | null> {
        try {
            // Use OpenStreetMap Nominatim for forward geocoding
            const encodedAddress = encodeURIComponent(address);
            const response = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&q=${encodedAddress}&limit=1&addressdetails=1`,
                {
                    headers: {
                        'User-Agent': 'SparkLawn-Vehicle-Dashboard/1.0'
                    }
                }
            );

            if (!response.ok) {
                throw new Error('OpenStreetMap forward geocoding request failed');
            }

            const data = await response.json();
            
            if (!data || data.length === 0) {
                console.warn(`OpenStreetMap: No coordinates found for address: ${address}`);
                return null;
            }

            const result: GeocodeResult = {
                latitude: parseFloat(data[0].lat),
                longitude: parseFloat(data[0].lon),
                formattedAddress: data[0].display_name
            };

            // Cache the result
            this.forwardCache.set(cacheKey, result);
            
            return result;

        } catch (error) {
            console.error('OpenStreetMap forward geocoding error:', error);
            return null;
        }
    }

    // Clear ONLY in-memory cache, preserve persistent disk cache
    clearMemoryCache(): void {
        this.forwardCache.clear(); // Only clear forward cache
        console.log('🧹 Cleared memory cache but preserved persistent geocoding cache');
    }

    // Fix street address cache entries by finding nearby businesses
    async fixStreetAddressCacheEntries(): Promise<number> {
        if (!this.googleApiKey) {
            console.log('⚠️ Cannot fix street addresses without Google API key');
            return 0;
        }

        let fixedCount = 0;
        const entriesToFix: Array<{key: string, address: string, lat: number, lng: number}> = [];

        // Find all street address cache entries
        for (const [key, cachedAddress] of this.reverseCache.entries()) {
            if (this.isStreetAddress(cachedAddress)) {
                const [lat, lng] = key.split(',').map(coord => parseFloat(coord));
                entriesToFix.push({ key, address: cachedAddress, lat, lng });
            }
        }

        console.log(`🔧 Found ${entriesToFix.length} street address cache entries to potentially fix`);

        // Process each street address entry
        for (const entry of entriesToFix) {
            try {
                console.log(`🔍 Checking for business at ${entry.address} (${entry.key})`);
                const businessName = await this.getNearbyBusinessSingle(entry.lat, entry.lng);

                if (businessName) {
                    console.log(`✅ Fixed: "${entry.address}" → "${businessName}"`);
                    this.reverseCache.set(entry.key, businessName);
                    fixedCount++;
                } else {
                    console.log(`❌ No business found for: ${entry.address}`);
                }

                // Rate limiting to respect Google API limits
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (error) {
                console.error(`❌ Error fixing ${entry.address}:`, error);
            }
        }

        if (fixedCount > 0) {
            this.savePersistentCache();
            console.log(`🎉 Fixed ${fixedCount} street address entries with business names`);
        }

        return fixedCount;
    }
    
    // Force clear all caches (use sparingly)
    clearAllCaches(): void {
        this.reverseCache.clear();
        this.forwardCache.clear();
        if (fs.existsSync(this.persistentCacheFile)) {
            fs.unlinkSync(this.persistentCacheFile);
        }
        console.log('🗑️ Cleared ALL caches including persistent cache');
    }

    // Check if coordinates match any custom location mappings
    private getCustomLocation(latitude: number, longitude: number): string | null {
        // Check exact match first
        const exactKey = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
        if (this.customLocations.has(exactKey)) {
            return this.customLocations.get(exactKey)!;
        }

        // Check nearby matches (within ~10 meters)
        const lat = parseFloat(latitude.toFixed(6));
        const lng = parseFloat(longitude.toFixed(6));
        
        for (const [key, value] of this.customLocations.entries()) {
            const [mapLat, mapLng] = key.split(',').map(coord => parseFloat(coord));
            const distance = this.calculateDistance(lat, lng, mapLat, mapLng);
            
            // If within 50 meters, consider it a match
            if (distance < 50) {
                return value;
            }
        }
        
        return null;
    }

    // Check geofencing zones (client locations, suppliers, shops) using Jobber-style distance logic
    private checkGeofencingZones(latitude: number, longitude: number): string | null {
        console.log(`🎯 Checking geofencing zones for coordinates: ${latitude}, ${longitude}`);
        
        try {
            const zones = geofencingService.getZones();
            console.log(`📍 Found ${zones.length} geofencing zones to check`);
            
            const matchingZones = [];
            
            // Check each zone with distance calculation (same logic as geofencing service)
            for (const zone of zones) {
                const distance = this.calculateDistance(
                    latitude, longitude,
                    zone.center.latitude, zone.center.longitude
                );
                
                console.log(`📏 Zone "${zone.name}" (${zone.type}): ${distance.toFixed(1)}m away (radius: ${zone.radius}m)`);
                
                if (distance <= zone.radius) {
                    matchingZones.push({
                        zone,
                        distance
                    });
                    console.log(`✅ MATCH! ${zone.name} (${distance.toFixed(1)}m within ${zone.radius}m radius)`);
                }
            }
            
            if (matchingZones.length > 0) {
                // Sort by distance to get the closest match
                matchingZones.sort((a, b) => a.distance - b.distance);
                const closest = matchingZones[0];
                
                console.log(`🎯 Closest geofencing match: "${closest.zone.name}" (${closest.distance.toFixed(1)}m)`);
                return closest.zone.name;
            }
            
            console.log(`❌ No geofencing zones match these coordinates`);
            return null;
            
        } catch (error) {
            console.error('❌ Error checking geofencing zones:', error);
            return null;
        }
    }

    // Single Google Places API call - ONLY for parked vehicles as fallback
    private async getNearbyBusinessSingle(latitude: number, longitude: number): Promise<string | null> {
        if (!this.canCallPlacesApi()) {
            console.log(`⛔ Rate limit reached - no Places API call`);
            return null;
        }

        try {
            // Single radius search - 150ft (~45m) - reasonable distance for parked location
            const radius = 45;
            console.log(`🔍 Searching for business within 150ft (45m) - SINGLE API CALL`);

            const nearbyResponse = await fetch(
                `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${latitude},${longitude}&radius=${radius}&key=${this.googleApiKey}`
            );

            this.incrementPlacesApiCalls(); // Count this API call

            if (!nearbyResponse.ok) {
                console.error(`❌ Places API error:`, nearbyResponse.status);
                return null;
            }

            const nearbyData = await nearbyResponse.json();
            if (nearbyData.status === 'OK' && nearbyData.results && nearbyData.results.length > 0) {
                console.log(`🔍 Found ${nearbyData.results.length} places within 150ft`);

                const placesWithDistance = nearbyData.results
                    .filter((place: any) => place.name && place.geometry && place.geometry.location)
                    .map((place: any) => ({
                        ...place,
                        distance: this.calculateDistance(latitude, longitude, place.geometry.location.lat, place.geometry.location.lng)
                    }))
                    .sort((a: any, b: any) => a.distance - b.distance);

                // Filter out administrative locations
                const validBusinesses = placesWithDistance.filter((place: any) => {
                    if (this.isAdministrativeLocation(place)) return false;
                    if (this.isCityName(place.name)) return false;
                    if (place.business_status === 'CLOSED_PERMANENTLY') return false;
                    return true;
                });

                // Prioritize major businesses
                for (const place of validBusinesses) {
                    if (this.isMajorBusiness(place) && place.distance <= 45) {
                        console.log(`🏢 Found major business: ${place.name} (${place.distance.toFixed(1)}m)`);
                        return place.name;
                    }
                }

                // Return closest valid business
                if (validBusinesses.length > 0) {
                    const closest = validBusinesses[0];
                    console.log(`🏪 Found business: ${closest.name} (${closest.distance.toFixed(1)}m)`);
                    return closest.name;
                }
            }

            console.log(`❌ No businesses found within 150ft`);
            return null;
        } catch (error) {
            console.error('⚠️ Google Places API error:', error);
            return null;
        }
    }

    // OLD multi-call version - DISABLED
    private async getNearbyBusiness(latitude: number, longitude: number): Promise<string | null> {
        console.log(`⛔ OLD getNearbyBusiness called - this should not happen!`);
        return null;

        /* ORIGINAL CODE - DO NOT RE-ENABLE WITHOUT STRICT RATE LIMITING
        try {
            // Optimized radius search - 50ft, 150ft, 300ft, 750ft, 1250ft (converted to meters)
            const radii = [15, 45, 90, 230, 380]; // ~50ft, ~150ft, ~300ft, ~750ft, ~1250ft
            console.log(`🔄 Optimized progressive radius search for businesses: ${radii.map(r => `${r}m (~${Math.round(r*3.28)}ft)`).join(', ')}`);

            for (const radius of radii) {
                const ftDescription = Math.round(radius * 3.28084) + 'ft';
                console.log(`🔍 Searching radius: ${ftDescription} (${radius}m)`);
                
                try {
                    const nearbyResponse = await fetch(
                        `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${latitude},${longitude}&radius=${radius}&key=${this.googleApiKey}`
                    );
                    
                    if (nearbyResponse.ok) {
                        const nearbyData = await nearbyResponse.json();
                        if (nearbyData.status === 'OK' && nearbyData.results && nearbyData.results.length > 0) {
                            console.log(`🔍 Found ${nearbyData.results.length} places within ${ftDescription}`);
                            
                            const placesWithDistance = nearbyData.results
                                .filter((place: any) => place.name && place.geometry && place.geometry.location)
                                .map((place: any) => ({
                                    ...place,
                                    distance: this.calculateDistance(latitude, longitude, place.geometry.location.lat, place.geometry.location.lng)
                                }))
                                .sort((a: any, b: any) => a.distance - b.distance);

                            console.log(`📍 Top places within ${ftDescription}:`, placesWithDistance.slice(0, 3).map((p: any) => `${p.name} (${p.distance.toFixed(1)}m) [${p.types.slice(0,2).join(', ')}]`));

                            // Prioritize businesses, but filter out minor services
                            const validBusinesses = placesWithDistance.filter((place: any) => {
                                if (this.isAdministrativeLocation(place)) return false;
                                if (this.isCityName(place.name)) return false;
                                if (place.business_status === 'CLOSED_PERMANENTLY') return false;
                                return true;
                            });

                            // First pass: Look for major chain businesses
                            for (const place of validBusinesses) {
                                if (this.isMajorBusiness(place) && place.distance <= radius && place.distance <= 200) {
                                    console.log(`🏢 Found major business: ${place.name} (${place.distance.toFixed(1)}m) - Types: ${place.types.join(', ')}`);
                                    return place.name;
                                }
                            }

                            // Second pass: High priority business types (but not minor services)
                            for (const place of validBusinesses) {
                                if (this.isMinorService(place)) {
                                    console.log(`⏭️ Skipping minor service: ${place.name} (${place.distance.toFixed(1)}m) - looking for main business`);
                                    continue;
                                }
                                
                                if (this.isHighPriorityBusiness(place.types) && place.distance <= radius) {
                                    console.log(`✅ Found priority business: ${place.name} (${place.distance.toFixed(1)}m) - Types: ${place.types.join(', ')}`);
                                    return place.name;
                                }
                            }

                            // Third pass: Regular businesses (but not minor services)
                            for (const place of validBusinesses) {
                                if (this.isMinorService(place)) continue;
                                
                                if (place.types.includes('establishment') || 
                                    place.types.includes('point_of_interest') ||
                                    this.hasBusinessType(place.types)) {
                                    
                                    if (place.distance <= radius && place.distance <= 150) {
                                        console.log(`✅ Found business: ${place.name} (${place.distance.toFixed(1)}m) - Types: ${place.types.join(', ')}`);
                                        return place.name;
                                    }
                                }
                            }

                            // Special case: If we found kiosks/exchanges, look for nearby parent businesses
                            const minorServicesFound = validBusinesses.filter((place: any) => this.isMinorService(place));
                            if (minorServicesFound.length > 0) {
                                console.log(`🔍 Found ${minorServicesFound.length} kiosk/exchange services, searching for parent business in expanded radius...`);

                                // Search larger radius for parent business
                                const expandedRadius = Math.min(radius * 3, 300); // Expand search but cap at 300m
                                try {
                                    const expandedResponse = await fetch(
                                        `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${latitude},${longitude}&radius=${expandedRadius}&key=${this.googleApiKey}`
                                    );

                                    if (expandedResponse.ok) {
                                        const expandedData = await expandedResponse.json();
                                        if (expandedData.status === 'OK' && expandedData.results && expandedData.results.length > 0) {
                                            const expandedPlaces = expandedData.results
                                                .filter((place: any) => place.name && place.geometry && place.geometry.location)
                                                .map((place: any) => ({
                                                    ...place,
                                                    distance: this.calculateDistance(latitude, longitude, place.geometry.location.lat, place.geometry.location.lng)
                                                }))
                                                .sort((a: any, b: any) => a.distance - b.distance)
                                                .filter((place: any) => {
                                                    if (this.isAdministrativeLocation(place)) return false;
                                                    if (this.isCityName(place.name)) return false;
                                                    if (place.business_status === 'CLOSED_PERMANENTLY') return false;
                                                    if (this.isMinorService(place)) return false; // Skip kiosks in expanded search
                                                    return true;
                                                });

                                            // Look for major businesses in expanded area
                                            for (const place of expandedPlaces) {
                                                if (this.isMajorBusiness(place) && place.distance <= expandedRadius) {
                                                    console.log(`🏢 Found parent business for kiosk: ${place.name} (${place.distance.toFixed(1)}m) - Types: ${place.types.join(', ')}`);
                                                    return place.name;
                                                }
                                            }

                                            // Look for any regular business in expanded area
                                            for (const place of expandedPlaces) {
                                                if (this.hasBusinessType(place.types) && place.distance <= expandedRadius) {
                                                    console.log(`🏪 Found nearby business for kiosk: ${place.name} (${place.distance.toFixed(1)}m) - Types: ${place.types.join(', ')}`);
                                                    return place.name;
                                                }
                                            }
                                        }
                                    }
                                } catch (expandedError) {
                                    console.error(`❌ Error in expanded search:`, expandedError);
                                }
                            }

                            // Last pass: Allow minor services only if no major businesses found and very close
                            for (const place of validBusinesses) {
                                if (place.distance <= 30 && this.hasBusinessType(place.types)) { // Only if within 30m
                                    console.log(`⚠️ Fallback to minor service (very close): ${place.name} (${place.distance.toFixed(1)}m) - Types: ${place.types.join(', ')}`);
                                    return place.name;
                                }
                            }
                        } else {
                            console.log(`❌ No results found within ${ftDescription} radius`);
                        }
                    } else {
                        console.error(`❌ Nearby Search API error for radius ${ftDescription}:`, nearbyResponse.status, nearbyResponse.statusText);
                    }
                } catch (nearbyError) {
                    console.error(`❌ Error searching radius ${ftDescription}:`, nearbyError);
                }
                
                // Small delay between requests to respect rate limits
                await new Promise(resolve => setTimeout(resolve, 50));
            }

            console.log(`❌ No businesses found near ${latitude}, ${longitude} after trying all search strategies`);
            return null;
        } catch (error) {
            console.warn('Google Places API error:', error);
            return null;
        }
        */
    }

    // Helper methods for business detection
    private isAdministrativeLocation(place: any): boolean {
        const adminTypes = ['locality', 'political', 'administrative_area_level_1', 'administrative_area_level_2', 'country', 'postal_code', 'sublocality'];
        return place.types.some((type: string) => adminTypes.includes(type)) && 
               !place.types.includes('establishment') && 
               !place.types.includes('point_of_interest');
    }

    private isCityName(name: string): boolean {
        const cityNames = ['Springdale', 'Bentonville', 'Fayetteville', 'Rogers', 'Arkansas', 'United States'];
        return cityNames.includes(name);
    }

    private isHighPriorityBusiness(types: string[]): boolean {
        const highPriorityTypes = [
            'gas_station', 'restaurant', 'convenience_store', 'fast_food', 'meal_takeaway',
            'supermarket', 'shopping_mall', 'pharmacy', 'hospital', 'bank',
            'car_dealer', 'car_repair', 'lodging', 'hotel', 'store'
        ];
        return types.some((type: string) => highPriorityTypes.includes(type));
    }

    private isMajorBusiness(place: any): boolean {
        // Prioritize major chain stores and businesses over small services
        const name = place.name.toLowerCase();
        
        // Major businesses that should be prioritized
        const majorChains = [
            'lowe\'s', 'lowes', 'home depot', 'walmart', 'target', 'costco', 'sam\'s club',
            'casey\'s', 'caseys', 'kum & go', 'kwik trip', 'speedway', 'shell', 'exxon', 
            'chevron', 'bp', 'phillips 66', 'conoco', 'texaco', 'citgo', 'marathon',
            'maverik', 'maverick', 'pilot', 'love\'s', 'flying j',
            'mcdonald\'s', 'burger king', 'wendy\'s', 'taco bell', 'kfc', 'subway',
            'whataburger', 'sonic', 'dairy queen', 'arby\'s', 'chick-fil-a',
            'pizza hut', 'domino\'s', 'papa john\'s', 'little caesars',
            'starbucks', 'dunkin\'', 'tim hortons',
            'cvs', 'walgreens', 'rite aid', 'dollar general', 'family dollar',
            'autozone', 'o\'reilly', 'advance auto', 'napa',
            'applebee\'s', 'olive garden', 'red lobster', 'outback', 'chili\'s'
        ];
        
        return majorChains.some(chain => name.includes(chain));
    }

    private isMinorService(place: any): boolean {
        // Filter out small services/vendors that are typically inside or adjacent to major businesses
        const name = place.name.toLowerCase();
        const types = place.types || [];
        
        const minorServices = [
            'atm', 'bitcoin', 'propane', 'redbox', 'coinstar', 'western union',
            'money gram', 'check into cash', 'payday', 'title loan',
            'mobile', 'verizon kiosk', 'at&t kiosk', 'sprint kiosk',
            'nail salon', 'hair salon', 'massage', 'dry clean',
            'subway sandwich', 'starbucks kiosk', 'dunkin kiosk',
            'water exchange', 'primo water', 'blue rhino'
        ];
        
        // Check name patterns
        if (minorServices.some(service => name.includes(service))) return true;
        
        // Check for ATM-specific types
        if (types.includes('atm') || types.includes('finance') && name.includes('bitcoin')) return true;
        
        // Filter out very generic points of interest that aren't actual businesses
        if (types.includes('point_of_interest') && types.length === 2 && 
            types.includes('establishment') && !this.hasBusinessType(types)) return true;
            
        return false;
    }

    private hasBusinessType(types: string[]): boolean {
        const businessTypes = [
            'store', 'restaurant', 'gas_station', 'shopping_mall', 'hospital', 'bank', 'pharmacy',
            'supermarket', 'convenience_store', 'car_dealer', 'car_repair', 'school', 'university',
            'gym', 'beauty_salon', 'hair_care', 'spa', 'lodging', 'meal_takeaway', 'food',
            'accounting', 'lawyer', 'dentist', 'doctor', 'veterinary_care', 'real_estate_agency',
            'insurance_agency', 'travel_agency', 'moving_company', 'storage', 'laundry',
            'electronics_store', 'furniture_store', 'clothing_store', 'book_store', 'jewelry_store',
            'pet_store', 'florist', 'hardware_store', 'home_goods_store', 'bicycle_store',
            'fast_food' // Added fast_food
        ];
        return types.some((type: string) => businessTypes.includes(type));
    }

    // Helper method to detect if a result is a street address instead of a business name
    private isStreetAddress(address: string): boolean {
        const streetAddressPatterns = [
            /\b(street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|lane|ln|way|court|ct|circle|cir|plaza|pkwy|parkway)\b/i,
            /\b\d+\s*(north|south|east|west|n|s|e|w)\b/i, // "48th North", "123 East"
            /^(north|south|east|west)\s+\w+\s+(street|avenue|boulevard|road|drive|lane)/i // "North 48th Street"
        ];

        return streetAddressPatterns.some(pattern => pattern.test(address));
    }

    // Calculate distance between two points in meters
    private calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
        const R = 6371e3; // Earth's radius in meters
        const φ1 = lat1 * Math.PI/180;
        const φ2 = lat2 * Math.PI/180;
        const Δφ = (lat2-lat1) * Math.PI/180;
        const Δλ = (lng2-lng1) * Math.PI/180;

        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ/2) * Math.sin(Δλ/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        return R * c;
    }
}

export const geocodingService = new GeocodingService();

// Only clear memory cache on startup - preserve persistent cache for discovered locations
geocodingService.clearMemoryCache();
console.log('🧹 Memory cache cleared on startup - persistent cache preserved');

// Periodically clear only memory cache to allow fresh coordinate lookups
setInterval(() => {
    geocodingService.clearMemoryCache();
    console.log('🧹 Memory cache cleared - persistent cache preserved');
}, 15 * 60 * 1000);