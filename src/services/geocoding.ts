export interface GeocodeResult {
    latitude: number;
    longitude: number;
    formattedAddress: string;
}

export class GeocodingService {
    private reverseCache: Map<string, string> = new Map();
    private forwardCache: Map<string, GeocodeResult> = new Map();

    async getAddress(latitude: number, longitude: number): Promise<string> {
        const key = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
        
        // Check cache first
        if (this.reverseCache.has(key)) {
            return this.reverseCache.get(key)!;
        }

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
                throw new Error('Geocoding request failed');
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
            this.reverseCache.set(key, address);
            
            return address;

        } catch (error) {
            console.error('Geocoding error:', error);
            // Fallback to coordinates
            return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
        }
    }

    async getCoordinates(address: string): Promise<GeocodeResult | null> {
        const key = address.toLowerCase().trim();
        
        // Check cache first
        if (this.forwardCache.has(key)) {
            return this.forwardCache.get(key)!;
        }

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
                throw new Error('Forward geocoding request failed');
            }

            const data = await response.json();
            
            if (!data || data.length === 0) {
                console.warn(`No coordinates found for address: ${address}`);
                return null;
            }

            const result: GeocodeResult = {
                latitude: parseFloat(data[0].lat),
                longitude: parseFloat(data[0].lon),
                formattedAddress: data[0].display_name
            };

            // Cache the result
            this.forwardCache.set(key, result);
            
            return result;

        } catch (error) {
            console.error('Forward geocoding error:', error);
            return null;
        }
    }

    // Clear cache periodically to prevent memory issues
    clearCache(): void {
        this.reverseCache.clear();
        this.forwardCache.clear();
    }
}

export const geocodingService = new GeocodingService();

// Clear cache every hour
setInterval(() => {
    geocodingService.clearCache();
}, 60 * 60 * 1000);