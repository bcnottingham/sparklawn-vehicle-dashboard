import { MongoClient, Db, Collection } from 'mongodb';
import moment from 'moment-timezone';
import { tripTimelineService } from './tripTimelineService';

export interface DailyReport {
    _id?: string;
    date: string; // YYYY-MM-DD format
    vehicleId: string;
    vehicleName: string;
    stats: {
        totalTrips: number;
        totalRunTime: number; // minutes
        totalDistance: number; // miles
        totalBatteryUsed: number; // percentage
        firstTripStart: Date;
        lastTripEnd: Date;
        operatingHours: number; // hours
        avgSpeed: number; // mph
    };
    locations: {
        clientVisits: Array<{
            clientName: string;
            address: string;
            arrivalTime: Date;
            departureTime?: Date;
            duration?: number; // minutes
        }>;
        supplierStops: Array<{
            supplierName: string;
            address: string;
            arrivalTime: Date;
            duration?: number; // minutes
        }>;
        uniqueLocations: string[];
    };
    alerts: {
        total: number;
        byType: Record<string, number>;
        highPriority: number;
    };
    efficiency: {
        milesPerTrip: number;
        batteryEfficiency: number; // miles per % battery
        utilization: number; // percentage of day active
    };
    generatedAt: Date;
}

export class DailyReportsService {
    private client!: MongoClient;
    private db!: Db;
    private reportsCollection!: Collection<DailyReport>;
    private isInitialized = false;

    async initialize(): Promise<void> {
        try {
            const mongoUri = process.env.MONGODB_URI;
            if (!mongoUri) {
                console.warn('⚠️ MONGODB_URI not configured - daily reports service disabled');
                return;
            }

            this.client = new MongoClient(mongoUri);
            await this.client.connect();
            this.db = this.client.db();

            this.reportsCollection = this.db.collection<DailyReport>('daily_reports');

            await this.createIndexes();
            this.isInitialized = true;
            
            console.log('✅ Daily reports service initialized');
        } catch (error) {
            console.error('❌ Failed to initialize daily reports service:', error);
            throw error;
        }
    }

    private async createIndexes(): Promise<void> {
        try {
            await this.reportsCollection.createIndex({ date: 1, vehicleId: 1 }, { unique: true });
            await this.reportsCollection.createIndex({ date: -1 });
            await this.reportsCollection.createIndex({ vehicleId: 1, date: -1 });
            
            console.log('✅ Daily reports indexes created');
        } catch (error) {
            console.warn('⚠️ Failed to create daily reports indexes:', error);
        }
    }

    async generateDailyReport(date: string, vehicleId?: string): Promise<DailyReport[]> {
        if (!this.isInitialized) {
            throw new Error('Daily reports service not initialized');
        }

        const startOfDay = moment.tz(date, 'America/Chicago').startOf('day').toDate();
        const endOfDay = moment.tz(date, 'America/Chicago').endOf('day').toDate();

        const vehicleFilter = vehicleId ? { vehicleId } : {};

        // Get all alerts for the day
        const alerts = await this.db.collection('smart_alerts').find({
            ...vehicleFilter,
            timestamp: { $gte: startOfDay, $lte: endOfDay }
        }).toArray();

        // Get list of vehicles - hardcoded for now (same as in other services)
        const vehicleIds = vehicleId ? [vehicleId] : [
            '1FTVW1EL3NWG00285', // Lightning 1
            '1FT6W1EV3PWG37779',  // Lightning 2
            '1FTVW1EV3NWG07402',  // Lightning 3
            '1FTBW1XK6PKA30591'   // eTransit 1
        ];

        const reports: DailyReport[] = [];

        for (const vId of vehicleIds) {
            // Use trip timeline service to get reconstructed trips
            const timeline = await tripTimelineService.getTimelineForPeriod(vId, startOfDay, endOfDay);

            const vehicleTrips = timeline.trips || [];
            const vehicleAlerts = alerts.filter(a => a.vehicleId === vId);

            if (vehicleTrips.length === 0 && vehicleAlerts.length === 0) {
                continue; // No activity for this vehicle
            }

            const vehicleName = timeline.vehicleName || vId;

            const report = await this.buildDailyReport(date, vId, vehicleName, vehicleTrips, vehicleAlerts);
            reports.push(report);

            // Save to database
            await this.reportsCollection.replaceOne(
                { date, vehicleId: vId },
                report,
                { upsert: true }
            );
        }

        return reports;
    }

