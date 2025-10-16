import { MongoClient, Db } from 'mongodb';

interface RetryOptions {
    maxRetries: number;
    baseDelay: number;
    maxDelay: number;
    backoffFactor: number;
}

class MongoDBConnection {
    private client: MongoClient | null = null;
    private db: Db | null = null;
    private isConnecting = false;
    private connectionAttempts = 0;
    private lastConnectionAttempt = 0;
    private healthStatus: 'healthy' | 'degraded' | 'unhealthy' = 'unhealthy';

    private readonly retryOptions: RetryOptions = {
        maxRetries: 10,
        baseDelay: 1000,
        maxDelay: 60000,
        backoffFactor: 2
    };

    private getConnectionString(): string {
        const uri = process.env.MONGODB_URI;
        if (!uri) {
            throw new Error('MONGODB_URI environment variable is required');
        }
        return uri;
    }

    private calculateDelay(attempt: number): number {
        const delay = Math.min(
            this.retryOptions.baseDelay * Math.pow(this.retryOptions.backoffFactor, attempt),
            this.retryOptions.maxDelay
        );
        // Add jitter to prevent thundering herd
        return delay + Math.random() * 1000;
    }

    private async sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private async attemptConnection(): Promise<MongoClient> {
        const uri = this.getConnectionString();
        
        const client = new MongoClient(uri, {
            // Connection Pool Configuration - Reduced to prevent exhaustion
            maxPoolSize: 5,        // Reduced from 10 to 5
            minPoolSize: 2,        // Reduced from 5 to 2
            maxIdleTimeMS: 60000,  // Increased from 30s to 60s to keep connections alive longer

            // Timeout Configuration - Increased for Atlas Cloud
            serverSelectionTimeoutMS: 30000,  // Increased from 10s to 30s
            socketTimeoutMS: 60000,           // Increased from 45s to 60s
            connectTimeoutMS: 30000,          // Increased from 10s to 30s

            // Monitoring Configuration
            heartbeatFrequencyMS: 10000,

            // TLS/SSL Configuration for MongoDB Atlas (updated for modern driver)
            tls: true,
            tlsAllowInvalidCertificates: false
        });

        await client.connect();
        
        // Verify connection with ping
        await client.db('admin').command({ ping: 1 });
        
        return client;
    }

