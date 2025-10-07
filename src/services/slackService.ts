import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import { WebClient } from '@slack/web-api';
import FormData from 'form-data';

export interface SlackMessageOptions {
    text: string;
    blocks?: any[];
    attachments?: any[];
}

export interface SlackFileUploadOptions {
    filename: string;
    filePath: string;
    title?: string;
    initialComment?: string;
}

class SlackService {
    private webhookUrl: string;
    private botToken: string;
    private channelId: string;

    constructor() {
        this.webhookUrl = process.env.SLACK_WEBHOOK_URL || '';
        this.botToken = process.env.SLACK_BOT_TOKEN || '';
        this.channelId = process.env.SLACK_CHANNEL_ID || 'daily-trips';
    }

    /**
     * Check if Slack integration is configured
     */
    isConfigured(): boolean {
        return !!this.webhookUrl && this.webhookUrl.startsWith('https://hooks.slack.com/');
    }

    /**
     * Check if bot token is configured for file uploads
     */
    canUploadFiles(): boolean {
        return !!this.botToken && (this.botToken.startsWith('xoxb-') || this.botToken.startsWith('xoxp-'));
    }

    /**
     * Send a simple text message to Slack
     */
    async sendMessage(text: string): Promise<boolean> {
        if (!this.isConfigured()) {
            console.warn('⚠️ Slack webhook not configured. Set SLACK_WEBHOOK_URL environment variable.');
            return false;
        }

        return this.sendWebhook({ text });
    }

    /**
     * Send a formatted message with blocks (rich formatting)
     */
    async sendFormattedMessage(options: SlackMessageOptions): Promise<boolean> {
        if (!this.isConfigured()) {
            console.warn('⚠️ Slack webhook not configured. Set SLACK_WEBHOOK_URL environment variable.');
            return false;
        }

        return this.sendWebhook(options);
    }

    /**
     * Send daily fleet report to Slack
     */
    async sendDailyFleetReport(reportData: {
        date: string;
        totalTrips: number;
        totalDistance: number;
        totalDuration: number;
        vehicles: Array<{
            name: string;
            trips: number;
            distance: number;
            duration: number;
        }>;
        pdfPath?: string;
    }): Promise<boolean> {
        const safeNumber = (value: number): number => {
            if (!isFinite(value) || isNaN(value)) return 0;
            return value;
        };

        const formatDistance = (meters: number): string => {
            const miles = safeNumber(meters / 1609.34);
            return `${miles.toFixed(1)} mi`;
        };

        const formatDuration = (seconds: number): string => {
            const safeSeconds = safeNumber(seconds);
            const hours = Math.floor(safeSeconds / 3600);
            const minutes = Math.floor((safeSeconds % 3600) / 60);
            return `${hours}h ${minutes}m`;
        };

        // Build simple text message with PDF link
        const vehicleSummary = reportData.vehicles
            .map(v => `  • ${v.name}: ${v.trips} trips, ${formatDistance(v.distance)}, ${formatDuration(v.duration)}`)
            .join('\n');

        let messageText = `📊 *Daily Fleet Report - ${reportData.date}*\n\n` +
            `*Fleet Summary:*\n` +
            `Total Trips: ${reportData.totalTrips}\n` +
            `Total Distance: ${formatDistance(reportData.totalDistance)}\n` +
            `Total Duration: ${formatDuration(reportData.totalDuration)}\n` +
            `Active Vehicles: ${reportData.vehicles.length}\n\n` +
            `*Vehicle Breakdown:*\n${vehicleSummary}\n\n`;

        if (reportData.pdfPath) {
            messageText += `📄 *Download PDF Report:* ${reportData.pdfPath}\n\n`;
        }

        messageText += `📱 View online: http://localhost:3002/daily-report-preview`;

        const message: SlackMessageOptions = {
            text: messageText
        };

        return this.sendFormattedMessage(message);
    }

    /**
     * Send trip alert to Slack
     */
    async sendTripAlert(tripData: {
        vehicleName: string;
        tripType: 'started' | 'ended';
        location?: string;
        distance?: number;
        duration?: number;
        timestamp: string;
    }): Promise<boolean> {
        const emoji = tripData.tripType === 'started' ? '🚗' : '🏁';
        const action = tripData.tripType === 'started' ? 'started' : 'completed';

        let text = `${emoji} *${tripData.vehicleName}* ${action} a trip`;

        if (tripData.location) {
            text += `\n📍 Location: ${tripData.location}`;
        }

        if (tripData.distance && tripData.tripType === 'ended') {
            text += `\n📏 Distance: ${(tripData.distance / 1609.34).toFixed(1)} mi`;
        }

        if (tripData.duration && tripData.tripType === 'ended') {
            const hours = Math.floor(tripData.duration / 3600);
            const minutes = Math.floor((tripData.duration % 3600) / 60);
            text += `\n⏱️ Duration: ${hours}h ${minutes}m`;
        }

        text += `\n🕐 ${new Date(tripData.timestamp).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        })}`;

        return this.sendMessage(text);
    }

