/**
 * Batch Geocoding Cache Fixer
 * Processes street address cache entries in batches to avoid timeout
 */

const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '../geocoding-cache.json');
const BATCH_SIZE = 50; // Process 50 entries at a time
const DELAY_MS = 150; // 150ms between API calls for rate limiting

async function loadCache() {
    if (fs.existsSync(CACHE_FILE)) {
        const data = fs.readFileSync(CACHE_FILE, 'utf-8');
        const parsed = JSON.parse(data);
        // Convert from array format to Map
        if (parsed.reverseCache && Array.isArray(parsed.reverseCache)) {
            const map = new Map();
            for (const [key, value] of parsed.reverseCache) {
                map.set(key, value);
            }
            return map;
        }
        return new Map();
    }
    return new Map();
}

function saveCache(cacheMap) {
    // Convert Map to array format for storage
    const reverseCache = Array.from(cacheMap.entries());
    const data = {
        reverseCache: reverseCache,
        forwardCache: [] // Preserve structure
    };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
    console.log('✅ Cache saved to disk');
}

function isStreetAddress(address) {
    const streetPatterns = [
        /^\d+\s+[A-Z]/i,  // Starts with number (123 Main St)
        /\b(Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|Way|Circle|Cir|Court|Ct|Plaza|Parkway|Pkwy|Highway|Hwy)\b/i
    ];

    const businessIndicators = [
        /\b(Inc|LLC|Corp|Company|Co\.|Industries|Services|Store|Shop|Market|Restaurant|Cafe|Bar|Grill)\b/i,
        /^[A-Z][a-z]+('[A-Z][a-z]+|\s+[A-Z][a-z]+){0,3}$/  // Proper names like "Maverik" or "The Hardware Store"
    ];

    // If it has business indicators, it's not a street address
    for (const pattern of businessIndicators) {
        if (pattern.test(address)) {
            return false;
        }
    }

    // Check if it matches street patterns
    for (const pattern of streetPatterns) {
        if (pattern.test(address)) {
            return true;
        }
    }

    return false;
}

async function getNearbyBusiness(lat, lng, apiKey) {
    const radii = [5, 10, 25, 50, 100, 250, 500, 1000];

    for (const radius of radii) {
        try {
            const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&key=${apiKey}`;

            const response = await fetch(url);
            const data = await response.json();

            if (data.status === 'OK' && data.results && data.results.length > 0) {
                const business = data.results[0];
                if (business.name && business.types &&
                    !business.types.includes('street_address') &&
                    !business.types.includes('route')) {
                    return business.name;
                }
            }
        } catch (error) {
            console.error(`Error checking radius ${radius}m:`, error.message);
        }
    }

    return null;
}

async function processBatch(entries, startIndex, apiKey) {
    const endIndex = Math.min(startIndex + BATCH_SIZE, entries.length);
    const batch = entries.slice(startIndex, endIndex);

    console.log(`\n📦 Processing batch ${Math.floor(startIndex/BATCH_SIZE) + 1}: entries ${startIndex + 1} to ${endIndex} of ${entries.length}`);

    let fixedInBatch = 0;
    const cache = await loadCache();

    for (let i = 0; i < batch.length; i++) {
        const entry = batch[i];
        const globalIndex = startIndex + i + 1;

        try {
            console.log(`  [${globalIndex}/${entries.length}] Checking: ${entry.address.substring(0, 50)}...`);

            const businessName = await getNearbyBusiness(entry.lat, entry.lng, apiKey);

            if (businessName && businessName !== entry.address) {
                console.log(`    ✅ Fixed: "${entry.address}" → "${businessName}"`);
                cache.set(entry.key, businessName);
                fixedInBatch++;
            } else {
                console.log(`    ⏭️  No business found (keeping street address)`);
            }

            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, DELAY_MS));

        } catch (error) {
            console.error(`    ❌ Error: ${error.message}`);
        }
    }

    // Save after each batch
    if (fixedInBatch > 0) {
        saveCache(cache);
        console.log(`✨ Batch complete: Fixed ${fixedInBatch} entries`);
    } else {
        console.log(`⏭️  Batch complete: No fixes needed`);
    }

    return fixedInBatch;
}

async function main() {
    // Load .env file
    require('dotenv').config({ path: path.join(__dirname, '../.env') });

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
        console.error('❌ Error: GOOGLE_MAPS_API_KEY not found in .env');
        process.exit(1);
    }

    console.log('🔧 Loading geocoding cache...');
    const cache = await loadCache();

    // Find all street addresses
    const entriesToFix = [];
    for (const [key, address] of cache.entries()) {
        if (isStreetAddress(address)) {
            const [lat, lng] = key.split(',').map(coord => parseFloat(coord));
            entriesToFix.push({ key, address, lat, lng });
        }
    }

    console.log(`\n📊 Analysis:`);
    console.log(`   Total cache entries: ${cache.size}`);
    console.log(`   Street addresses found: ${entriesToFix.length}`);
    console.log(`   Batch size: ${BATCH_SIZE}`);
    console.log(`   Total batches: ${Math.ceil(entriesToFix.length / BATCH_SIZE)}`);
    console.log(`   Estimated time: ~${Math.ceil(entriesToFix.length * DELAY_MS / 1000 / 60)} minutes\n`);

    if (entriesToFix.length === 0) {
        console.log('✅ No street addresses to fix!');
        return;
    }

    // Get batch number from command line argument (if resuming)
    const startBatch = process.argv[2] ? parseInt(process.argv[2]) : 0;
    const startIndex = startBatch * BATCH_SIZE;

    if (startIndex > 0) {
        console.log(`🔄 Resuming from batch ${startBatch + 1} (entry ${startIndex + 1})\n`);
    }

    let totalFixed = 0;
    const totalBatches = Math.ceil(entriesToFix.length / BATCH_SIZE);

    for (let batchNum = startBatch; batchNum < totalBatches; batchNum++) {
        const batchIndex = batchNum * BATCH_SIZE;
        const fixed = await processBatch(entriesToFix, batchIndex, apiKey);
        totalFixed += fixed;

        const progress = Math.round((batchIndex + BATCH_SIZE) / entriesToFix.length * 100);
        console.log(`\n📈 Progress: ${Math.min(progress, 100)}% | Fixed so far: ${totalFixed} | Batch ${batchNum + 1}/${totalBatches}`);
    }

    console.log(`\n🎉 Complete! Fixed ${totalFixed} street address entries with business names`);
    console.log(`📝 Restart the server to load the updated cache`);
}

main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});
