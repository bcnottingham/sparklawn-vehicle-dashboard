import { Router } from 'express';
import { geocodingService } from '../services/geocoding';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

interface ClientCacheEntry {
    lat: number;
    lng: number;
    source: string;
    clientName: string;
    lastUpdated: string;
    priority: number;
    radius: number;
    isClient?: boolean; // Optional for backwards compatibility
    clientType?: 'residential' | 'commercial'; // New field for residential vs commercial
    isActive?: boolean; // Optional field for active/inactive status
}

interface ClientCache {
    [address: string]: ClientCacheEntry;
}

const CACHE_FILE_PATH = path.join(__dirname, '../../../sparklawn-website-manager/client-coordinates-cache.json');

// GET /api/clients - List all clients
router.get('/', async (req, res) => {
    try {
        if (!fs.existsSync(CACHE_FILE_PATH)) {
            return res.status(404).json({ error: 'Client cache not found' });
        }

        const cacheData: ClientCache = JSON.parse(fs.readFileSync(CACHE_FILE_PATH, 'utf8'));
        const clients = Object.entries(cacheData).map(([address, data]) => ({
            address,
            ...data,
            // Apply intelligent radius for legacy records without radius
            radius: data.radius || getIntelligentRadius(data.clientName, address)
        }));

        res.json({
            total: clients.length,
            clients: clients.sort((a, b) => a.clientName.localeCompare(b.clientName))
        });
    } catch (error) {
        console.error('Error fetching clients:', error);
        res.status(500).json({ error: 'Failed to fetch clients' });
    }
});

// POST /api/clients - Add new client
router.post('/', async (req, res) => {
    try {
        const { clientName, address, lat, lng, radius, isClient, clientType, isActive } = req.body;

        // Validation
        if (!clientName) {
            return res.status(400).json({
                error: 'Location name is required'
            });
        }

        if (!lat || !lng) {
            return res.status(400).json({
                error: 'Coordinates (lat/lng) are required'
            });
        }

        // Load existing cache
        let cacheData: ClientCache = {};
        if (fs.existsSync(CACHE_FILE_PATH)) {
            cacheData = JSON.parse(fs.readFileSync(CACHE_FILE_PATH, 'utf8'));
        }

        // Use address if provided, otherwise generate from coordinates
        const finalAddress = address || `${clientName} (${lat}, ${lng})`;
        const normalizedAddress = finalAddress.toLowerCase().trim();

        // Check if location already exists
        if (cacheData[normalizedAddress]) {
            return res.status(409).json({
                error: 'Location already exists at this address'
            });
        }

        // Determine intelligent radius based on client type
        const intelligentRadius = radius || getIntelligentRadius(clientName, finalAddress);

        // Add to cache
        const newLocation: ClientCacheEntry = {
            lat: lat,
            lng: lng,
            source: 'api',
            clientName,
            lastUpdated: new Date().toISOString(),
            priority: isClient !== false ? 1 : 0, // Default to client priority unless explicitly marked as marker
            radius: intelligentRadius,
            isClient: isClient !== false, // Default to true for backwards compatibility
            clientType: clientType || 'residential', // Default to residential if not specified
            isActive: isActive !== false // Default to active unless explicitly marked as inactive
        };

        cacheData[normalizedAddress] = newLocation;

        // Save cache
        fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(cacheData, null, 2));

        const locationType = isClient !== false ? 'client' : 'marker';
        console.log(`✅ Added new ${locationType}: ${clientName} at ${finalAddress}`);

        res.status(201).json({
            message: `${isClient !== false ? 'Client' : 'Marker'} added successfully`,
            client: {
                address: normalizedAddress,
                ...newLocation
            },
            totalClients: Object.keys(cacheData).length
        });

    } catch (error) {
        console.error('Error adding client:', error);
        res.status(500).json({ error: 'Failed to add client' });
    }
});

// PUT /api/clients/:address - Update existing client
router.put('/:address', async (req, res) => {
    try {
        const { address } = req.params;
        const { clientName, lat, lng, radius, isClient, clientType, isActive } = req.body;

        if (!fs.existsSync(CACHE_FILE_PATH)) {
            return res.status(404).json({ error: 'Client cache not found' });
        }

        const cacheData: ClientCache = JSON.parse(fs.readFileSync(CACHE_FILE_PATH, 'utf8'));
        const normalizedAddress = address.toLowerCase().trim();

        if (!cacheData[normalizedAddress]) {
            return res.status(404).json({ error: 'Client not found' });
        }

        // Update fields
        if (clientName) cacheData[normalizedAddress].clientName = clientName;
        if (lat) cacheData[normalizedAddress].lat = lat;
        if (lng) cacheData[normalizedAddress].lng = lng;
        if (radius) cacheData[normalizedAddress].radius = radius;
        if (isClient !== undefined) {
            cacheData[normalizedAddress].isClient = isClient;
            cacheData[normalizedAddress].priority = isClient ? 1 : 0;
        }
        if (clientType !== undefined) cacheData[normalizedAddress].clientType = clientType;
        if (isActive !== undefined) cacheData[normalizedAddress].isActive = isActive;
        cacheData[normalizedAddress].lastUpdated = new Date().toISOString();

        // Save cache
        fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(cacheData, null, 2));

        res.json({
            message: 'Client updated successfully',
            client: {
                address: normalizedAddress,
                ...cacheData[normalizedAddress]
            }
        });

    } catch (error) {
        console.error('Error updating client:', error);
        res.status(500).json({ error: 'Failed to update client' });
    }
});

