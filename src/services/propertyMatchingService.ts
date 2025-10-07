import { geocodingService } from './geocoding';
import * as fs from 'fs';
import * as path from 'path';

interface ClientLocation {
  clientName: string;
  address: string;
  lat: number;
  lng: number;
}

export interface PropertyMatch {
  matched: boolean;
  clientId?: string;
  clientName?: string;
  fullAddress?: string;
  confidence: 'exact' | 'high' | 'medium' | 'low';
}

/**
 * Service to match invoice property addresses to client database
 */
export class PropertyMatchingService {
  private clientLocations: Map<string, ClientLocation> = new Map();
  private initialized = false;

  /**
   * Initialize the service by loading client location data
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Load from cached client coordinates file
      const cacheFilePath = path.join(
        __dirname,
        '../../../sparklawn-website-manager/client-coordinates-cache.json'
      );

      if (fs.existsSync(cacheFilePath)) {
        const cachedData = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));

        for (const [address, data] of Object.entries<any>(cachedData)) {
          this.clientLocations.set(address.toLowerCase(), {
            clientName: data.clientName,
            address: address,
            lat: data.lat,
            lng: data.lng
          });
        }

        console.log(`✅ Property matching initialized with ${this.clientLocations.size} client locations`);
        this.initialized = true;
      } else {
        console.warn('⚠️ Client coordinates cache not found');
      }
    } catch (error) {
      console.error('❌ Failed to initialize property matching:', error);
    }
  }

  /**
   * Match an invoice property address to a client in the database
   */
  async matchProperty(
    propertyAddress: string | undefined,
    propertyName?: string
  ): Promise<PropertyMatch> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!propertyAddress && !propertyName) {
      return { matched: false, confidence: 'low' };
    }

    // Try exact address match first
    if (propertyAddress) {
      const exactMatch = this.findExactMatch(propertyAddress);
      if (exactMatch) {
        return {
          matched: true,
          clientName: exactMatch.clientName,
          fullAddress: exactMatch.address,
          confidence: 'exact'
        };
      }

      // Try partial address match
      const partialMatch = this.findPartialMatch(propertyAddress);
      if (partialMatch) {
        return {
          matched: true,
          clientName: partialMatch.clientName,
          fullAddress: partialMatch.address,
          confidence: 'high'
        };
      }
    }

    // Try matching by property name (e.g., "Sparklawn 41" -> client name)
    if (propertyName) {
      const nameMatch = this.findByPropertyName(propertyName);
      if (nameMatch) {
        return {
          matched: true,
          clientName: nameMatch.clientName,
          fullAddress: nameMatch.address,
          confidence: 'medium'
        };
      }
    }

    return { matched: false, confidence: 'low' };
  }

  /**
   * Find exact address match (case-insensitive)
   */
  private findExactMatch(address: string): ClientLocation | null {
    const normalizedAddress = this.normalizeAddress(address);

    for (const [key, location] of this.clientLocations) {
      if (key === normalizedAddress) {
        return location;
      }
    }

    return null;
  }

  /**
   * Find partial address match (street number + street name)
   */
  private findPartialMatch(address: string): ClientLocation | null {
    const normalized = this.normalizeAddress(address);
    const parts = normalized.split(/[\s,]+/);

    // Extract street number and street name (first few parts)
    const streetIdentifier = parts.slice(0, 3).join(' ');

    for (const [key, location] of this.clientLocations) {
      if (key.includes(streetIdentifier)) {
        return location;
      }
    }

    return null;
  }

  /**
   * Match by property name (for contractors who use internal names like "Sparklawn 41")
   * This would require a mapping table in the future
   */
  private findByPropertyName(propertyName: string): ClientLocation | null {
    // For now, we can't match by contractor's internal names
    // In future, you could maintain a mapping like:
    // "Sparklawn 41" -> "Nate Green"
    // This could be stored in a separate mapping collection

    return null;
  }

  /**
   * Normalize address for comparison
   */
  private normalizeAddress(address: string): string {
    return address
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[.,]/g, ' ')
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Get all client locations for manual review/mapping
   */
  getAllClients(): ClientLocation[] {
    return Array.from(this.clientLocations.values());
  }

  /**
   * Manually add a property name -> client mapping
   * For cases like "Sparklawn 41" -> specific client
   */
  async addPropertyMapping(
    contractorPropertyName: string,
    clientName: string
  ): Promise<void> {
    // This could save to a separate mappings collection in MongoDB
    // For now, just log it
    console.log(`📝 Property mapping: "${contractorPropertyName}" -> "${clientName}"`);
  }
}

export default new PropertyMatchingService();
