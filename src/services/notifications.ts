import { GeofenceEvent, GeofenceZone } from './geofencing';

export interface NotificationChannel {
    type: 'slack' | 'email' | 'webhook';
    config: any;
}

export interface SlackConfig {
    webhookUrl: string;
    channel?: string;
    username?: string;
    iconEmoji?: string;
}

export class NotificationService {
    private channels: NotificationChannel[] = [];

    constructor() {
        this.initializeChannels();
    }

    private initializeChannels(): void {
        // Initialize Slack webhook if configured
        if (process.env.SLACK_WEBHOOK_URL) {
            this.channels.push({
                type: 'slack',
                config: {
                    webhookUrl: process.env.SLACK_WEBHOOK_URL,
                    channel: process.env.SLACK_CHANNEL || '#fleet-alerts',
                    username: 'SparkLawn Fleet Bot',
                    iconEmoji: ':truck:'
                }
            });
        }
    }

    async sendGeofenceAlert(event: GeofenceEvent, zone: GeofenceZone): Promise<void> {
        const message = this.formatGeofenceMessage(event, zone);
        
        for (const channel of this.channels) {
            try {
                switch (channel.type) {
                    case 'slack':
                        await this.sendSlackMessage(message, channel.config);
                        break;
                    case 'email':
                        await this.sendEmailNotification(message, channel.config);
                        break;
                    case 'webhook':
                        await this.sendWebhookNotification(event, zone, channel.config);
                        break;
                }
            } catch (error) {
                console.error(`Failed to send notification via ${channel.type}:`, error);
            }
        }
    }

    private formatGeofenceMessage(event: GeofenceEvent, zone: GeofenceZone): any {
        const emoji = this.getZoneEmoji(zone.type);
        const action = event.eventType === 'ENTER' ? 'arrived at' : 'left';
        const color = event.eventType === 'ENTER' ? 'good' : '#439FE0';
        
        let title = `🚛 ${event.vehicleName} ${action} ${zone.name}`;
        let details = `Location: ${zone.address}`;
        
        if (event.eventType === 'EXIT' && event.duration) {
            details += `\nTime spent: ${event.duration} minutes`;
        }

        // Add context based on zone type
        if (zone.type === 'customer' && zone.clientInfo) {
            details += `\nClient: ${zone.clientInfo.name}`;
        } else if (zone.type === 'supplier') {
            details += `\nSupplier run`;
        } else if (zone.type === 'shop') {
            details += event.eventType === 'ENTER' ? '\nReturned to base' : '\nDeparted for jobs';
        }

        return {
            text: title,
            attachments: [
                {
                    color: color,
                    fields: [
                        {
                            title: 'Details',
                            value: details,
                            short: false
                        },
                        {
                            title: 'Time',
                            value: event.timestamp.toLocaleString(),
                            short: true
                        },
                        {
                            title: 'Coordinates',
                            value: `${event.location.latitude.toFixed(6)}, ${event.location.longitude.toFixed(6)}`,
                            short: true
                        }
                    ],
                    footer: 'SparkLawn Fleet Tracker',
                    footer_icon: 'https://cdn-icons-png.flaticon.com/512/3448/3448339.png'
                }
            ]
        };
    }

    private getZoneEmoji(zoneType: string): string {
        switch (zoneType) {
            case 'customer': return '🏠';
            case 'supplier': return '🏪';
            case 'shop': return '🏢';
            default: return '📍';
        }
    }

    private async sendSlackMessage(message: any, config: SlackConfig): Promise<void> {
        const payload = {
            channel: config.channel,
            username: config.username,
            icon_emoji: config.iconEmoji,
            ...message
        };

        const response = await fetch(config.webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Slack webhook failed: ${response.statusText}`);
        }
    }

    private async sendEmailNotification(message: any, config: any): Promise<void> {
        // Email implementation would go here
        // Could use SendGrid, AWS SES, or nodemailer
        console.log('Email notification:', message);
    }

    private async sendWebhookNotification(event: GeofenceEvent, zone: GeofenceZone, config: any): Promise<void> {
        const payload = {
            event,
            zone,
            timestamp: new Date().toISOString()
        };

        const response = await fetch(config.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...config.headers
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Webhook failed: ${response.statusText}`);
        }
    }

    async sendCustomAlert(title: string, message: string, color: string = 'warning'): Promise<void> {
        const slackMessage = {
            text: title,
            attachments: [
                {
                    color: color,
                    text: message,
                    footer: 'SparkLawn Fleet Tracker',
                    footer_icon: 'https://cdn-icons-png.flaticon.com/512/3448/3448339.png'
                }
            ]
        };

        for (const channel of this.channels) {
            if (channel.type === 'slack') {
                await this.sendSlackMessage(slackMessage, channel.config);
            }
        }
    }

    async sendDailyFleetSummary(summary: any): Promise<void> {
        const message = {
            text: '📊 Daily Fleet Summary',
            attachments: [
                {
                    color: 'good',
                    fields: [
                        {
                            title: 'Total Vehicle Hours',
                            value: `${summary.totalHours} hours`,
                            short: true
                        },
                        {
                            title: 'Customer Visits',
                            value: `${summary.customerVisits}`,
                            short: true
                        },
                        {
                            title: 'Supplier Runs',
                            value: `${summary.supplierRuns}`,
                            short: true
                        },
                        {
                            title: 'Miles Driven',
                            value: `${summary.totalMiles} miles`,
                            short: true
                        }
                    ],
                    footer: 'SparkLawn Fleet Tracker - Daily Report',
                    footer_icon: 'https://cdn-icons-png.flaticon.com/512/3448/3448339.png'
                }
            ]
        };

        for (const channel of this.channels) {
            if (channel.type === 'slack') {
                await this.sendSlackMessage(message, channel.config);
            }
        }
    }
}

export const notificationService = new NotificationService();