// DELETE /api/clients/:address - Remove client
router.delete('/:address', async (req, res) => {
    try {
        const { address } = req.params;

        if (!fs.existsSync(CACHE_FILE_PATH)) {
            return res.status(404).json({ error: 'Client cache not found' });
        }

        const cacheData: ClientCache = JSON.parse(fs.readFileSync(CACHE_FILE_PATH, 'utf8'));
        const normalizedAddress = address.toLowerCase().trim();

        if (!cacheData[normalizedAddress]) {
            return res.status(404).json({ error: 'Client not found' });
        }

        const deletedClient = cacheData[normalizedAddress];
        delete cacheData[normalizedAddress];

        // Save cache
        fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(cacheData, null, 2));

        res.json({
            message: 'Client removed successfully',
            deletedClient: {
                address: normalizedAddress,
                ...deletedClient
            },
            totalClients: Object.keys(cacheData).length
        });

    } catch (error) {
        console.error('Error removing client:', error);
        res.status(500).json({ error: 'Failed to remove client' });
    }
});

// Helper function for intelligent radius detection (returns meters, but based on feet logic)
function getIntelligentRadius(clientName: string, address: string): number {
    const name = clientName.toLowerCase();
    const addr = address.toLowerCase();

    // Large commercial properties (converted from feet to meters for storage)
    if (name.includes('school') || name.includes('university') || name.includes('college')) return Math.round(500 / 3.28084); // 500ft
    if (name.includes('hospital') || name.includes('medical center')) return Math.round(650 / 3.28084); // 650ft
    if (name.includes('mall') || name.includes('shopping center')) return Math.round(500 / 3.28084); // 500ft
    if (name.includes('park') || name.includes('recreation')) return Math.round(650 / 3.28084); // 650ft
    if (name.includes('church') || name.includes('cathedral')) return Math.round(400 / 3.28084); // 400ft
    if (name.includes('hotel') || name.includes('resort')) return Math.round(500 / 3.28084); // 500ft
    if (name.includes('museum') || name.includes('center')) return Math.round(400 / 3.28084); // 400ft

    // Business districts
    if (addr.includes('downtown') || addr.includes('main street')) return Math.round(260 / 3.28084); // 260ft

    // Residential areas (most common)
    if (name.includes('living') || name.includes('apartment') || name.includes('homes')) return Math.round(330 / 3.28084); // 330ft

    // Default for typical residential clients (330ft = ~100m)
    return Math.round(330 / 3.28084); // 330ft
}

// GET /api/clients/fix-radius - Bulk fix legacy radius values
router.get('/fix-radius', async (req, res) => {
    try {
        if (!fs.existsSync(CACHE_FILE_PATH)) {
            return res.status(404).json({ error: 'Client cache not found' });
        }

        const cacheData: ClientCache = JSON.parse(fs.readFileSync(CACHE_FILE_PATH, 'utf8'));
        let fixedCount = 0;

        // Fix all undefined radius values
        for (const [address, client] of Object.entries(cacheData)) {
            if (!client.radius || client.radius === undefined) {
                const intelligentRadius = getIntelligentRadius(client.clientName, address);
                cacheData[address].radius = intelligentRadius;
                cacheData[address].lastUpdated = new Date().toISOString();
                fixedCount++;
                console.log(`🔧 Fixed radius for ${client.clientName}: ${intelligentRadius}m`);
            }
        }

        // Save updated cache
        fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(cacheData, null, 2));

        res.json({
            message: `Fixed ${fixedCount} client locations with intelligent radius values`,
            fixedCount,
            totalClients: Object.keys(cacheData).length
        });

    } catch (error) {
        console.error('Error fixing radius values:', error);
        res.status(500).json({ error: 'Failed to fix radius values' });
    }
});

// POST /api/clients/bulk-update-types - Bulk update client types for existing records
router.post('/bulk-update-types', async (req, res) => {
    try {
        const { updates } = req.body; // Array of {address: string, clientType: 'residential' | 'commercial'}

        if (!Array.isArray(updates) || updates.length === 0) {
            return res.status(400).json({ error: 'Updates array is required' });
        }

        if (!fs.existsSync(CACHE_FILE_PATH)) {
            return res.status(404).json({ error: 'Client cache not found' });
        }

        const cacheData: ClientCache = JSON.parse(fs.readFileSync(CACHE_FILE_PATH, 'utf8'));
        let updatedCount = 0;
        let notFoundCount = 0;

        // Process each update
        for (const update of updates) {
            if (!update.address || !update.clientType) {
                continue;
            }

            const normalizedAddress = update.address.toLowerCase().trim();
            if (cacheData[normalizedAddress]) {
                cacheData[normalizedAddress].clientType = update.clientType;
                cacheData[normalizedAddress].lastUpdated = new Date().toISOString();
                updatedCount++;
                console.log(`🏠 Updated ${cacheData[normalizedAddress].clientName} to ${update.clientType}`);
            } else {
                notFoundCount++;
                console.warn(`⚠️ Client not found: ${update.address}`);
            }
        }

        // Save updated cache
        fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(cacheData, null, 2));

        res.json({
            message: `Bulk update completed`,
            updatedCount,
            notFoundCount,
            totalRequests: updates.length
        });

    } catch (error) {
        console.error('Error bulk updating client types:', error);
        res.status(500).json({ error: 'Failed to bulk update client types' });
    }
});

