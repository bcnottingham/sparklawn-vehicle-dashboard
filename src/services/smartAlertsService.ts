import { MongoClient, Db, Collection } from 'mongodb';
import moment from 'moment-timezone';

export interface Alert {
    _id?: string;
    vehicleId: string;
    vehicleName: string;
    alertType: 'ignition_on' | 'ignition_off' | 'trip_start' | 'trip_end' | 'client_visit' | 'client_arrival' | 'client_departure' | 'supplier_stop' | 'long_idle' | 'unusual_activity';
    timestamp: Date;
    location: {
        latitude: number;
        longitude: number;
        address?: string;
        clientName?: string;
    };
    metadata: {
        tripId?: string;
        duration?: number; // minutes
        distance?: number; // miles
        batteryLevel?: number;
        batteryUsed?: number;
        previousLocation?: string;
        alertReason?: string;
    };
    priority: 'low' | 'medium' | 'high' | 'critical';
    isRead: boolean;
    createdAt: Date;
}

export interface AlertRule {
    alertType: string;
    enabled: boolean;
    conditions: any;
    notifications: {
        console: boolean;
        email?: boolean;
        slack?: boolean;
        webhook?: boolean;
    };
}

export class SmartAlertsService {
    private client!: MongoClient;
    private db!: Db;
    private alertsCollection!: Collection<Alert>;
    private rulesCollection!: Collection<AlertRule>;
    private isInitialized = false;

    // Default alert rules
    private defaultRules: AlertRule[] = [
        {
            alertType: 'ignition_on',
            enabled: true,
            conditions: { businessHoursOnly: false },
            notifications: { console: true }
        },
        {
            alertType: 'ignition_off',
            enabled: true,
            conditions: { businessHoursOnly: false },
            notifications: { console: true }
        },
        {
            alertType: 'trip_start',
            enabled: true,
            conditions: { minDistance: 0.1 }, // Only trips > 0.1 miles
            notifications: { console: true }
        },
        {
            alertType: 'trip_end',
            enabled: true,
            conditions: { minDuration: 2 }, // Only trips > 2 minutes
            notifications: { console: true }
        },
        {
            alertType: 'client_visit',
            enabled: true,
            conditions: { clientRadius: 200 }, // Within 200m of client
            notifications: { console: true }
        },
        {
            alertType: 'client_departure',
            enabled: true,
            conditions: { departureRadius: 500 }, // Left client area (>500m away)
            notifications: { console: true }
        },
        {
            alertType: 'client_arrival',
            enabled: true,
            conditions: { arrivalRadius: 200 }, // Arrived at client area (within 200m)
            notifications: { console: true }
        },
        {
            alertType: 'supplier_stop',
            enabled: true,
            conditions: { suppliers: ['Home Depot', 'Lowes', 'Garden City Nursery'] },
            notifications: { console: true }
        },
        {
            alertType: 'long_idle',
            enabled: false, // Disabled by default
            conditions: { maxIdleMinutes: 30 },
            notifications: { console: true }
        },
        {
            alertType: 'unusual_activity',
            enabled: true,
            conditions: { afterHours: true, weekends: false },
            notifications: { console: true }
        }
    ];

    async initialize(): Promise<void> {
        try {
            const mongoUri = process.env.MONGODB_URI;
            if (!mongoUri) {
                console.warn('⚠️ MONGODB_URI not configured - smart alerts service disabled');
                return;
            }

            this.client = new MongoClient(mongoUri);
            await this.client.connect();
            this.db = this.client.db();

            this.alertsCollection = this.db.collection<Alert>('smart_alerts');
            this.rulesCollection = this.db.collection<AlertRule>('alert_rules');

            // Create indexes
            await this.createIndexes();

            // Initialize default rules if none exist
            await this.initializeDefaultRules();

            this.isInitialized = true;
            console.log('✅ Smart alerts service initialized');
        } catch (error) {
            console.error('❌ Failed to initialize smart alerts service:', error);
            throw error;
        }
    }

