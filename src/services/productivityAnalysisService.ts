import { MongoClient, Db, Collection } from 'mongodb';
import { IgnitionTrip, RoutePoint } from './backgroundMonitoringService';

export interface ProductivityPeriod {
    _id?: string;
    vehicleId: string;
    vehicleName: string;
    date: Date;
    
    // Time breakdowns (in minutes)
    totalOnJobTime: number;        // Time parked at client locations
    totalOffJobTime: number;       // Time driving or at non-client locations
    totalIdleTime: number;         // Time parked but engine running
    totalDrivingTime: number;      // Time actually moving between locations
    
    // Job site analysis
    jobSites: JobSiteVisit[];
    
    // Summary metrics
    productivityRatio: number;     // on-job / total time
    efficiency: number;           // actual work time / total time
    totalWorkingHours: number;    // total time ignition was on
    
    // Client insights
    uniqueClients: number;
    topClient: string;
    clientHours: ClientTimeBreakdown[];
    
    lastUpdated: Date;
}

export interface JobSiteVisit {
    clientName: string;
    address: string;
    arrivalTime: Date;
    departureTime?: Date;
    durationMinutes: number;
    coordinates: { latitude: number; longitude: number };
    isCompleteVisit: boolean;
    
    // Work analysis
    engineRunTime: number;        // Time with engine running at location
    engineOffTime: number;        // Time with engine off at location
    workType: 'maintenance' | 'landscaping' | 'consultation' | 'unknown';
}

export interface ClientTimeBreakdown {
    clientName: string;
    totalMinutes: number;
    visits: number;
    avgVisitDuration: number;
    addresses: string[];
}

export interface ProductivityReport {
    period: 'daily' | 'weekly' | 'monthly';
    startDate: Date;
    endDate: Date;
    vehicleId?: string;
    
    // High-level metrics
    totalOnJobHours: number;
    totalOffJobHours: number;
    productivityPercentage: number;
    
    // Detailed breakdowns
    dailySummaries: ProductivityPeriod[];
    clientAnalysis: ClientTimeBreakdown[];
    efficiencyTrends: { date: Date; productivity: number }[];
    
    // Insights
    insights: {
        mostProductiveDay: Date;
        topClient: string;
        avgJobSiteDuration: number;
        totalUniqueClients: number;
        recommendedImprovements: string[];
    };
}

export class ProductivityAnalysisService {
    private client!: MongoClient;
    private db!: Db;
    private ignitionTripsCollection!: Collection<IgnitionTrip>;
    private productivityPeriodsCollection!: Collection<ProductivityPeriod>;
    
    // Configuration
    private readonly MIN_JOB_SITE_DURATION = 5; // minutes - minimum time to count as work
    private readonly MAX_IDLE_DISTANCE = 50; // meters - max distance to consider "at same location"
    private readonly CLIENT_LOCATION_RADIUS = 100; // meters - radius to group client visits
    
    constructor() {
        this.connect();
    }
    
    private async connect(): Promise<void> {
        try {
            const mongoUri = process.env.MONGODB_URI;
            if (!mongoUri) {
                console.warn('⚠️ MONGODB_URI not configured - productivity analysis service disabled');
                return;
            }
            
            this.client = new MongoClient(mongoUri);
            await this.client.connect();
            this.db = this.client.db('sparklawn_fleet');
            
            this.ignitionTripsCollection = this.db.collection<IgnitionTrip>('ignition_trips');
            this.productivityPeriodsCollection = this.db.collection<ProductivityPeriod>('productivity_periods');
            
            await this.createIndexes();
            
            console.log('✅ Productivity analysis service connected');
        } catch (error) {
            console.error('❌ Failed to connect productivity analysis service:', error);
            throw error;
        }
    }
    
    private async createIndexes(): Promise<void> {
        try {
            await this.productivityPeriodsCollection.createIndex({ vehicleId: 1, date: -1 });
            await this.productivityPeriodsCollection.createIndex({ date: -1 });
            console.log('✅ Productivity analysis indexes created');
        } catch (error) {
            console.warn('⚠️ Failed to create productivity indexes:', error);
        }
    }
    
