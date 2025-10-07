import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import moment from 'moment-timezone';
import { tripTimelineService } from './tripTimelineService';
import { generateDailyReportHTML, DailyReportData } from '../templates/dailyReportTemplate';

export class PDFReportService {
    private outputDir = path.join(__dirname, '../../public/reports');

    constructor() {
        // Ensure output directory exists
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    async generateDailyReportPDF(date: string): Promise<string> {
        // Fetch trip data for all vehicles
        const vehicleIds = [
            { id: '1FTVW1EL3NWG00285', name: 'Lightning 1' },
            { id: '1FT6W1EV3PWG37779', name: 'Lightning 2' },
            { id: '1FTVW1EV3NWG07402', name: 'Lightning 3' },
            { id: '1FTBW1XK6PKA30591', name: 'eTransit 1' }
        ];

        const startOfDay = moment.tz(date, 'America/Chicago').startOf('day').toDate();
        const endOfDay = moment.tz(date, 'America/Chicago').endOf('day').toDate();

        const vehicleData = [];
        let totalTrips = 0;
        let totalDistance = 0;
        let totalDuration = 0;
        let totalClientTime = 0;

        for (const vehicle of vehicleIds) {
            const timeline = await tripTimelineService.getTimelineForPeriod(vehicle.id, startOfDay, endOfDay);

            if (timeline.trips && timeline.trips.length > 0) {
                // Note: trip.duration is ALREADY in MINUTES from tripTimelineService
                const vehicleStats = {
                    totalTrips: timeline.trips.length,
                    totalDistance: timeline.trips.reduce((sum, t) => sum + (t.distance || 0), 0),
                    totalDuration: Math.round(timeline.trips.reduce((sum, t) => sum + (t.duration || 0), 0)), // Already in minutes
                    totalBatteryUsed: timeline.trips.reduce((sum, t) => sum + (t.batteryUsed || 0), 0)
                };

                // Calculate client time for this vehicle (only count dwell time between trips)
                let vehicleClientMinutes = 0;
                timeline.trips.forEach((trip: any, idx: number) => {
                    const nextTrip = timeline.trips[idx + 1];

                    // Only calculate client time if there's a next trip (don't count to end of day)
                    if (nextTrip && trip.endLocation && trip.endLocation.clientName) {
                        const isHomeBase = trip.endLocation.clientName.includes('🏠') ||
                                         trip.endLocation.clientName.includes('McRay Shop') ||
                                         trip.endLocation.address?.includes('McRay Shop');

                        if (!isHomeBase) {
                            const arrivalTime = new Date(trip.endTime);
                            const departureTime = new Date(nextTrip.startTime);

                            const dwellMinutes = Math.round((departureTime.getTime() - arrivalTime.getTime()) / (1000 * 60));
                            if (dwellMinutes > 5) {
                                vehicleClientMinutes += dwellMinutes;
                            }
                        }
                    }
                });

                vehicleData.push({
                    name: vehicle.name,
                    trips: timeline.trips.map(trip => ({
                        ...trip,
                        startTime: trip.startTime.toString(),
                        endTime: trip.endTime.toString()
                    })),
                    stats: vehicleStats
                });

                totalTrips += vehicleStats.totalTrips;
                totalDistance += vehicleStats.totalDistance;
                totalDuration += vehicleStats.totalDuration;
                totalClientTime += vehicleClientMinutes;
            }
        }

        // Build report data
        const reportData: DailyReportData = {
            date: moment.tz(date, 'America/Chicago').format('dddd, MMMM DD, YYYY'),
            vehicles: vehicleData,
            summary: {
                totalTrips,
                totalDistance,
                totalDuration,
                totalClientTime,
                activeVehicles: vehicleData.length
            }
        };

        // Generate HTML
        const html = generateDailyReportHTML(reportData);

        // Save HTML for preview
        const htmlFilename = `daily-report-${date}.html`;
        const htmlFilepath = path.join(this.outputDir, htmlFilename);
        fs.writeFileSync(htmlFilepath, html);
        console.log(`✅ HTML generated: ${htmlFilename}`);

        // Generate PDF from HTML
        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        try {
            const page = await browser.newPage();
            await page.setContent(html, { waitUntil: 'networkidle0' });

            // Generate PDF filename with date
            const pdfFilename = `daily-report-${date}.pdf`;
            const pdfFilepath = path.join(this.outputDir, pdfFilename);

            // Generate PDF
            await page.pdf({
                path: pdfFilepath,
                format: 'A4',
                printBackground: true,
                margin: {
                    top: '20px',
                    right: '20px',
                    bottom: '20px',
                    left: '20px'
                }
            });

            console.log(`✅ PDF generated: ${pdfFilename}`);
            return pdfFilename;

        } finally {
            await browser.close();
        }
    }

    getPublicURL(filename: string): string {
        return `http://localhost:3002/reports/${filename}`;
    }

    cleanupOldReports(daysToKeep: number = 30): void {
        const files = fs.readdirSync(this.outputDir);
        const now = Date.now();
        const maxAge = daysToKeep * 24 * 60 * 60 * 1000;

        files.forEach(file => {
            const filepath = path.join(this.outputDir, file);
            const stats = fs.statSync(filepath);
            const age = now - stats.mtimeMs;

            if (age > maxAge) {
                fs.unlinkSync(filepath);
                console.log(`🗑️ Deleted old report: ${file}`);
            }
        });
    }
}

export const pdfReportService = new PDFReportService();
