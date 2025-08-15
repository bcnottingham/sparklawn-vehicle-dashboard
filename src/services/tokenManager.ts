import { MongoClient, Db } from 'mongodb';

export interface TokenData {
    _id?: string;
    clientId: string;
    clientSecret: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    lastUpdated: Date;
}

export class TokenManager {
    private db: Db | null = null;
    private client: MongoClient | null = null;
    private readonly COLLECTION_NAME = 'smartcar_tokens';
    private refreshInterval: NodeJS.Timeout | null = null;

    constructor(private mongoUri: string = process.env.MONGODB_URI || 'mongodb://localhost:27017/sparklawn') {
    }

    async initialize(): Promise<void> {
        try {
            this.client = new MongoClient(this.mongoUri);
            await this.client.connect();
            this.db = this.client.db();
            
            console.log('✅ Token Manager connected to database');
            
            // Initialize tokens from environment variables if not in database
            await this.initializeTokensFromEnv();
            
            // Start automatic refresh schedule (every hour)
            this.startAutoRefresh();
            
        } catch (error) {
            console.error('❌ Token Manager failed to connect to database:', error);
            throw error;
        }
    }

    private async initializeTokensFromEnv(): Promise<void> {
        const existingTokens = await this.getStoredTokens();
        
        if (!existingTokens && process.env.SMARTCAR_CLIENT_ID) {
            const tokenData: TokenData = {
                clientId: process.env.SMARTCAR_CLIENT_ID,
                clientSecret: process.env.SMARTCAR_CLIENT_SECRET || '',
                accessToken: process.env.SMARTCAR_ACCESS_TOKEN || '',
                refreshToken: process.env.SMARTCAR_REFRESH_TOKEN || '',
                expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours from now
                lastUpdated: new Date()
            };
            
            await this.saveTokens(tokenData);
            console.log('🔑 Initialized tokens from environment variables');
        }
    }

    async getStoredTokens(): Promise<TokenData | null> {
        if (!this.db) return null;
        
        try {
            const collection = this.db.collection(this.COLLECTION_NAME);
            return await collection.findOne({}) as TokenData | null;
        } catch (error) {
            console.error('Error getting stored tokens:', error);
            return null;
        }
    }

    async saveTokens(tokenData: TokenData): Promise<void> {
        if (!this.db) throw new Error('Database not connected');
        
        try {
            const collection = this.db.collection(this.COLLECTION_NAME);
            await collection.replaceOne({}, tokenData, { upsert: true });
            console.log('💾 Tokens saved to database');
        } catch (error) {
            console.error('Error saving tokens:', error);
            throw error;
        }
    }

    async getCurrentTokens(): Promise<TokenData | null> {
        const tokens = await this.getStoredTokens();
        
        if (!tokens) {
            console.log('⚠️ No tokens found in database');
            return null;
        }

        // Check if tokens are expired
        if (tokens.expiresAt < new Date()) {
            console.log('🔄 Tokens expired, refreshing...');
            return await this.refreshTokens();
        }

        return tokens;
    }

    async refreshTokens(): Promise<TokenData | null> {
        const storedTokens = await this.getStoredTokens();
        
        if (!storedTokens) {
            console.error('❌ No tokens available to refresh');
            return null;
        }

        try {
            const auth = Buffer.from(`${storedTokens.clientId}:${storedTokens.clientSecret}`).toString('base64');
            
            const response = await fetch('https://auth.smartcar.com/oauth/token', {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: storedTokens.refreshToken
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
            }

            const tokenResponse = await response.json();
            
            const updatedTokens: TokenData = {
                clientId: storedTokens.clientId,
                clientSecret: storedTokens.clientSecret,
                accessToken: tokenResponse.access_token,
                refreshToken: tokenResponse.refresh_token || storedTokens.refreshToken,
                expiresAt: new Date(Date.now() + (tokenResponse.expires_in * 1000)),
                lastUpdated: new Date()
            };

            await this.saveTokens(updatedTokens);
            console.log('✅ Tokens refreshed successfully');
            
            return updatedTokens;
            
        } catch (error) {
            console.error('❌ Token refresh failed:', error);
            return null;
        }
    }

    private startAutoRefresh(): void {
        // Refresh tokens every 90 minutes (tokens expire in 2 hours)
        this.refreshInterval = setInterval(async () => {
            console.log('⏰ Auto-refreshing tokens...');
            await this.refreshTokens();
        }, 90 * 60 * 1000); // 90 minutes
        
        console.log('⏰ Auto-refresh scheduled every 90 minutes');
    }

    async close(): Promise<void> {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        
        if (this.client) {
            await this.client.close();
            console.log('🔌 Token Manager disconnected from database');
        }
    }
}

// Singleton instance
export const tokenManager = new TokenManager();