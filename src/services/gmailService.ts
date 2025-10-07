import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

/**
 * Gmail Service for accessing inbox and downloading attachments
 * Uses OAuth2 credentials stored after authentication
 */
export class GmailService {
  private oauth2Client: any;
  private readonly TOKEN_PATH = path.join(__dirname, '../../gmail-token.json');
  private readonly SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.modify'
  ];

  constructor() {
    this.initializeClient();
  }

  /**
   * Initialize OAuth2 client
   */
  private initializeClient() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = 'http://localhost:3002/gmail-auth/callback';

    if (!clientId || !clientSecret) {
      console.warn('⚠️ Gmail API not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET');
      return;
    }

    this.oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri
    );

    // Load saved token if exists
    if (fs.existsSync(this.TOKEN_PATH)) {
      const token = JSON.parse(fs.readFileSync(this.TOKEN_PATH, 'utf8'));
      this.oauth2Client.setCredentials(token);
      console.log('✅ Gmail API token loaded');
    } else {
      console.warn('⚠️ No Gmail token found. Run Gmail authorization first.');
    }
  }

  /**
   * Get authorization URL for Gmail access
   */
  getAuthUrl(): string {
    if (!this.oauth2Client) {
      throw new Error('OAuth2 client not initialized');
    }

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: this.SCOPES,
      prompt: 'consent' // Force consent to get refresh token
    });
  }

  /**
   * Save token after OAuth authorization
   */
  async saveToken(code: string): Promise<void> {
    if (!this.oauth2Client) {
      throw new Error('OAuth2 client not initialized');
    }

    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);

    // Save token to file
    fs.writeFileSync(this.TOKEN_PATH, JSON.stringify(tokens, null, 2));
    console.log('✅ Gmail token saved to', this.TOKEN_PATH);
  }

  /**
   * Get Gmail client
   */
  async getGmailClient() {
    if (!this.oauth2Client) {
      throw new Error('OAuth2 client not initialized');
    }

    // Check if token exists
    if (!this.oauth2Client.credentials || !this.oauth2Client.credentials.access_token) {
      throw new Error('No valid Gmail token. Please authorize Gmail access first.');
    }

    // Refresh token if expired
    if (this.oauth2Client.credentials.expiry_date &&
        this.oauth2Client.credentials.expiry_date < Date.now()) {
      console.log('🔄 Refreshing Gmail token...');
      try {
        const { credentials } = await this.oauth2Client.refreshAccessToken();
        this.oauth2Client.setCredentials(credentials);
        fs.writeFileSync(this.TOKEN_PATH, JSON.stringify(credentials, null, 2));
        console.log('✅ Gmail token refreshed');
      } catch (error) {
        console.error('❌ Failed to refresh Gmail token:', error);
        throw new Error('Gmail token expired. Please reauthorize Gmail access.');
      }
    }

    return google.gmail({ version: 'v1', auth: this.oauth2Client });
  }

  /**
   * Check if Gmail is authorized
   */
  isAuthorized(): boolean {
    return !!(this.oauth2Client &&
              this.oauth2Client.credentials &&
              this.oauth2Client.credentials.access_token);
  }

  /**
   * Get token info
   */
  getTokenInfo(): any {
    if (!fs.existsSync(this.TOKEN_PATH)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(this.TOKEN_PATH, 'utf8'));
  }
}

export const gmailService = new GmailService();
export default gmailService;