    public async analyzeProductivity(
        vehicleId: string,
        date: Date
    ): Promise<ProductivityPeriod> {
        
        // Get all trips for the specified date
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);
        
        const dailyTrips = await this.ignitionTripsCollection.find({
            vehicleId,
            ignitionOnTime: { $gte: startOfDay, $lt: endOfDay },
            isActive: false
        }).toArray();
        
        if (dailyTrips.length === 0) {
            return this.createEmptyProductivityPeriod(vehicleId, date);
        }
        
        const vehicleName = dailyTrips[0].vehicleName;
        
        // Analyze each trip to identify job sites vs travel
        const jobSites: JobSiteVisit[] = [];
        let totalOnJobTime = 0;
        let totalOffJobTime = 0;
        let totalIdleTime = 0;
        let totalDrivingTime = 0;
        
        for (const trip of dailyTrips) {
            const tripAnalysis = await this.analyzeTripProductivity(trip);
            
            // Add job sites from this trip
            jobSites.push(...tripAnalysis.jobSites);
            
            // Accumulate time metrics
            totalOnJobTime += tripAnalysis.onJobTime;
            totalOffJobTime += tripAnalysis.offJobTime;
            totalIdleTime += tripAnalysis.idleTime;
            totalDrivingTime += tripAnalysis.drivingTime;
        }
        
        // Calculate client breakdowns
        const clientHours = this.calculateClientBreakdown(jobSites);
        
        // Calculate productivity metrics
        const totalWorkingHours = totalOnJobTime + totalOffJobTime;
        const productivityRatio = totalWorkingHours > 0 ? totalOnJobTime / totalWorkingHours : 0;
        const efficiency = totalWorkingHours > 0 ? 
            (totalOnJobTime + totalDrivingTime) / totalWorkingHours : 0;
        
        const productivityPeriod: ProductivityPeriod = {
            vehicleId,
            vehicleName,
            date: startOfDay,
            totalOnJobTime,
            totalOffJobTime,
            totalIdleTime,
            totalDrivingTime,
            jobSites,
            productivityRatio,
            efficiency,
            totalWorkingHours,
            uniqueClients: clientHours.length,
            topClient: clientHours.length > 0 ? clientHours[0].clientName : 'None',
            clientHours,
            lastUpdated: new Date()
        };
        
        // Save to database
        await this.productivityPeriodsCollection.replaceOne(
            { vehicleId, date: startOfDay },
            productivityPeriod,
            { upsert: true }
        );
        