    private async createIndexes(): Promise<void> {
        try {
            await this.alertsCollection.createIndex({ vehicleId: 1, timestamp: -1 });
            await this.alertsCollection.createIndex({ alertType: 1, timestamp: -1 });
            await this.alertsCollection.createIndex({ isRead: 1, timestamp: -1 });
            await this.alertsCollection.createIndex({ priority: 1, timestamp: -1 });
            await this.alertsCollection.createIndex({ timestamp: -1 });

            await this.rulesCollection.createIndex({ alertType: 1 }, { unique: true });

            console.log('✅ Smart alerts indexes created');
        } catch (error) {
            console.warn('⚠️ Failed to create smart alerts indexes:', error);
        }
    }

    private async initializeDefaultRules(): Promise<void> {
        try {
            const existingRules = await this.rulesCollection.countDocuments();
            if (existingRules === 0) {
                await this.rulesCollection.insertMany(this.defaultRules);
                console.log('✅ Default alert rules initialized');
            }
        } catch (error) {
            console.error('❌ Failed to initialize default rules:', error);
        }
    }

    // Alert generation methods
    async createIgnitionOnAlert(vehicleId: string, vehicleName: string, location: any, batteryLevel: number): Promise<void> {
        if (!this.isInitialized || !await this.isRuleEnabled('ignition_on')) return;

        const now = new Date();
        const centralTime = moment(now).tz('America/Chicago');
        
        // Check if this is unusual timing (after hours/weekends)
        const priority = this.determineIgnitionPriority(centralTime);
        
        const address = await this.getLocationName(location.latitude, location.longitude);

        const alert: Alert = {
            vehicleId,
            vehicleName,
            alertType: 'ignition_on',
            timestamp: now,
            location: {
                latitude: location.latitude,
                longitude: location.longitude,
                address
            },
            metadata: {
                batteryLevel,
                alertReason: this.getIgnitionOnReason(centralTime)
            },
            priority,
            isRead: false,
            createdAt: now
        };

        await this.saveAlert(alert);
        await this.notifyAlert(alert);
    }

    async createIgnitionOffAlert(vehicleId: string, vehicleName: string, location: any, batteryLevel: number, tripId?: string): Promise<void> {
        if (!this.isInitialized || !await this.isRuleEnabled('ignition_off')) return;

        const address = await this.getLocationName(location.latitude, location.longitude);
        const clientName = await this.getClientName(location.latitude, location.longitude);

        const alert: Alert = {
            vehicleId,
            vehicleName,
            alertType: 'ignition_off',
            timestamp: new Date(),
            location: {
                latitude: location.latitude,
                longitude: location.longitude,
                address,
                clientName
            },
            metadata: {
                batteryLevel,
                tripId
            },
            priority: 'low',
            isRead: false,
            createdAt: new Date()
        };

        await this.saveAlert(alert);
        await this.notifyAlert(alert);
    }

    async createTripStartAlert(vehicleId: string, vehicleName: string, tripId: string, location: any, batteryLevel: number): Promise<void> {
        if (!this.isInitialized || !await this.isRuleEnabled('trip_start')) return;

        // Check for minimum location change to prevent spam from stationary vehicles
        const lastAlert = await this.getLastAlert(vehicleId, 'trip_start');
        if (lastAlert) {
            const distance = this.calculateDistance(
                lastAlert.location.latitude,
                lastAlert.location.longitude,
                location.latitude,
                location.longitude
            );

            // Only create alert if vehicle moved more than 100 meters (0.06 miles) from last trip start
            if (distance < 0.06) {
                console.log(`🚫 Skipping trip_start alert for ${vehicleName} - insufficient movement (${(distance * 1609.34).toFixed(0)}m)`);
                return;
            }
        }

        const address = await this.getLocationName(location.latitude, location.longitude);
        const centralTime = moment().tz('America/Chicago');

        const alert: Alert = {
            vehicleId,
            vehicleName,
            alertType: 'trip_start',
            timestamp: new Date(),
            location: {
                latitude: location.latitude,
                longitude: location.longitude,
                address
            },
            metadata: {
                tripId,
                batteryLevel,
                alertReason: `Trip started at ${centralTime.format('h:mm A')}`
            },
            priority: 'medium',
            isRead: false,
            createdAt: new Date()
        };

        await this.saveAlert(alert);
        await this.notifyAlert(alert);
    }