    async connect(): Promise<void> {
        if (this.client && this.db && this.healthStatus === 'healthy') {
            return;
        }

        if (this.isConnecting) {
            // Wait for ongoing connection attempt
            while (this.isConnecting) {
                await this.sleep(100);
            }
            if (this.client && this.db && this.healthStatus === 'healthy') {
                return;
            }
        }

        this.isConnecting = true;
        this.lastConnectionAttempt = Date.now();

        try {
            for (let attempt = 0; attempt <= this.retryOptions.maxRetries; attempt++) {
                try {
                    this.connectionAttempts++;
                    console.log(`🔄 MongoDB connection attempt ${attempt + 1}/${this.retryOptions.maxRetries + 1}`);
                    
                    const client = await this.attemptConnection();
                    
                    this.client = client;
                    this.db = client.db('sparklawn_fleet');
                    this.healthStatus = 'healthy';
                    
                    // Enhanced event listeners for connection monitoring
                    this.client.on('serverHeartbeatFailed', (event) => {
                        console.warn('⚠️ MongoDB heartbeat failed:', {
                            connectionId: event.connectionId,
                            failure: event.failure?.message || 'Unknown failure'
                        });
                        this.healthStatus = 'degraded';
                    });

                    this.client.on('serverHeartbeatSucceeded', (event) => {
                        if (this.healthStatus === 'degraded') {
                            console.log('✅ MongoDB heartbeat recovered:', {
                                connectionId: event.connectionId,
                                duration: event.duration
                            });
                            this.healthStatus = 'healthy';
                        }
                    });

                    this.client.on('close', () => {
                        console.warn('⚠️ MongoDB connection closed - initiating reconnection');
                        this.healthStatus = 'unhealthy';
                        this.client = null;
                        this.db = null;

                        // Automatic reconnection attempt after brief delay
                        setTimeout(() => {
                            if (this.healthStatus === 'unhealthy') {
                                console.log('🔄 Attempting automatic reconnection...');
                                this.connect().catch(error => {
                                    console.error('🚨 Automatic reconnection failed:', error.message);
                                });
                            }
                        }, 5000);
                    });

                    // Additional error event handlers
                    this.client.on('error', (error) => {
                        console.error('🚨 MongoDB client error:', error.message);
                        this.healthStatus = 'degraded';
                    });

                    this.client.on('timeout', (event: any) => {
                        console.warn('⏰ MongoDB operation timeout:', {
                            connectionId: event.connectionId,
                            operation: 'timeout'
                        });
                        this.healthStatus = 'degraded';
                    });

                    this.client.on('serverOpening', (event) => {
                        console.log('🔗 MongoDB server connection opening:', {
                            address: event.address,
                            topologyId: event.topologyId
                        });
                    });

                    this.client.on('serverClosed', (event) => {
                        console.warn('🔒 MongoDB server connection closed:', {
                            address: event.address,
                            topologyId: event.topologyId
                        });
                    });
                    
                    console.log('✅ MongoDB Atlas connected successfully');
                    console.log(`   Database: sparklawn_fleet`);
                    console.log(`   Total attempts: ${this.connectionAttempts}`);
                    return;
                    
                } catch (error: any) {
                    console.error(`❌ MongoDB connection attempt ${attempt + 1} failed:`, error.message);
                    
                    if (attempt < this.retryOptions.maxRetries) {
                        const delay = this.calculateDelay(attempt);
                        console.log(`⏳ Retrying in ${Math.round(delay / 1000)}s...`);
                        await this.sleep(delay);
                    }
                }
            }
            
            throw new Error(`Failed to connect to MongoDB after ${this.retryOptions.maxRetries + 1} attempts`);
            
        } finally {
            this.isConnecting = false;
        }
    }

    async getDatabase(): Promise<Db> {
        await this.connect();
        if (!this.db) {
            throw new Error('Database connection not available');
        }
        return this.db;
    }

    async getClient(): Promise<MongoClient> {
        await this.connect();
        if (!this.client) {
            throw new Error('MongoDB client not available');
        }
        return this.client;
    }

    getHealth(): string {
        return this.healthStatus;
    }

    getConnectionStats() {
        return {
            connected: !!(this.client && this.healthStatus === 'healthy'),
            attempts: this.connectionAttempts,
            lastAttempt: this.lastConnectionAttempt,
            status: this.healthStatus,
            uptime: this.lastConnectionAttempt ? Date.now() - this.lastConnectionAttempt : 0
        };
    }

    // Proactive connection health check with auto-recovery
    async performHealthCheck(): Promise<boolean> {
        try {
            if (!this.client || this.healthStatus !== 'healthy') {
                console.log('🔍 Health check: Connection unhealthy, attempting reconnection...');
                await this.connect();
                return true;
            }

            // Perform a lightweight ping to verify connection
            await this.client.db('admin').command({ ping: 1 });

            if (this.healthStatus !== 'healthy') {
                console.log('✅ Health check: Connection recovered');
                this.healthStatus = 'healthy';
            }

            return true;
        } catch (error: any) {
            console.error('🚨 Health check failed:', error.message);
            this.healthStatus = 'unhealthy';
            this.client = null;
            this.db = null;

            // Attempt immediate reconnection for critical services
            try {
                console.log('🔄 Health check: Attempting immediate recovery...');
                await this.connect();
                return true;
            } catch (recoveryError: any) {
                console.error('🚨 Health check recovery failed:', recoveryError.message);
                return false;
            }
        }
    }

    // Start periodic health checks
    startHealthChecking(intervalMs: number = 30000): void {
        setInterval(async () => {
            if (this.client) {
                await this.performHealthCheck();
            }
        }, intervalMs);
        console.log(`💚 MongoDB health checking started (every ${intervalMs / 1000}s)`);
    }

