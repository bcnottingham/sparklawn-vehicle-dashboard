import puppeteer from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';

export interface TripData {
    tripId: string;
    vehicleId: string;
    vehicleName: string;
    startTime: string;
    endTime: string;
    duration: number;
    distance: number;
    stops: any[];
    route: any[];
    [key: string]: any;
}

export interface DailyReportData {
    date: string;
    vehicles: Array<{
        vehicleId: string;
        vehicleName: string;
        trips: TripData[];
        totalDistance: number;
        totalDuration: number;
        activeTime: string;
    }>;
    summary: {
        totalTrips: number;
        totalDistance: number;
        totalDuration: number;
        totalStops: number;
    };
}

class PDFGenerationService {
    private browser: any = null;

    /**
     * Initialize Puppeteer browser instance (shared for performance)
     */
    async initBrowser() {
        if (!this.browser) {
            this.browser = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage', // Overcome limited resource problems
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process', // Needed for some server environments
                    '--disable-gpu'
                ]
            });
            console.log('🌐 Puppeteer browser initialized for PDF generation');
        }
        return this.browser;
    }

    /**
     * Close the browser instance (call on app shutdown)
     */
    async closeBrowser() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            console.log('🔒 Puppeteer browser closed');
        }
    }

    /**
     * Generate PDF from HTML content
     */
    async generatePDFFromHTML(html: string, options: any = {}): Promise<Buffer> {
        const browser = await this.initBrowser();
        const page = await browser.newPage();

        try {
            // Set HTML content
            await page.setContent(html, {
                waitUntil: 'networkidle0', // Wait for all resources to load
                timeout: 30000
            });

            // Generate PDF
            const pdfBuffer = await page.pdf({
                format: options.format || 'A4',
                printBackground: true, // Include background colors/images
                margin: options.margin || {
                    top: '20px',
                    right: '20px',
                    bottom: '20px',
                    left: '20px'
                },
                preferCSSPageSize: false,
                ...options
            });

            return Buffer.from(pdfBuffer);
        } finally {
            await page.close();
        }
    }

    /**
     * Generate trip detail PDF from trip data
     */
    async generateTripPDF(tripData: TripData): Promise<Buffer> {
        const html = this.generateTripHTML(tripData);
        return this.generatePDFFromHTML(html, {
            format: 'A4',
            landscape: false
        });
    }

    /**
     * Generate daily report PDF from daily report data
     */
    async generateDailyReportPDF(reportData: DailyReportData): Promise<Buffer> {
        const html = this.generateDailyReportHTML(reportData);
        return this.generatePDFFromHTML(html, {
            format: 'A4',
            landscape: true // Better for tables
        });
    }

    /**
     * Save PDF to file system
     */
    async savePDF(pdfBuffer: Buffer, filepath: string): Promise<string> {
        const dir = path.dirname(filepath);

        // Ensure directory exists
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Write PDF to file
        fs.writeFileSync(filepath, pdfBuffer);
        console.log(`📄 PDF saved to: ${filepath}`);

        return filepath;
    }

    /**
     * Generate HTML for trip detail modal (simplified, production-ready template)
     */
    private generateTripHTML(tripData: TripData): string {
        const formatDuration = (seconds: number): string => {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            return `${hours}h ${minutes}m`;
        };

        const formatDistance = (meters: number): string => {
            const miles = (meters / 1609.34).toFixed(1);
            return `${miles} mi`;
        };

        const formatTime = (isoString: string): string => {
            const date = new Date(isoString);
            return date.toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
        };

        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Trip Report - ${tripData.vehicleName}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f8fafc;
            padding: 30px;
            color: #1e293b;
            font-size: 12px;
        }
        .header {
            background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%);
            color: white;
            padding: 25px 30px;
            border-radius: 10px;
            margin-bottom: 25px;
        }
        .header h1 {
            font-size: 22px;
            margin-bottom: 8px;
        }
        .header .subtitle {
            font-size: 13px;
            opacity: 0.9;
        }
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 15px;
            margin-bottom: 25px;
        }
        .stat-card {
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 15px;
            text-align: center;
        }
        .stat-value {
            font-size: 20px;
            font-weight: 700;
            color: #3b82f6;
            margin-bottom: 5px;
        }
        .stat-label {
            font-size: 11px;
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .section {
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
        }
        .section-title {
            font-size: 14px;
            font-weight: 600;
            color: #f59e0b;
            margin-bottom: 15px;
            border-bottom: 2px solid #f59e0b;
            padding-bottom: 8px;
        }
        .stop-item {
            padding: 12px;
            background: #f8fafc;
            border-left: 3px solid #10b981;
            margin-bottom: 10px;
            border-radius: 4px;
        }
        .stop-name {
            font-weight: 600;
            color: #1e293b;
            margin-bottom: 4px;
        }
        .stop-address {
            font-size: 11px;
            color: #64748b;
            margin-bottom: 4px;
        }
        .stop-time {
            font-size: 10px;
            color: #94a3b8;
        }
        .footer {
            text-align: center;
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #e2e8f0;
            font-size: 10px;
            color: #94a3b8;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🚗 Trip Report</h1>
        <div class="subtitle">${tripData.vehicleName} • ${formatTime(tripData.startTime)}</div>
    </div>

    <div class="summary-grid">
        <div class="stat-card">
            <div class="stat-value">${formatDistance(tripData.distance)}</div>
            <div class="stat-label">Total Distance</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${formatDuration(tripData.duration)}</div>
            <div class="stat-label">Duration</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${tripData.stops?.length || 0}</div>
            <div class="stat-label">Stops</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${formatTime(tripData.endTime)}</div>
            <div class="stat-label">Ended</div>
        </div>
    </div>

    ${tripData.stops && tripData.stops.length > 0 ? `
    <div class="section">
        <div class="section-title">📍 Stops & Visits</div>
        ${tripData.stops.map((stop: any) => `
            <div class="stop-item">
                <div class="stop-name">${stop.name || 'Unknown Location'}</div>
                <div class="stop-address">${stop.address || 'Address not available'}</div>
                <div class="stop-time">
                    Arrived: ${formatTime(stop.arrivalTime)} •
                    Duration: ${formatDuration(stop.duration || 0)}
                </div>
            </div>
        `).join('')}
    </div>
    ` : ''}

    <div class="footer">
        Generated on ${new Date().toLocaleString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        })} • SparkLawn Fleet Dashboard
    </div>