    async createTripEndAlert(
        vehicleId: string, 
        vehicleName: string, 
        tripId: string, 
        location: any, 
        duration: number, 
        distance: number, 
        batteryUsed: number
    ): Promise<void> {
        if (!this.isInitialized || !await this.isRuleEnabled('trip_end')) return;

        const rules = await this.getRule('trip_end');
        if (rules?.conditions.minDuration && duration < rules.conditions.minDuration) return;

        const address = await this.getLocationName(location.latitude, location.longitude);
        const clientName = await this.getClientName(location.latitude, location.longitude);

        const alert: Alert = {
            vehicleId,
            vehicleName,
            alertType: 'trip_end',
            timestamp: new Date(),
            location: {
                latitude: location.latitude,
                longitude: location.longitude,
                address,
                clientName
            },
            metadata: {
                tripId,
                duration,
                distance,
                batteryUsed,
                alertReason: `${duration.toFixed(1)} min trip, ${distance.toFixed(1)} mi, ${batteryUsed.toFixed(1)}% battery`
            },
            priority: this.getTripEndPriority(duration, distance),
            isRead: false,
            createdAt: new Date()
        };

        await this.saveAlert(alert);
        await this.notifyAlert(alert);
    }

    async createClientVisitAlert(vehicleId: string, vehicleName: string, clientName: string, location: any): Promise<void> {
        if (!this.isInitialized || !await this.isRuleEnabled('client_visit')) return;

        const alert: Alert = {
            vehicleId,
            vehicleName,
            alertType: 'client_visit',
            timestamp: new Date(),
            location: {
                latitude: location.latitude,
                longitude: location.longitude,
                clientName,
                address: `Client: ${clientName}`
            },
            metadata: {
                alertReason: `Arrived at SparkLawn client location`
            },
            priority: 'high',
            isRead: false,
            createdAt: new Date()
        };

        await this.saveAlert(alert);
        await this.notifyAlert(alert);
    }

    async createClientDepartureAlert(vehicleId: string, vehicleName: string, clientName: string, location: any): Promise<void> {
        if (!this.isInitialized || !await this.isRuleEnabled('client_departure')) return;

        const alert: Alert = {
            vehicleId,
            vehicleName,
            alertType: 'client_departure',
            timestamp: new Date(),
            location: {
                latitude: location.latitude,
                longitude: location.longitude,
                address: `Left ${clientName}`
            },
            metadata: {
                alertReason: `Left ${clientName}`,
                previousLocation: clientName
            },
            priority: 'medium',
            isRead: false,
            createdAt: new Date()
        };

        await this.saveAlert(alert);
        await this.notifyAlert(alert);
    }

    async createClientArrivalAlert(vehicleId: string, vehicleName: string, clientName: string, location: any): Promise<void> {
        if (!this.isInitialized || !await this.isRuleEnabled('client_arrival')) return;

        const alert: Alert = {
            vehicleId,
            vehicleName,
            alertType: 'client_arrival',
            timestamp: new Date(),
            location: {
                latitude: location.latitude,
                longitude: location.longitude,
                address: `Arrived at ${clientName}`
            },
            metadata: {
                alertReason: `Arrived at ${clientName}`,
                previousLocation: clientName
            },
            priority: 'medium',
            isRead: false,
            createdAt: new Date()
        };

        await this.saveAlert(alert);
        await this.notifyAlert(alert);
    }

    async createSupplierStopAlert(vehicleId: string, vehicleName: string, supplierName: string, location: any): Promise<void> {
        if (!this.isInitialized || !await this.isRuleEnabled('supplier_stop')) return;

        const rules = await this.getRule('supplier_stop');
        if (rules?.conditions.suppliers && !rules.conditions.suppliers.some((s: string) => 
            supplierName.toLowerCase().includes(s.toLowerCase()))) return;

        const alert: Alert = {
            vehicleId,
            vehicleName,
            alertType: 'supplier_stop',
            timestamp: new Date(),
            location: {
                latitude: location.latitude,
                longitude: location.longitude,
                address: supplierName
            },
            metadata: {
                alertReason: `Material pickup at ${supplierName}`
            },
            priority: 'medium',
            isRead: false,
            createdAt: new Date()
        };

        await this.saveAlert(alert);
        await this.notifyAlert(alert);
    }