// POST /api/clients/set-all-residential - Set all clients to residential type
router.post('/set-all-residential', async (req, res) => {
    try {
        if (!fs.existsSync(CACHE_FILE_PATH)) {
            return res.status(404).json({ error: 'Client cache not found' });
        }

        const cacheData: ClientCache = JSON.parse(fs.readFileSync(CACHE_FILE_PATH, 'utf8'));
        let updatedCount = 0;

        // Set all clients to residential
        for (const [address, client] of Object.entries(cacheData)) {
            cacheData[address].clientType = 'residential';
            cacheData[address].lastUpdated = new Date().toISOString();
            updatedCount++;
            console.log(`🏠 Set ${client.clientName} to residential`);
        }

        // Save updated cache
        fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(cacheData, null, 2));

        res.json({
            message: `Successfully set all ${updatedCount} locations to residential type`,
            updatedCount,
            totalClients: Object.keys(cacheData).length
        });

    } catch (error) {
        console.error('Error setting all clients to residential:', error);
        res.status(500).json({ error: 'Failed to set all clients to residential' });
    }
});

// POST /api/clients/fix-addresses - Bulk fix address capitalization
router.post('/fix-addresses', async (req, res) => {
    try {
        if (!fs.existsSync(CACHE_FILE_PATH)) {
            return res.status(404).json({ error: 'Client cache not found' });
        }

        const cacheData: ClientCache = JSON.parse(fs.readFileSync(CACHE_FILE_PATH, 'utf8'));
        let fixedCount = 0;

        // Function to properly capitalize addresses
        function formatAddress(address: string): string {
            if (!address || typeof address !== 'string') return address;

            // List of words that should remain lowercase (except at start)
            const lowerCaseWords = ['and', 'or', 'the', 'a', 'an', 'in', 'on', 'at', 'by', 'for', 'of', 'to', 'up', 'as', 'but', 'is', 'are', 'was', 'were'];

            // List of common abbreviations that should be uppercase
            const upperCaseWords = ['st', 'ave', 'dr', 'rd', 'blvd', 'ln', 'ct', 'pl', 'way', 'pkwy', 'hwy', 'apt', 'suite', 'ste', 'unit', 'bldg', 'fl', 'po', 'box', 'ar', 'usa', 'us'];

            return address.toLowerCase().split(' ').map((word, index) => {
                // Remove punctuation for comparison but keep it in the word
                const cleanWord = word.replace(/[^\w]/g, '');

                // Always capitalize first word
                if (index === 0) {
                    return word.charAt(0).toUpperCase() + word.slice(1);
                }

                // Handle special uppercase words
                if (upperCaseWords.includes(cleanWord.toLowerCase())) {
                    return word.replace(cleanWord, cleanWord.toUpperCase());
                }

                // Convert "arkansas" to "AR"
                if (cleanWord.toLowerCase() === 'arkansas') {
                    return word.replace(cleanWord, 'AR');
                }

                // Keep small words lowercase unless they start a sentence
                if (lowerCaseWords.includes(cleanWord.toLowerCase())) {
                    return word;
                }

                // Handle numbers followed by letters (like 38th, 1st, 2nd, 3rd)
                if (/^\d+(st|nd|rd|th)$/i.test(cleanWord)) {
                    return word.toLowerCase();
                }

                // Capitalize first letter of other words
                return word.charAt(0).toUpperCase() + word.slice(1);
            }).join(' ');
        }

        // Fix all addresses
        const newCacheData: ClientCache = {};
        for (const [address, client] of Object.entries(cacheData)) {
            const formattedAddress = formatAddress(address);

            // If address changed, use the new formatted address as key
            if (formattedAddress !== address) {
                newCacheData[formattedAddress.toLowerCase().trim()] = {
                    ...client,
                    lastUpdated: new Date().toISOString()
                };
                fixedCount++;
                console.log(`🔧 Fixed address: "${address}" → "${formattedAddress}"`);
            } else {
                // Keep the same address
                newCacheData[address] = client;
            }
        }

        // Save updated cache
        fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(newCacheData, null, 2));

        res.json({
            message: `Fixed ${fixedCount} client addresses with proper capitalization`,
            fixedCount,
            totalClients: Object.keys(newCacheData).length
        });

    } catch (error) {
        console.error('Error fixing addresses:', error);
        res.status(500).json({ error: 'Failed to fix addresses' });
    }
});

export default router;