    /**
     * Internal method to send webhook requests
     */
    private async sendWebhook(payload: any): Promise<boolean> {
        return new Promise((resolve, reject) => {
            console.log('📤 Sending Slack payload:', JSON.stringify(payload, null, 2).substring(0, 500));
            const data = JSON.stringify(payload);

            const url = new URL(this.webhookUrl);
            const options = {
                hostname: url.hostname,
                port: 443,
                path: url.pathname + url.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': data.length
                }
            };

            const req = https.request(options, (res) => {
                let responseData = '';

                res.on('data', (chunk) => {
                    responseData += chunk;
                });

                res.on('end', () => {
                    if (res.statusCode === 200) {
                        console.log('✅ Message sent to Slack successfully');
                        resolve(true);
                    } else {
                        console.error(`❌ Slack webhook failed: ${res.statusCode} - ${responseData}`);
                        resolve(false);
                    }
                });
            });

            req.on('error', (error) => {
                console.error('❌ Error sending Slack webhook:', error);
                reject(error);
            });

            req.write(data);
            req.end();
        });
    }

    /**
     * Upload a file to Slack using the official SDK
     */
    async uploadFile(filePath: string, initialComment?: string, title?: string): Promise<boolean> {
        if (!this.canUploadFiles()) {
            console.warn('⚠️ Slack bot token not configured. Cannot upload files.');
            return false;
        }

        try {
            const client = new WebClient(this.botToken);
            const fileName = title || path.basename(filePath);

            console.log(`📤 Uploading file to Slack channel ${this.channelId}...`);

            const result = await client.files.uploadV2({
                channel_id: this.channelId,
                file: fs.createReadStream(filePath),
                filename: fileName,
                initial_comment: initialComment,
            });

            if (result.ok) {
                console.log('✅ File uploaded to Slack successfully');
                return true;
            } else {
                console.error(`❌ Slack file upload failed:`, result);
                return false;
            }
        } catch (error) {
            console.error('❌ Error uploading file to Slack:', error);
            return false;
        }
    }

    private async getUploadUrl(filename: string, length: number): Promise<any> {
        return new Promise((resolve, reject) => {
            const payload = {
                filename: filename,
                length: length
            };
            const data = JSON.stringify(payload);
            console.log('📤 Sending getUploadUrl request:', payload);

            const options = {
                hostname: 'slack.com',
                port: 443,
                path: '/api/files.getUploadURLExternal',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.botToken}`
                }
            };

            const req = https.request(options, (res) => {
                let responseData = '';
                res.on('data', (chunk) => { responseData += chunk; });
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(responseData);
                        console.log('📤 Slack getUploadUrl response:', JSON.stringify(parsed, null, 2));
                        resolve(parsed);
                    } catch (error) {
                        console.error('❌ Failed to parse Slack response:', responseData);
                        reject(error);
                    }
                });
            });

            req.on('error', reject);
            req.write(data);
            req.end();
        });
    }

    private async uploadToUrl(uploadUrl: string, fileContent: Buffer): Promise<void> {
        return new Promise((resolve, reject) => {
            const url = new URL(uploadUrl);
            const options = {
                hostname: url.hostname,
                port: 443,
                path: url.pathname + url.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/pdf',
                    'Content-Length': fileContent.length
                }
            };

            const req = https.request(options, (res) => {
                if (res.statusCode === 200) {
                    resolve();
                } else {
                    reject(new Error(`Upload failed with status ${res.statusCode}`));
                }
            });

            req.on('error', reject);
            req.write(fileContent);
            req.end();
        });
    }

    private async completeUpload(fileId: string, title: string, initialComment?: string): Promise<any> {
        return new Promise((resolve, reject) => {
            const payload: any = {
                files: [{ id: fileId, title: title }],
                channel_id: this.channelId
            };

            if (initialComment) {
                payload.initial_comment = initialComment;
            }

            const data = JSON.stringify(payload);

            const options = {
                hostname: 'slack.com',
                port: 443,
                path: '/api/files.completeUploadExternal',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.botToken}`
                }
            };

            const req = https.request(options, (res) => {
                let responseData = '';
                res.on('data', (chunk) => { responseData += chunk; });
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(responseData));
                    } catch (error) {
                        reject(error);
                    }
                });
            });

            req.on('error', reject);
            req.write(data);
            req.end();
        });
    }

    /**
     * Send test message to verify Slack integration
     */
    async sendTestMessage(): Promise<boolean> {
        return this.sendFormattedMessage({
            text: '✅ Slack Integration Test',
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: '✅ *Slack Integration Test*\n\nYour SparkLawn Fleet Dashboard is now connected to Slack!'
                    }
                },
                {
                    type: 'context',
                    elements: [
                        {
                            type: 'mrkdwn',
                            text: `Test sent at ${new Date().toLocaleString()}`
                        }
                    ]
                }
            ]
        });
    }
}

export const slackService = new SlackService();