    // Helper methods
    private determineIgnitionPriority(centralTime: moment.Moment): 'low' | 'medium' | 'high' | 'critical' {
        const hour = centralTime.hour();
        const isWeekend = centralTime.day() === 0 || centralTime.day() === 6; // Sunday = 0, Saturday = 6
        
        // Critical: After midnight or very early morning on weekdays
        if (!isWeekend && (hour >= 0 && hour < 5)) return 'critical';
        
        // High: After business hours on weekdays, or any weekend activity
        if (isWeekend || hour < 7 || hour > 19) return 'high';
        
        // Medium: Early morning or late business hours
        if (hour < 8 || hour > 17) return 'medium';
        
        // Low: Normal business hours
        return 'low';
    }

    private getIgnitionOnReason(centralTime: moment.Moment): string {
        const hour = centralTime.hour();
        const isWeekend = centralTime.day() === 0 || centralTime.day() === 6;
        const dayName = centralTime.format('dddd');
        
        if (isWeekend) {
            return `Weekend activity on ${dayName} at ${centralTime.format('h:mm A')}`;
        }
        
        if (hour < 7) {
            return `Early morning start at ${centralTime.format('h:mm A')}`;
        } else if (hour > 19) {
            return `After-hours activity at ${centralTime.format('h:mm A')}`;
        } else {
            return `Business hours activity at ${centralTime.format('h:mm A')}`;
        }
    }

    private getTripEndPriority(duration: number, distance: number): 'low' | 'medium' | 'high' | 'critical' {
        // Long trips are higher priority for business tracking
        if (duration > 60 || distance > 20) return 'high';
        if (duration > 15 || distance > 5) return 'medium';
        return 'low';
    }

    private async getLocationName(lat: number, lng: number): Promise<string> {
        try {
            const { geocodingService } = await import('./geocoding');
            return await geocodingService.getAddress(lat, lng);
        } catch (error) {
            return `${lat}, ${lng}`;
        }
    }

    private async getClientName(lat: number, lng: number): Promise<string | undefined> {
        try {
            const { clientLocationService } = await import('./clientLocations');
            const result = await clientLocationService.findClientLocationMatch(lat, lng);
            return result || undefined;
        } catch (error) {
            return undefined;
        }
    }

    private async isRuleEnabled(alertType: string): Promise<boolean> {
        try {
            const rule = await this.rulesCollection.findOne({ alertType });
            return rule?.enabled ?? false;
        } catch (error) {
            return false;
        }
    }

    private async getRule(alertType: string): Promise<AlertRule | null> {
        try {
            return await this.rulesCollection.findOne({ alertType });
        } catch (error) {
            return null;
        }
    }

    private async saveAlert(alert: Alert): Promise<void> {
        try {
            await this.alertsCollection.insertOne(alert as any);
        } catch (error) {
            console.error('❌ Failed to save alert:', error);
        }
    }

    private async notifyAlert(alert: Alert): Promise<void> {
        try {
            const rule = await this.getRule(alert.alertType);
            if (!rule?.notifications.console) return;

            const centralTime = moment(alert.timestamp).tz('America/Chicago');
            const priorityEmoji = this.getPriorityEmoji(alert.priority);
            const typeEmoji = this.getAlertTypeEmoji(alert.alertType);

            console.log(`\n${priorityEmoji}${typeEmoji} FLEET ALERT - ${alert.alertType.toUpperCase().replace('_', ' ')}`);
            console.log(`   Vehicle: ${alert.vehicleName} (${alert.vehicleId})`);
            console.log(`   Time: ${centralTime.format('dddd, MMM DD h:mm:ss A')} CT`);
            console.log(`   Location: ${alert.location.address || 'Unknown'}`);
            
            if (alert.location.clientName) {
                console.log(`   🎯 Client: ${alert.location.clientName}`);
            }
            
            if (alert.metadata.alertReason) {
                console.log(`   ℹ️  Details: ${alert.metadata.alertReason}`);
            }

            if (alert.metadata.duration) {
                console.log(`   ⏱️  Duration: ${alert.metadata.duration.toFixed(1)} minutes`);
            }

            if (alert.metadata.distance) {
                console.log(`   📏 Distance: ${alert.metadata.distance.toFixed(1)} miles`);
            }

            if (alert.metadata.batteryLevel !== undefined) {
                console.log(`   🔋 Battery: ${alert.metadata.batteryLevel}%`);
            }

            console.log(`   🚨 Priority: ${alert.priority.toUpperCase()}`);
            console.log(`════════════════════════════════════════════════════════`);
        } catch (error) {
            console.error('❌ Failed to notify alert:', error);
        }
    }