        return productivityPeriod;
    }
    
    private async analyzeTripProductivity(trip: IgnitionTrip): Promise<{
        jobSites: JobSiteVisit[];
        onJobTime: number;
        offJobTime: number;
        idleTime: number;
        drivingTime: number;
    }> {
        
        const jobSites: JobSiteVisit[] = [];
        let onJobTime = 0;
        let offJobTime = 0;
        let idleTime = 0;
        let drivingTime = 0;
        
        if (!trip.routePoints || trip.routePoints.length === 0) {
            // No route data, classify entire trip based on start/end locations
            const duration = trip.totalRunTime || 0;
            
            if (this.isClientLocation(trip.startLocation.clientName) || 
                this.isClientLocation(trip.endLocation?.clientName)) {
                onJobTime += duration;
                
                if (trip.startLocation.clientName) {
                    jobSites.push({
                        clientName: trip.startLocation.clientName,
                        address: trip.startLocation.address || 'Unknown',
                        arrivalTime: trip.ignitionOnTime,
                        departureTime: trip.ignitionOffTime,
                        durationMinutes: duration,
                        coordinates: {
                            latitude: trip.startLocation.latitude,
                            longitude: trip.startLocation.longitude
                        },
                        isCompleteVisit: true,
                        engineRunTime: duration,
                        engineOffTime: 0,
                        workType: this.inferWorkType(trip.startLocation.address)
                    });
                }
            } else {
                offJobTime += duration;
            }
            
            return { jobSites, onJobTime, offJobTime, idleTime, drivingTime };
        }
        
        // Analyze route points to identify stops and work periods
        const stops = this.identifyStops(trip.routePoints);
        
        for (const stop of stops) {
            const stopDuration = (stop.endTime.getTime() - stop.startTime.getTime()) / (1000 * 60);
            
            if (stopDuration >= this.MIN_JOB_SITE_DURATION) {
                // Determine if this is a client location
                const clientName = await this.identifyClientFromLocation(
                    stop.location.latitude,
                    stop.location.longitude
                );
                
                if (clientName) {
                    onJobTime += stopDuration;
                    
                    jobSites.push({
                        clientName,
                        address: stop.address || 'Unknown',
                        arrivalTime: stop.startTime,
                        departureTime: stop.endTime,
                        durationMinutes: stopDuration,
                        coordinates: stop.location,
                        isCompleteVisit: true,
                        engineRunTime: stop.engineOnTime,
                        engineOffTime: stop.engineOffTime,
                        workType: this.inferWorkType(stop.address)
                    });
                } else {
                    // Non-client location (gas, personal, etc.)
                    offJobTime += stopDuration;
                }
            }
        }
        
        // Calculate driving time (time between stops)
        const totalTripTime = trip.totalRunTime || 0;
        const totalStopTime = stops.reduce((sum, stop) => 
            sum + (stop.endTime.getTime() - stop.startTime.getTime()) / (1000 * 60), 0
        );
        
        drivingTime = Math.max(0, totalTripTime - totalStopTime);
        
        return { jobSites, onJobTime, offJobTime, idleTime, drivingTime };
    }
    
    private identifyStops(routePoints: RoutePoint[]): Array<{
        startTime: Date;
        endTime: Date;
        location: { latitude: number; longitude: number };
        address?: string;
        engineOnTime: number;
        engineOffTime: number;
    }> {
        
        const stops = [];
        let currentStop: any = null;
        
        for (let i = 0; i < routePoints.length; i++) {
            const point = routePoints[i];
            const isMoving = point.isMoving;
            
            if (!isMoving && !currentStop) {
                // Start of a new stop
                currentStop = {
                    startTime: point.timestamp,
                    location: { latitude: point.latitude, longitude: point.longitude },
                    address: point.address,
                    engineOnTime: 0,
                    engineOffTime: 0
                };
            } else if (isMoving && currentStop) {
                // End of current stop
                currentStop.endTime = routePoints[i - 1].timestamp;
                stops.push(currentStop);
                currentStop = null;
            } else if (currentStop) {
                // Continue current stop - accumulate engine time
                if (point.ignitionStatus === 'On') {
                    currentStop.engineOnTime += 0.5; // 30-second intervals
                } else {
                    currentStop.engineOffTime += 0.5;
                }
            }
        }
        
        // Close final stop if exists
        if (currentStop) {
            currentStop.endTime = routePoints[routePoints.length - 1].timestamp;
            stops.push(currentStop);
        }
        
        return stops;
    }
    
    private async identifyClientFromLocation(
        latitude: number,
        longitude: number
    ): Promise<string | null> {
        
        try {
            // UPDATED: Use enhanced geocoding service with 96 SparkLawn client priority
            const { geocodingService } = await import('./geocoding');
            const locationName = await geocodingService.getAddress(latitude, longitude);
            
            if (!locationName) return null;
            
            // Check if this is a known SparkLawn client (highest priority)
            const { clientLocationService } = await import('./clientLocations');
            const clientMatch = await clientLocationService.findClientLocationMatch(latitude, longitude);
            
            if (clientMatch) {
                console.log(`✅ CLIENT VISIT DETECTED: ${clientMatch} at ${latitude}, ${longitude}`);
                return clientMatch; // Return actual SparkLawn client name
            }
            
            // Check if this looks like a generic residential client (patterns)
            const residentialPatterns = [
                /^\d+\s+\w+\s+(st|street|ave|avenue|dr|drive|ln|lane|ct|court|blvd|boulevard|rd|road)/i,
                /^\d+\s+\w+\s+\w+\s+(st|street|ave|avenue|dr|drive|ln|lane|ct|court|blvd|boulevard|rd|road)/i,
                /^\d+\s+[nsew]\s+\w+/i, // addresses like "123 N Main St"
                /^\d+\s+\w+\s+circle|cir|place|pl|way|pkwy/i,
                /residential/i,
                /house/i,
                /home/i
            ];
            
            const isResidential = residentialPatterns.some(pattern => pattern.test(locationName));
            
            if (isResidential) {
                // Create generic client name for unknown residential locations
                const streetMatch = locationName.match(/^\d+\s+(\w+\s+\w+)/);
                if (streetMatch) {
                    return `Unknown Client - ${streetMatch[1]}`;
                }
                return 'Unknown Residential Client';
            }
            
            // Not a client location - could be supplier, personal, etc.
            console.log(`ℹ️  Non-client location: ${locationName}`);
            return null;
            
        } catch (error) {
            console.warn('Error identifying client from location:', error);
            return null;
        }
    }
    
    private isClientLocation(clientName?: string): boolean {
        return clientName !== undefined && 
               clientName !== null && 
               clientName !== 'Pending Jobber' &&
               !clientName.toLowerCase().includes('unknown');
    }
    
    private inferWorkType(address?: string): JobSiteVisit['workType'] {
        if (!address) return 'unknown';
        
        const addressLower = address.toLowerCase();
        
        if (addressLower.includes('lawn') || addressLower.includes('yard') || addressLower.includes('garden')) {
            return 'landscaping';
        } else if (addressLower.includes('maintenance') || addressLower.includes('repair')) {
            return 'maintenance';
        } else if (addressLower.includes('office') || addressLower.includes('consultation')) {
            return 'consultation';
        }
        
        return 'landscaping'; // Default for SparkLawn
    }
    
    private calculateClientBreakdown(jobSites: JobSiteVisit[]): ClientTimeBreakdown[] {
        const clientMap = new Map<string, ClientTimeBreakdown>();
        
        for (const jobSite of jobSites) {
            const existing = clientMap.get(jobSite.clientName);
            
            if (existing) {
                existing.totalMinutes += jobSite.durationMinutes;
                existing.visits += 1;
                existing.avgVisitDuration = existing.totalMinutes / existing.visits;
                
                if (!existing.addresses.includes(jobSite.address)) {
                    existing.addresses.push(jobSite.address);
                }
            } else {
                clientMap.set(jobSite.clientName, {
                    clientName: jobSite.clientName,
                    totalMinutes: jobSite.durationMinutes,
                    visits: 1,
                    avgVisitDuration: jobSite.durationMinutes,
                    addresses: [jobSite.address]
                });
            }
        }
        
        return Array.from(clientMap.values())
            .sort((a, b) => b.totalMinutes - a.totalMinutes);
    }
    
    private createEmptyProductivityPeriod(vehicleId: string, date: Date): ProductivityPeriod {
        return {
            vehicleId,
            vehicleName: `Vehicle ${vehicleId.substring(0, 8)}`,
            date: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
            totalOnJobTime: 0,
            totalOffJobTime: 0,
            totalIdleTime: 0,
            totalDrivingTime: 0,
            jobSites: [],
            productivityRatio: 0,
            efficiency: 0,
            totalWorkingHours: 0,
            uniqueClients: 0,
            topClient: 'None',
            clientHours: [],
            lastUpdated: new Date()
        };
    }
    
    // Public API methods
    
    public async getDailyProductivityReport(
        vehicleId: string,
        date: Date
    ): Promise<ProductivityPeriod> {
        
        // Try to get existing analysis first
        const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        let existing = await this.productivityPeriodsCollection.findOne({
            vehicleId,
            date: startOfDay
        });
        
        // If not exists or data is old, reanalyze
        if (!existing || this.shouldReanalyze(existing.lastUpdated)) {
            return await this.analyzeProductivity(vehicleId, date);
        }

        return existing as ProductivityPeriod;
    }
    
    public async getWeeklyProductivityReport(
        vehicleId: string,
        weekStartDate: Date
    ): Promise<ProductivityReport> {
        
        const weekStart = new Date(weekStartDate);
        weekStart.setHours(0, 0, 0, 0);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        weekEnd.setHours(23, 59, 59, 999);
        
        // Get daily summaries for the week
        const dailySummaries: ProductivityPeriod[] = [];
        
        for (let d = new Date(weekStart); d <= weekEnd; d.setDate(d.getDate() + 1)) {
            const dailyReport = await this.getDailyProductivityReport(vehicleId, new Date(d));
            dailySummaries.push(dailyReport);
        }
        
        return this.generateProductivityReport('weekly', weekStart, weekEnd, dailySummaries, vehicleId);
    }
    
    private generateProductivityReport(
        period: 'daily' | 'weekly' | 'monthly',
        startDate: Date,
        endDate: Date,
        dailySummaries: ProductivityPeriod[],
        vehicleId?: string
    ): ProductivityReport {
        
        // Calculate totals
        const totalOnJobHours = dailySummaries.reduce((sum, day) => sum + day.totalOnJobTime, 0) / 60;
        const totalOffJobHours = dailySummaries.reduce((sum, day) => sum + day.totalOffJobTime, 0) / 60;
        const totalHours = totalOnJobHours + totalOffJobHours;
        
        // Client analysis
        const clientMap = new Map<string, ClientTimeBreakdown>();
        dailySummaries.forEach(day => {
            day.clientHours.forEach(client => {
                const existing = clientMap.get(client.clientName);
                if (existing) {
                    existing.totalMinutes += client.totalMinutes;
                    existing.visits += client.visits;
                    existing.addresses = [...new Set([...existing.addresses, ...client.addresses])];
                } else {
                    clientMap.set(client.clientName, { ...client });
                }
            });
        });
        
        const clientAnalysis = Array.from(clientMap.values())
            .map(client => ({
                ...client,
                avgVisitDuration: client.totalMinutes / client.visits
            }))
            .sort((a, b) => b.totalMinutes - a.totalMinutes);
        
        // Find insights
        const mostProductiveDay = dailySummaries.reduce((max, day) => 
            day.productivityRatio > max.productivityRatio ? day : max
        );
        
        const insights = {
            mostProductiveDay: mostProductiveDay.date,
            topClient: clientAnalysis.length > 0 ? clientAnalysis[0].clientName : 'None',
            avgJobSiteDuration: dailySummaries.reduce((sum, day) => 
                sum + day.jobSites.reduce((jobSum, job) => jobSum + job.durationMinutes, 0), 0
            ) / Math.max(1, dailySummaries.reduce((sum, day) => sum + day.jobSites.length, 0)),
            totalUniqueClients: clientAnalysis.length,
            recommendedImprovements: this.generateRecommendations(dailySummaries)
        };
        
        return {
            period,
            startDate,
            endDate,
            vehicleId,
            totalOnJobHours,
            totalOffJobHours,
            productivityPercentage: totalHours > 0 ? (totalOnJobHours / totalHours) * 100 : 0,
            dailySummaries,
            clientAnalysis,
            efficiencyTrends: dailySummaries.map(day => ({
                date: day.date,
                productivity: day.productivityRatio * 100
            })),
            insights
        };
    }
    
    private generateRecommendations(dailySummaries: ProductivityPeriod[]): string[] {
        const recommendations: string[] = [];
        
        const avgProductivity = dailySummaries.reduce((sum, day) => sum + day.productivityRatio, 0) / dailySummaries.length;
        
        if (avgProductivity < 0.6) {
            recommendations.push('Consider optimizing route planning to reduce travel time between job sites');
        }
        
        const avgClientsPerDay = dailySummaries.reduce((sum, day) => sum + day.uniqueClients, 0) / dailySummaries.length;
        if (avgClientsPerDay < 3) {
            recommendations.push('Opportunity to increase daily client visits for better revenue optimization');
        }
        
        const longIdleDays = dailySummaries.filter(day => day.totalIdleTime > 60).length;
        if (longIdleDays > dailySummaries.length * 0.3) {
            recommendations.push('High idle time detected - consider turning off equipment between jobs');
        }
        
        return recommendations;
    }
    
    private shouldReanalyze(lastUpdated: Date): boolean {
        // Reanalyze if data is older than 1 hour
        return (Date.now() - lastUpdated.getTime()) > (60 * 60 * 1000);
    }
    
    public async close(): Promise<void> {
        if (this.client) {
            await this.client.close();
        }
    }
}

export const productivityAnalysisService = new ProductivityAnalysisService();