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
        // Only send notifications for meaningful events
        // ARRIVED/DEPARTED for customer sites, ENTER/EXIT for HQ and suppliers
        const shouldNotify = (
            (event.eventType === 'ARRIVED' || event.eventType === 'DEPARTED') && zone.type === 'customer'
        ) || (
            (event.eventType === 'ENTER' || event.eventType === 'EXIT') && (zone.type === 'shop' || zone.type === 'supplier')
        );
        
        if (!shouldNotify) {
            console.log(`Skipping notification for ${event.eventType} at ${zone.type} zone: ${zone.name}`);
            return;
        }
        
        const message = this.formatGeofenceMessage(event, zone);
        
        for (const channel of this.channels) {
            try {
                switch (channel.type) {
                    case 'slack':
                        await this.sendSlackMessage(message, channel.config);
                        console.log(`✅ Sent ${event.eventType} notification to Slack for ${event.vehicleName} at ${zone.name}`);
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
        let title: string;
        let color: string;
        let details = `Location: ${zone.address}`;
        
        switch (event.eventType) {
            case 'ARRIVED':
                title = `🎯 ${event.vehicleName} arrived and parked at ${zone.name}`;
                color = 'good';
                details += '\n🚗 Vehicle stopped - work likely started';
                break;
                
            case 'DEPARTED':
                title = `✅ ${event.vehicleName} finished work at ${zone.name}`;
                color = '#36a64f';
                if (event.workDuration) {
                    const hours = Math.floor(event.workDuration / 60);
                    const minutes = event.workDuration % 60;
                    const timeStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes} minutes`;
                    details += `\n⏱️ Work time: ${timeStr}`;
                }
                details += '\n🚛 Vehicle moving again';
                break;
                
            case 'ENTER':
                title = `📍 ${event.vehicleName} entered ${zone.name}`;
                color = '#439FE0';
                details += '\n👀 Monitoring for parking...';
                break;
                
            case 'EXIT':
                title = `🚪 ${event.vehicleName} left ${zone.name}`;
                color = '#ff9900';
                if (event.duration) {
                    details += `\nTotal time in zone: ${event.duration} minutes`;
                }
                break;
        }

        // Add context based on zone type
        if (zone.type === 'customer' && zone.clientInfo) {
            details += `\n👤 Client: ${zone.clientInfo.name}`;
        } else if (zone.type === 'supplier') {
            details += `\n🏪 Supplier visit`;
        } else if (zone.type === 'shop') {
            details += event.eventType === 'ENTER' ? '\n🏢 Returned to HQ' : '\n🏢 Left HQ for jobs';
        }
        
        // Add profitability context for work sessions
        if (event.eventType === 'DEPARTED' && event.workDuration && zone.type === 'customer') {
            const efficiency = event.workDuration >= 30 ? '💚 Good session' : 
                             event.workDuration >= 15 ? '🟡 Short session' : '🔴 Very short session';
            details += `\n${efficiency}`;
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
                    footer: 'SparkLawn Fleet Tracker - Job Site Monitoring',
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