    private async buildDailyReport(
        date: string,
        vehicleId: string,
        vehicleName: string,
        trips: any[],
        alerts: any[]
    ): Promise<DailyReport> {

        // Calculate basic stats
        const totalTrips = trips.length;
        const totalRunTime = trips.reduce((sum, trip) => sum + (trip.duration || 0), 0); // trip.duration is already in minutes
        const totalDistance = trips.reduce((sum, trip) => sum + (trip.distance || 0), 0);
        const totalBatteryUsed = trips.reduce((sum, trip) => sum + (trip.batteryUsed || 0), 0);

        const firstTripStart = trips.length > 0 ?
            new Date(Math.min(...trips.map(t => new Date(t.startTime).getTime()))) :
            new Date(date);

        const lastTripEnd = trips.length > 0 ?
            new Date(Math.max(...trips.map(t => new Date(t.endTime || t.startTime).getTime()))) :
            new Date(date);

        const operatingHours = (lastTripEnd.getTime() - firstTripStart.getTime()) / (1000 * 60 * 60);
        const avgSpeed = totalRunTime > 0 ? (totalDistance / (totalRunTime / 60)) : 0;

        // Analyze locations
        const clientVisits: any[] = [];
        const supplierStops: any[] = [];
        const uniqueLocations = new Set<string>();

        trips.forEach(trip => {
            if (trip.endLocation) {
                const address = trip.endLocation.address || `${trip.endLocation.latitude}, ${trip.endLocation.longitude}`;
                uniqueLocations.add(address);

                // Exclude home base (McRay Shop) from client visits
                const isHomeBase = trip.endLocation.clientName?.includes('🏠') ||
                                 trip.endLocation.clientName?.includes('McRay Shop') ||
                                 trip.endLocation.address?.includes('McRay Shop');

                if (trip.endLocation.clientName && !isHomeBase) {
                    clientVisits.push({
                        clientName: trip.endLocation.clientName,
                        address,
                        arrivalTime: new Date(trip.endTime || trip.startTime),
                        duration: (trip.duration || 0) * 60 // Convert hours to minutes
                    });
                } else if (!isHomeBase && this.isSupplierLocation(address)) {
                    supplierStops.push({
                        supplierName: this.extractSupplierName(address),
                        address,
                        arrivalTime: new Date(trip.endTime || trip.startTime),
                        duration: (trip.duration || 0) * 60 // Convert hours to minutes
                    });
                }
            }
        });

        // Analyze alerts
        const alertsByType: Record<string, number> = {};
        let highPriorityAlerts = 0;

        alerts.forEach(alert => {
            alertsByType[alert.alertType] = (alertsByType[alert.alertType] || 0) + 1;
            if (alert.priority === 'high' || alert.priority === 'critical') {
                highPriorityAlerts++;
            }
        });

        // Calculate efficiency metrics
        const milesPerTrip = totalTrips > 0 ? totalDistance / totalTrips : 0;
        const batteryEfficiency = totalBatteryUsed > 0 ? totalDistance / totalBatteryUsed : 0;
        const utilization = operatingHours > 0 ? Math.min((totalRunTime / 60) / operatingHours * 100, 100) : 0;

        return {
            date,
            vehicleId,
            vehicleName,
            stats: {
                totalTrips,
                totalRunTime,
                totalDistance: Math.round(totalDistance * 100) / 100,
                totalBatteryUsed: Math.round(totalBatteryUsed * 100) / 100,
                firstTripStart,
                lastTripEnd,
                operatingHours: Math.round(operatingHours * 100) / 100,
                avgSpeed: Math.round(avgSpeed * 100) / 100
            },
            locations: {
                clientVisits,
                supplierStops,
                uniqueLocations: Array.from(uniqueLocations)
            },
            alerts: {
                total: alerts.length,
                byType: alertsByType,
                highPriority: highPriorityAlerts
            },
            efficiency: {
                milesPerTrip: Math.round(milesPerTrip * 100) / 100,
                batteryEfficiency: Math.round(batteryEfficiency * 100) / 100,
                utilization: Math.round(utilization * 100) / 100
            },
            generatedAt: new Date()
        };
    }

    private isSupplierLocation(address: string): boolean {
        const suppliers = ['home depot', 'lowes', "lowe's", 'garden city nursery', 'walmart', 'menards', 'ace hardware'];
        return suppliers.some(supplier => address.toLowerCase().includes(supplier));
    }

    private extractSupplierName(address: string): string {
        const suppliers = ['Home Depot', "Lowe's", 'Garden City Nursery', 'Walmart', 'Menards', 'Ace Hardware'];
        
        for (const supplier of suppliers) {
            if (address.toLowerCase().includes(supplier.toLowerCase())) {
                return supplier;
            }
        }
        
        return address.split(',')[0]; // Return first part of address
    }

