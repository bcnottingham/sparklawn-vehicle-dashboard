import { getDatabase } from '../db/index';

export class StorageCleanupService {
    private cleanupInterval: NodeJS.Timeout | null = null;
    private readonly CLEANUP_INTERVAL_HOURS = 6; // Run cleanup every 6 hours
    private readonly MAX_STORAGE_MB = 400; // Keep well under 512MB quota
    private readonly TELEMATICS_RETENTION_DAYS = 7;
    private readonly ROUTE_POINTS_RETENTION_DAYS = 7;
    private readonly STATE_HISTORY_RETENTION_HOURS = 24;

    async startAutomaticCleanup(): Promise<void> {
        console.log('🧹 Starting automatic storage cleanup service');

        // Run initial cleanup
        await this.performCleanup();

        // Schedule recurring cleanup
        this.cleanupInterval = setInterval(async () => {
            await this.performCleanup();
        }, this.CLEANUP_INTERVAL_HOURS * 60 * 60 * 1000);

        console.log(`✅ Automatic storage cleanup scheduled every ${this.CLEANUP_INTERVAL_HOURS} hours`);
    }

    async stopAutomaticCleanup(): Promise<void> {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
            console.log('🛑 Automatic storage cleanup stopped');
        }
    }

    async performCleanup(): Promise<void> {
        try {
            console.log('🧹 Starting automatic storage cleanup...');
            const db = await getDatabase();

            // Get current storage usage
            const storageInfo = await this.getStorageInfo();
            const currentSizeMB = storageInfo.totalSizeMB;

            console.log(`📊 Current storage: ${currentSizeMB.toFixed(2)} MB / 512 MB quota`);

            if (currentSizeMB > this.MAX_STORAGE_MB) {
                console.log(`⚠️ Storage above threshold (${this.MAX_STORAGE_MB} MB), performing cleanup...`);

                // Clean old telematics signals
                const telematicsCleanup = await this.cleanOldTelematicsSignals();
                console.log(`🗑️ Cleaned ${telematicsCleanup.deletedCount} old telematics signals`);

                // Clean old route points
                const routeCleanup = await this.cleanOldRoutePoints();
                console.log(`🗑️ Cleaned ${routeCleanup.deletedCount} old route points`);

                // Clean old vehicle state history
                const stateCleanup = await this.cleanOldVehicleStateHistory();
                console.log(`🗑️ Cleaned ${stateCleanup.deletedCount} old vehicle state history records`);

                // Get updated storage info
                const newStorageInfo = await this.getStorageInfo();
                const freedMB = currentSizeMB - newStorageInfo.totalSizeMB;

                console.log(`✅ Cleanup complete: Freed ${freedMB.toFixed(2)} MB`);
                console.log(`📊 New storage: ${newStorageInfo.totalSizeMB.toFixed(2)} MB / 512 MB quota`);
            } else {
                console.log(`✅ Storage usage normal (${currentSizeMB.toFixed(2)} MB), no cleanup needed`);
            }

        } catch (error) {
            console.error('❌ Storage cleanup failed:', error);
        }
    }

    private async getStorageInfo(): Promise<{ totalSizeMB: number; collections: Array<{ name: string; sizeMB: number; count: number }> }> {
        const db = await getDatabase();
        const collections = await db.listCollections().toArray();
        let totalSize = 0;
        const collectionInfo = [];

        for (const collection of collections) {
            try {
                const stats = await db.command({ collStats: collection.name });
                const sizeInMB = stats.size / 1024 / 1024;
                totalSize += stats.size;
                collectionInfo.push({
                    name: collection.name,
                    sizeMB: sizeInMB,
                    count: stats.count
                });
            } catch (e) {
                // Skip collections that can't be analyzed
            }
        }

        return {
            totalSizeMB: totalSize / 1024 / 1024,
            collections: collectionInfo
        };
    }

    private async cleanOldTelematicsSignals(): Promise<{ deletedCount: number }> {
        const db = await getDatabase();
        const cutoffDate = new Date(Date.now() - this.TELEMATICS_RETENTION_DAYS * 24 * 60 * 60 * 1000);

        const result = await db.collection('telematics_signals').deleteMany({
            ts: { $lt: cutoffDate.toISOString() }
        });
        return { deletedCount: result.deletedCount || 0 };
    }

    private async cleanOldRoutePoints(): Promise<{ deletedCount: number }> {
        const db = await getDatabase();
        const cutoffDate = new Date(Date.now() - this.ROUTE_POINTS_RETENTION_DAYS * 24 * 60 * 60 * 1000);

        const result = await db.collection('route_points').deleteMany({
            timestamp: { $lt: cutoffDate }
        });
        return { deletedCount: result.deletedCount || 0 };
    }

    private async cleanOldVehicleStateHistory(): Promise<{ deletedCount: number }> {
        const db = await getDatabase();
        const cutoffDate = new Date(Date.now() - this.STATE_HISTORY_RETENTION_HOURS * 60 * 60 * 1000);

        const result = await db.collection('vehicle_state_history').deleteMany({
            timestamp: { $lt: cutoffDate }
        });
        return { deletedCount: result.deletedCount || 0 };
    }

    async forceCleanup(): Promise<void> {
        console.log('🚨 Force cleanup requested...');
        await this.performCleanup();
    }

    async getQuotaStatus(): Promise<{ usedMB: number; quotaMB: number; percentUsed: number; needsCleanup: boolean }> {
        const storageInfo = await this.getStorageInfo();
        const quotaMB = 512;
        const percentUsed = (storageInfo.totalSizeMB / quotaMB) * 100;

        return {
            usedMB: storageInfo.totalSizeMB,
            quotaMB,
            percentUsed,
            needsCleanup: storageInfo.totalSizeMB > this.MAX_STORAGE_MB
        };
    }
}

// Export singleton instance
export const storageCleanupService = new StorageCleanupService();