    private getPriorityEmoji(priority: string): string {
        switch (priority) {
            case 'critical': return '🚨';
            case 'high': return '⚠️ ';
            case 'medium': return '🔔';
            case 'low': return 'ℹ️ ';
            default: return '📢';
        }
    }

    private getAlertTypeEmoji(alertType: string): string {
        switch (alertType) {
            case 'ignition_on': return '🚀';
            case 'ignition_off': return '🛑';
            case 'trip_start': return '🏁';
            case 'trip_end': return '🏁';
            case 'client_visit': return '🎯';
            case 'supplier_stop': return '🏬';
            case 'long_idle': return '😴';
            case 'unusual_activity': return '🤔';
            default: return '📍';
        }
    }

    // Public API methods
    async getRecentAlerts(limit: number = 50, unreadOnly: boolean = false): Promise<Alert[]> {
        const query = unreadOnly ? { isRead: false } : {};

        // Get a larger set of raw alerts to filter from
        const rawAlerts = await this.alertsCollection
            .find(query)
            .sort({ timestamp: -1 })
            .limit(limit * 3) // Get 3x more to filter down
            .toArray();

        // Apply intelligent filtering
        const filteredAlerts = this.applyIntelligentFiltering(rawAlerts);

        // Return the requested limit
        return filteredAlerts.slice(0, limit);
    }

    private applyIntelligentFiltering(alerts: Alert[]): Alert[] {
        const filtered: Alert[] = [];
        const recentEvents = new Map<string, Alert[]>(); // vehicleId -> recent events

        // Group alerts by vehicle and analyze patterns
        for (const alert of alerts) {
            const vehicleKey = alert.vehicleId;
            if (!recentEvents.has(vehicleKey)) {
                recentEvents.set(vehicleKey, []);
            }
            recentEvents.get(vehicleKey)!.push(alert);
        }

        // Process each vehicle's events
        for (const [vehicleId, vehicleAlerts] of recentEvents.entries()) {
            const processedEvents = this.consolidateVehicleEvents(vehicleAlerts);
            filtered.push(...processedEvents);
        }

        // Sort by timestamp and return
        return filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    }

    private consolidateVehicleEvents(alerts: Alert[]): Alert[] {
        const consolidated: Alert[] = [];
        let lastLocation = '';
        let lastEventTime = 0;
        let skipNext = false;

        for (let i = 0; i < alerts.length; i++) {
            if (skipNext) {
                skipNext = false;
                continue;
            }

            const alert = alerts[i];
            const currentLocation = alert.location.address || '';
            const currentTime = new Date(alert.timestamp).getTime();

            // Skip rapid-fire events at same location (within 5 minutes)
            if (currentLocation === lastLocation && (currentTime - lastEventTime) < 5 * 60 * 1000) {
                // Skip ignition_on and trip_start spam at same location
                if (alert.alertType === 'ignition_on' || alert.alertType === 'trip_start') {
                    continue;
                }
            }

            // Prioritize meaningful events over noise
            if (this.isMeaningfulEvent(alert, i, alerts)) {
                consolidated.push(alert);
                lastLocation = currentLocation;
                lastEventTime = currentTime;
            }
        }

        return consolidated;
    }