    async printDailyReport(date: string, vehicleId?: string): Promise<void> {
        const reports = await this.generateDailyReport(date, vehicleId);
        
        if (reports.length === 0) {
            console.log(`\n📊 No activity found for ${date}`);
            return;
        }

        const centralDate = moment.tz(date, 'America/Chicago');
        console.log(`\n📊 SPARKLAWN FLEET DAILY REPORT - ${centralDate.format('dddd, MMMM DD, YYYY')}`);
        console.log('═'.repeat(80));

        for (const report of reports) {
            console.log(`\n🚗 ${report.vehicleName} (${report.vehicleId})`);
            console.log('─'.repeat(50));
            
            // Activity Stats
            console.log(`📈 ACTIVITY STATS:`);
            console.log(`   Total Trips: ${report.stats.totalTrips}`);
            console.log(`   Total Runtime: ${Math.floor(report.stats.totalRunTime / 60)}h ${report.stats.totalRunTime % 60}m`);
            console.log(`   Total Distance: ${report.stats.totalDistance} miles`);
            console.log(`   Battery Used: ${report.stats.totalBatteryUsed}%`);
            console.log(`   Operating Hours: ${report.stats.operatingHours}h`);
            console.log(`   Average Speed: ${report.stats.avgSpeed} mph`);

            if (report.stats.totalTrips > 0) {
                const startTime = moment(report.stats.firstTripStart).tz('America/Chicago');
                const endTime = moment(report.stats.lastTripEnd).tz('America/Chicago');
                console.log(`   First Trip: ${startTime.format('h:mm A')}`);
                console.log(`   Last Trip: ${endTime.format('h:mm A')}`);
            }

            // Efficiency Metrics
            console.log(`\n⚡ EFFICIENCY:`);
            console.log(`   Miles per Trip: ${report.efficiency.milesPerTrip}`);
            console.log(`   Battery Efficiency: ${report.efficiency.batteryEfficiency} mi/%`);
            console.log(`   Utilization: ${report.efficiency.utilization}%`);

            // Client Visits
            if (report.locations.clientVisits.length > 0) {
                console.log(`\n👥 CLIENT VISITS (${report.locations.clientVisits.length}):`);
                report.locations.clientVisits.forEach((visit, idx) => {
                    const arrivalTime = moment(visit.arrivalTime).tz('America/Chicago');
                    console.log(`   ${idx + 1}. ${visit.clientName}`);
                    console.log(`      📍 ${visit.address}`);
                    console.log(`      🕐 ${arrivalTime.format('h:mm A')} (${visit.duration || 0}min)`);
                });
            }

            // Supplier Stops
            if (report.locations.supplierStops.length > 0) {
                console.log(`\n🏬 SUPPLIER STOPS (${report.locations.supplierStops.length}):`);
                report.locations.supplierStops.forEach((stop, idx) => {
                    const arrivalTime = moment(stop.arrivalTime).tz('America/Chicago');
                    console.log(`   ${idx + 1}. ${stop.supplierName}`);
                    console.log(`      📍 ${stop.address}`);
                    console.log(`      🕐 ${arrivalTime.format('h:mm A')} (${stop.duration || 0}min)`);
                });
            }

            // Alerts Summary
            if (report.alerts.total > 0) {
                console.log(`\n🚨 ALERTS SUMMARY (${report.alerts.total} total, ${report.alerts.highPriority} high priority):`);
                Object.entries(report.alerts.byType).forEach(([type, count]) => {
                    const emoji = this.getAlertEmoji(type);
                    console.log(`   ${emoji} ${type.replace('_', ' ')}: ${count}`);
                });
            }

            // Unique Locations
            if (report.locations.uniqueLocations.length > 0) {
                console.log(`\n📍 UNIQUE LOCATIONS VISITED: ${report.locations.uniqueLocations.length}`);
            }
        }

        console.log('\n' + '═'.repeat(80));
    }

    private getAlertEmoji(alertType: string): string {
        switch (alertType) {
            case 'ignition_on': return '🚀';
            case 'ignition_off': return '🛑';
            case 'trip_start': return '🏁';
            case 'trip_end': return '🏁';
            case 'client_visit': return '🎯';
            case 'supplier_stop': return '🏬';
            default: return '📢';
        }
    }

    // API methods
    async getReport(date: string, vehicleId?: string): Promise<DailyReport[]> {
        const query = vehicleId ? { date, vehicleId } : { date };
        return this.reportsCollection.find(query).toArray();
    }

    async getRecentReports(days: number = 7, vehicleId?: string): Promise<DailyReport[]> {
        const endDate = moment.tz('America/Chicago').format('YYYY-MM-DD');
        const startDate = moment.tz('America/Chicago').subtract(days, 'days').format('YYYY-MM-DD');
        
        const query = vehicleId ? 
            { date: { $gte: startDate, $lte: endDate }, vehicleId } :
            { date: { $gte: startDate, $lte: endDate } };

        return this.reportsCollection.find(query).sort({ date: -1, vehicleId: 1 }).toArray();
    }

    async generateAutomaticReport(): Promise<void> {
        // Generate report for yesterday (business reports are typically for completed days)
        const yesterday = moment.tz('America/Chicago').subtract(1, 'day').format('YYYY-MM-DD');
        
        console.log(`\n🤖 Generating automatic daily report for ${yesterday}...`);
        await this.printDailyReport(yesterday);
    }

    async close(): Promise<void> {
        if (this.client) {
            await this.client.close();
        }
        console.log('✅ Daily reports service closed');
    }
}

export const dailyReportsService = new DailyReportsService();