    async close(): Promise<void> {
        if (this.client) {
            await this.client.close();
            this.client = null;
            this.db = null;
            this.healthStatus = 'unhealthy';
            console.log('🔌 MongoDB connection closed');
        }
    }

    // Enhanced wrapper method for database operations with intelligent retry
    async withRetry<T>(operation: (db: Db) => Promise<T>): Promise<T> {
        let lastError: Error | null = null;
        const maxRetries = 5; // Increased from 3 for production resilience

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const db = await this.getDatabase();
                const result = await operation(db);

                // If we succeeded after failures, log recovery
                if (attempt > 0) {
                    console.log(`✅ Database operation succeeded after ${attempt} retries`);
                }

                return result;
            } catch (error: any) {
                lastError = error;
                const errorType = this.categorizeError(error);

                console.warn(`Database operation failed (attempt ${attempt + 1}/${maxRetries + 1}):`, {
                    error: error.message,
                    type: errorType,
                    code: error.code,
                    codeName: error.codeName
                });

                if (attempt < maxRetries) {
                    // Determine if we should reset connection based on error type
                    if (this.shouldResetConnection(error)) {
                        console.log('🔄 Resetting connection due to network error...');
                        this.healthStatus = 'unhealthy';
                        this.client = null;
                        this.db = null;
                    }

                    // Calculate retry delay with exponential backoff
                    const baseDelay = 1000;
                    const jitter = Math.random() * 500; // Add jitter to prevent thundering herd
                    const delay = (baseDelay * Math.pow(2, attempt)) + jitter;

                    console.log(`⏳ Retrying database operation in ${Math.round(delay)}ms...`);
                    await this.sleep(delay);
                } else {
                    console.error(`🚨 Database operation failed permanently after ${maxRetries + 1} attempts`);
                }
            }
        }

        throw lastError || new Error('Operation failed after all retries');
    }

    // Categorize errors to determine appropriate retry strategy
    private categorizeError(error: any): string {
        const message = error.message?.toLowerCase() || '';
        const code = error.code;

        // Network-related errors
        if (message.includes('econnreset') ||
            message.includes('enotfound') ||
            message.includes('econnrefused') ||
            message.includes('network') ||
            message.includes('timeout')) {
            return 'network';
        }

        // MongoDB server errors
        if (message.includes('topology') ||
            message.includes('no primary') ||
            message.includes('server selection') ||
            code === 11000) { // Duplicate key error
            return 'server';
        }

        // Authentication errors
        if (message.includes('authentication') ||
            message.includes('unauthorized') ||
            code === 18) {
            return 'auth';
        }

        return 'unknown';
    }

    // Determine if connection should be reset based on error type
    private shouldResetConnection(error: any): boolean {
        const errorType = this.categorizeError(error);
        const message = error.message?.toLowerCase() || '';

        return errorType === 'network' ||
               errorType === 'server' ||
               message.includes('connection') ||
               message.includes('topology') ||
               message.includes('econnreset');
    }
}

// Singleton instance
const mongoConnection = new MongoDBConnection();

// Legacy compatibility exports
export const connectToDatabase = async (): Promise<Db> => {
    return mongoConnection.getDatabase();
};

export const getDatabase = async (): Promise<Db> => {
    return mongoConnection.getDatabase();
};

export const getClient = async (): Promise<MongoClient> => {
    return mongoConnection.getClient();
};

// Enhanced exports
export { mongoConnection };

// Utility functions
export const saveVehicleData = async (vehicleData: any) => {
    return mongoConnection.withRetry(async (db) => {
        const collection = db.collection('vehicles');
        return await collection.insertOne(vehicleData);
    });
};

export const saveTrip = async (tripData: any) => {
    return mongoConnection.withRetry(async (db) => {
        const collection = db.collection('trips');
        return await collection.insertOne(tripData);
    });
};