    private isMeaningfulEvent(alert: Alert, index: number, allAlerts: Alert[]): boolean {
        // Always show high-priority events
        if (alert.priority === 'high' || alert.priority === 'critical') {
            return true;
        }

        // Always show client visits and trip completions
        if (['client_visit', 'client_arrival', 'client_departure', 'trip_end'].includes(alert.alertType)) {
            return true;
        }

        // Show trip starts only if not followed immediately by another trip start at same location
        if (alert.alertType === 'trip_start') {
            // Look ahead to see if there are more trip starts at same location within 5 minutes
            const nextFewAlerts = allAlerts.slice(index + 1, index + 5);
            const sameLocationTripStarts = nextFewAlerts.filter(nextAlert =>
                nextAlert.alertType === 'trip_start' &&
                nextAlert.location.address === alert.location.address &&
                (new Date(alert.timestamp).getTime() - new Date(nextAlert.timestamp).getTime()) < 5 * 60 * 1000
            );

            // Only show if this isn't part of a spam cluster
            return sameLocationTripStarts.length === 0;
        }

        // Show ignition events only if they represent actual state changes
        if (alert.alertType === 'ignition_on' || alert.alertType === 'ignition_off') {
            // Look for alternating pattern - if there are multiple ignition events rapidly, skip most of them
            const recentIgnitionEvents = allAlerts
                .slice(index, index + 3)
                .filter(a => a.alertType === 'ignition_on' || a.alertType === 'ignition_off');

            // If there are multiple ignition events, only show the first meaningful one
            return recentIgnitionEvents.length <= 1;
        }

        // Show other events by default
        return true;
    }

    async getAlertsByVehicle(vehicleId: string, limit: number = 50): Promise<Alert[]> {
        return this.alertsCollection
            .find({ vehicleId })
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();
    }

    async markAlertAsRead(alertId: string): Promise<void> {
        await this.alertsCollection.updateOne(
            { _id: alertId },
            { $set: { isRead: true } }
        );
    }

    async updateRule(alertType: string, updates: Partial<AlertRule>): Promise<void> {
        await this.rulesCollection.updateOne(
            { alertType },
            { $set: updates },
            { upsert: true }
        );
    }

    async getAllRules(): Promise<AlertRule[]> {
        return this.rulesCollection.find().toArray();
    }

    async getUnreadCount(): Promise<number> {
        return this.alertsCollection.countDocuments({ isRead: false });
    }

    async getParkedDurationMinutes(vehicleId: string, clientName: string): Promise<number | null> {
        try {
            // Find the most recent client_arrival alert for this vehicle at this client
            const arrivalAlert = await this.alertsCollection.findOne(
                {
                    vehicleId,
                    alertType: 'client_arrival',
                    'location.clientName': clientName
                },
                { sort: { timestamp: -1 } }
            );

            if (!arrivalAlert) {
                return null; // No arrival found
            }

            // Check if there's a departure after this arrival
            const departureAlert = await this.alertsCollection.findOne(
                {
                    vehicleId,
                    alertType: 'client_departure',
                    timestamp: { $gt: arrivalAlert.timestamp }
                },
                { sort: { timestamp: 1 } }
            );

            if (departureAlert) {
                return null; // Vehicle has already departed
            }

            // Calculate duration since arrival
            const now = new Date();
            const arrivalTime = new Date(arrivalAlert.timestamp);
            const durationMs = now.getTime() - arrivalTime.getTime();
            const durationMinutes = Math.floor(durationMs / (1000 * 60));

            return durationMinutes;
        } catch (error) {
            console.error('❌ Failed to get parked duration:', error);
            return null;
        }
    }

    // Helper method to get last alert of specific type for a vehicle
    private async getLastAlert(vehicleId: string, alertType: string): Promise<Alert | null> {
        try {
            return await this.alertsCollection.findOne(
                { vehicleId, alertType: alertType as Alert['alertType'] },
                { sort: { timestamp: -1 } }
            );
        } catch (error) {
            console.error('❌ Failed to get last alert:', error);
            return null;
        }
    }

    // Helper method to calculate distance between two coordinates in miles
    private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const R = 3959; // Earth's radius in miles
        const dLat = this.toRadians(lat2 - lat1);
        const dLon = this.toRadians(lon2 - lon1);
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    private toRadians(degrees: number): number {
        return degrees * (Math.PI / 180);
    }

    async close(): Promise<void> {
        if (this.client) {
            await this.client.close();
        }
        console.log('✅ Smart alerts service closed');
    }
}

export const smartAlertsService = new SmartAlertsService();