import { Router } from 'express';
import { productivityAnalysisService } from '../services/productivityAnalysisService';

const router = Router();

// Get daily productivity report for a vehicle
router.get('/daily/:vehicleId', async (req, res) => {
    try {
        const { vehicleId } = req.params;
        const { date } = req.query;
        
        // Parse date or use today
        const targetDate = date ? new Date(date as string) : new Date();
        
        const report = await productivityAnalysisService.getDailyProductivityReport(
            vehicleId,
            targetDate
        );
        
        res.json({
            report,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching daily productivity report:', error);
        res.status(500).json({
            error: 'Failed to fetch daily productivity report',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Get weekly productivity report
router.get('/weekly/:vehicleId', async (req, res) => {
    try {
        const { vehicleId } = req.params;
        const { weekStart } = req.query;
        
        // Parse week start date or use current week
        const startDate = weekStart ? new Date(weekStart as string) : new Date();
        
        // Ensure we start from Monday
        const dayOfWeek = startDate.getDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Handle Sunday = 0
        startDate.setDate(startDate.getDate() + mondayOffset);
        
        const report = await productivityAnalysisService.getWeeklyProductivityReport(
            vehicleId,
            startDate
        );
        
        res.json({
            report,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching weekly productivity report:', error);
        res.status(500).json({
            error: 'Failed to fetch weekly productivity report',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Get productivity summary for all vehicles (fleet overview)
router.get('/fleet/summary', async (req, res) => {
    try {
        const { date, period } = req.query;
        
        // For now, return a placeholder response
        // TODO: Implement fleet-wide productivity analysis
        res.json({
            summary: {
                totalVehicles: 4,
                avgProductivity: 72.5,
                totalOnJobHours: 156.3,
                totalOffJobHours: 43.7,
                topPerformingVehicle: 'Truck 1',
                leastProductiveVehicle: 'Truck 3',
                recommendations: [
                    'Optimize route planning for Truck 3',
                    'Consider additional jobs for high-efficiency vehicles',
                    'Reduce idle time across all vehicles'
                ]
            },
            period: period || 'weekly',
            date: date || new Date().toISOString().split('T')[0],
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching fleet productivity summary:', error);
        res.status(500).json({
            error: 'Failed to fetch fleet summary',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Get job site efficiency analysis
router.get('/job-sites/:vehicleId', async (req, res) => {
    try {
        const { vehicleId } = req.params;
        const { startDate, endDate } = req.query;
        
        const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const end = endDate ? new Date(endDate as string) : new Date();
        
        // Get daily reports for the date range
        const reports: any[] = [];
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            try {
                const dailyReport = await productivityAnalysisService.getDailyProductivityReport(
                    vehicleId,
                    new Date(d)
                );
                reports.push(dailyReport);
            } catch (error) {
                console.warn(`Failed to get report for ${d.toDateString()}:`, error);
            }
        }
        
        // Aggregate job site data
        const jobSiteMap = new Map();
        const clientMap = new Map();
        
        reports.forEach((report: any) => {
            report.jobSites.forEach((jobSite: any) => {
                // Group by client
                const clientData = clientMap.get(jobSite.clientName) || {
                    clientName: jobSite.clientName,
                    totalVisits: 0,
                    totalTime: 0,
                    avgDuration: 0,
                    locations: new Set(),
                    workTypes: new Set()
                };
                
                clientData.totalVisits++;
                clientData.totalTime += jobSite.durationMinutes;
                clientData.avgDuration = clientData.totalTime / clientData.totalVisits;
                clientData.locations.add(jobSite.address);
                clientData.workTypes.add(jobSite.workType);
                
                clientMap.set(jobSite.clientName, clientData);
            });
        });
        
        // Convert to array and add insights
        const jobSiteAnalysis = Array.from(clientMap.values()).map(client => ({
            ...client,
            locations: Array.from(client.locations),
            workTypes: Array.from(client.workTypes),
            efficiency: client.avgDuration > 0 ? Math.min(100, (60 / client.avgDuration) * 100) : 0,
            visitFrequency: client.totalVisits / reports.filter(r => r.jobSites.length > 0).length
        })).sort((a, b) => b.totalTime - a.totalTime);
        
        res.json({
            analysis: {
                dateRange: { startDate: start, endDate: end },
                totalClients: jobSiteAnalysis.length,
                totalJobSites: jobSiteAnalysis.reduce((sum, client) => sum + client.locations.length, 0),
                avgJobDuration: jobSiteAnalysis.reduce((sum, client) => sum + client.avgDuration, 0) / jobSiteAnalysis.length,
                clients: jobSiteAnalysis
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching job site analysis:', error);
        res.status(500).json({
            error: 'Failed to fetch job site analysis',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Get time breakdown analysis (on-job vs off-job trends)
router.get('/time-breakdown/:vehicleId', async (req, res) => {
    try {
        const { vehicleId } = req.params;
        const { days } = req.query;
        
        const numDays = parseInt(days as string) || 7;
        const endDate = new Date();
        const startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - numDays);
        
        // Get daily reports
        const timeBreakdown = [];
        
        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            try {
                const dailyReport = await productivityAnalysisService.getDailyProductivityReport(
                    vehicleId,
                    new Date(d)
                );
                
                timeBreakdown.push({
                    date: dailyReport.date,
                    onJobHours: dailyReport.totalOnJobTime / 60,
                    offJobHours: dailyReport.totalOffJobTime / 60,
                    drivingHours: dailyReport.totalDrivingTime / 60,
                    idleHours: dailyReport.totalIdleTime / 60,
                    productivityRatio: dailyReport.productivityRatio,
                    uniqueClients: dailyReport.uniqueClients,
                    totalJobSites: dailyReport.jobSites.length
                });
            } catch (error) {
                console.warn(`Failed to get breakdown for ${d.toDateString()}:`, error);
            }
        }
        
        // Calculate trends
        const avgProductivity = timeBreakdown.reduce((sum, day) => sum + day.productivityRatio, 0) / timeBreakdown.length;
        const trend = timeBreakdown.length > 1 ? 
            timeBreakdown[timeBreakdown.length - 1].productivityRatio - timeBreakdown[0].productivityRatio : 0;
        
        res.json({
            breakdown: {
                period: `${numDays} days`,
                dailyBreakdown: timeBreakdown,
                summary: {
                    avgProductivity: avgProductivity * 100,
                    productivityTrend: trend > 0 ? 'improving' : trend < 0 ? 'declining' : 'stable',
                    trendPercentage: Math.abs(trend * 100),
                    totalOnJobHours: timeBreakdown.reduce((sum, day) => sum + day.onJobHours, 0),
                    totalOffJobHours: timeBreakdown.reduce((sum, day) => sum + day.offJobHours, 0),
                    avgClientsPerDay: timeBreakdown.reduce((sum, day) => sum + day.uniqueClients, 0) / timeBreakdown.length
                }
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching time breakdown:', error);
        res.status(500).json({
            error: 'Failed to fetch time breakdown',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export default router;