</body>
</html>
        `.trim();
    }

    /**
     * Generate HTML for daily report (simplified template)
     */
    private generateDailyReportHTML(reportData: DailyReportData): string {
        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Daily Fleet Report - ${reportData.date}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f8fafc;
            padding: 25px;
            color: #1e293b;
            font-size: 11px;
        }
        .header {
            background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%);
            color: white;
            padding: 20px 25px;
            border-radius: 8px;
            margin-bottom: 20px;
        }
        .header h1 {
            font-size: 20px;
            margin-bottom: 6px;
        }
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 12px;
            margin-bottom: 20px;
        }
        .stat-card {
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            padding: 12px;
            text-align: center;
        }
        .stat-value {
            font-size: 18px;
            font-weight: 700;
            color: #3b82f6;
        }
        .stat-label {
            font-size: 10px;
            color: #64748b;
            text-transform: uppercase;
        }
        .vehicle-section {
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            padding: 15px;
            margin-bottom: 15px;
            page-break-inside: avoid;
        }
        .vehicle-header {
            font-size: 14px;
            font-weight: 600;
            color: #1e293b;
            margin-bottom: 10px;
            border-bottom: 2px solid #10b981;
            padding-bottom: 6px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 10px;
        }
        th {
            background: #f1f5f9;
            padding: 8px;
            text-align: left;
            font-weight: 600;
            color: #475569;
            border-bottom: 2px solid #cbd5e1;
        }
        td {
            padding: 8px;
            border-bottom: 1px solid #e2e8f0;
        }
        tr:last-child td {
            border-bottom: none;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>📊 Daily Fleet Report</h1>
        <div>${reportData.date}</div>
    </div>

    <div class="summary-grid">
        <div class="stat-card">
            <div class="stat-value">${reportData.summary.totalTrips}</div>
            <div class="stat-label">Total Trips</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${(reportData.summary.totalDistance / 1609.34).toFixed(1)} mi</div>
            <div class="stat-label">Total Distance</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${Math.floor(reportData.summary.totalDuration / 3600)}h</div>
            <div class="stat-label">Total Duration</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${reportData.summary.totalStops}</div>
            <div class="stat-label">Total Stops</div>
        </div>
    </div>

    ${reportData.vehicles.map(vehicle => `
        <div class="vehicle-section">
            <div class="vehicle-header">🚗 ${vehicle.vehicleName}</div>
            <table>
                <thead>
                    <tr>
                        <th>Trip</th>
                        <th>Start Time</th>
                        <th>End Time</th>
                        <th>Distance</th>
                        <th>Duration</th>
                        <th>Stops</th>
                    </tr>
                </thead>
                <tbody>
                    ${vehicle.trips.map((trip, idx) => `
                        <tr>
                            <td>#${idx + 1}</td>
                            <td>${new Date(trip.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</td>
                            <td>${new Date(trip.endTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</td>
                            <td>${(trip.distance / 1609.34).toFixed(1)} mi</td>
                            <td>${Math.floor(trip.duration / 60)}m</td>
                            <td>${trip.stops?.length || 0}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `).join('')}

    <div style="text-align: center; margin-top: 20px; padding-top: 15px; border-top: 1px solid #e2e8f0; font-size: 9px; color: #94a3b8;">
        Generated on ${new Date().toLocaleString()} • SparkLawn Fleet Dashboard
    </div>
</body>
</html>
        `.trim();
    }
}

export const pdfGenerationService = new PDFGenerationService();
