export class GeocodingService {
    private cache: Map<string, string> = new Map();

    async getAddress(latitude: number, longitude: number): Promise<string> {
        const key = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
        
        // Check cache first
        if (this.cache.has(key)) {
            return this.cache.get(key)!;
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
            this.cache.set(key, address);
            
            return address;

        } catch (error) {
            console.error('Geocoding error:', error);
            // Fallback to coordinates
            return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
        }
    }

    // Clear cache periodically to prevent memory issues
    clearCache(): void {
        this.cache.clear();
    }
}

export const geocodingService = new GeocodingService();

// Clear cache every hour
setInterval(() => {
    geocodingService.clearCache();
}, 60 * 60 * 1000);