export const saveTripPoints = async (pointsData: any[]) => {
    return mongoConnection.withRetry(async (db) => {
        const collection = db.collection('trip_points');
        return await collection.insertMany(pointsData);
    });
};

// New collections for vehicle state architecture
export const saveTelematics = async (signalData: any) => {
    return mongoConnection.withRetry(async (db) => {
        const collection = db.collection('telematics_signals');
        return await collection.insertOne(signalData);
    });
};

export const getLatestSignal = async (vin: string) => {
    return mongoConnection.withRetry(async (db) => {
        const collection = db.collection('telematics_signals');
        return await collection.findOne({ vin }, { sort: { ts: -1 } });
    });
};

// Get latest signal from smart logger collections (critical, important, routine)
export const getLatestSmartSignal = async (vin: string) => {
    return mongoConnection.withRetry(async (db) => {
        // Check all smart logger collections in priority order
        const collections = [
            'telematics_signals_critical',
            'telematics_signals_important',
            'telematics_signals_routine'
        ];

        let latestSignal = null;
        let latestTimestamp = 0;

        for (const collectionName of collections) {
            const collection = db.collection(collectionName);
            const signal = await collection.findOne({ vin }, { sort: { ts: -1 } });

            if (signal && signal.ts) {
                const timestamp = new Date(signal.ts).getTime();
                if (timestamp > latestTimestamp) {
                    latestSignal = signal;
                    latestTimestamp = timestamp;
                }
            }
        }

        return latestSignal;
    });
};

export const getLatestSignals = async () => {
    return mongoConnection.withRetry(async (db) => {
        const collection = db.collection('telematics_signals');
        // Get latest signal per VIN using aggregation
        return await collection.aggregate([
            { $sort: { vin: 1, ts: -1 } },
            { $group: { _id: '$vin', latestSignal: { $first: '$$ROOT' } } },
            { $replaceRoot: { newRoot: '$latestSignal' } }
        ]).toArray();
    });
};

export const upsertVehicleState = async (stateData: any) => {
    return mongoConnection.withRetry(async (db) => {
        const collection = db.collection('vehicle_state');
        return await collection.replaceOne(
            { vin: stateData.vin },
            stateData,
            { upsert: true }
        );
    });
};

export const getVehicleState = async (vin: string) => {
    return mongoConnection.withRetry(async (db) => {
        const collection = db.collection('vehicle_state');
        return await collection.findOne({ vin });
    });
};

export const getAllVehicleStates = async () => {
    return mongoConnection.withRetry(async (db) => {
        const collection = db.collection('vehicle_states');
        return await collection.find({}).toArray();
    });
};

export const getGlobalLastUpdate = async () => {
    return mongoConnection.withRetry(async (db) => {
        const collection = db.collection('telematics_signals');
        const result = await collection.findOne({}, { sort: { ts: -1 } });
        return result;
    });
};

// Initialize connection on module load with enhanced error handling
mongoConnection.connect().then(async () => {
    // Initialize collections after connection
    try {
        const { initializeCollections } = await import('./init');
        await initializeCollections();
        console.log('✅ MongoDB collections initialized successfully');
    } catch (error: any) {
        console.error('⚠️ Failed to initialize collections:', error.message);
    }

    // Start proactive health monitoring
    mongoConnection.startHealthChecking(30000); // Check every 30 seconds

    console.log('🔧 MongoDB connection established with enhanced monitoring:');
    console.log('   ✅ Automatic reconnection enabled');
    console.log('   ✅ Intelligent retry logic active');
    console.log('   ✅ Network error recovery configured');
    console.log('   ✅ Health monitoring started');

}).catch(error => {
    console.error('🚨 Initial MongoDB connection failed:', error.message);
    console.log('🔄 Enhanced retry logic will handle reconnection automatically...');

    // Start health checking even if initial connection fails
    setTimeout(() => {
        mongoConnection.startHealthChecking(10000); // More frequent checks when initially disconnected
    }, 5000);
});