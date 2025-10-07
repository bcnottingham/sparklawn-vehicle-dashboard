import { Router, Request, Response } from 'express';
import { pdfGenerationService, TripData, DailyReportData } from '../services/pdfGenerationService';
import { slackService } from '../services/slackService';
import { tripHistoryService } from '../services/tripHistoryService';
import * as path from 'path';
import * as fs from 'fs';

const router = Router();

// Directory for storing generated PDFs
const PDF_DIR = path.join(__dirname, '../../generated-pdfs');

// Ensure PDF directory exists
if (!fs.existsSync(PDF_DIR)) {
    fs.mkdirSync(PDF_DIR, { recursive: true });
}

/**
 * POST /api/pdf/trip/:tripId
 * Generate PDF for a specific trip
 */
router.post('/trip/:tripId', async (req: Request, res: Response) => {
    try {
        const { tripId } = req.params;
        const { download = false, slack = false } = req.query;

        // Fetch trip data
        const trip = await tripHistoryService.getTripById(tripId);

        if (!trip) {
            return res.status(404).json({
                error: 'Trip not found'
            });
        }

        // Convert to TripData format
        const tripData: TripData = {
            tripId: trip._id?.toString() || tripId,
            vehicleId: trip.vehicleId,
            vehicleName: trip.vehicleName || trip.vehicleId,
            startTime: typeof trip.startTime === 'string' ? trip.startTime : trip.startTime.toISOString(),
            endTime: trip.endTime ? (typeof trip.endTime === 'string' ? trip.endTime : trip.endTime.toISOString()) : new Date().toISOString(),
            duration: trip.duration || 0,
            distance: trip.distance || 0,
            stops: (trip as any).stops || [],
            route: (trip as any).route || []
        };

        // Generate PDF
        console.log(`📄 Generating PDF for trip ${tripId}...`);
        const pdfBuffer = await pdfGenerationService.generateTripPDF(tripData);

        // Save PDF
        const filename = `trip-${tripId}-${Date.now()}.pdf`;
        const filepath = path.join(PDF_DIR, filename);
        await pdfGenerationService.savePDF(pdfBuffer, filepath);

        // Send to Slack if requested
        if (slack === 'true' && slackService.isConfigured()) {
            await slackService.sendMessage(
                `📄 Trip report generated for ${tripData.vehicleName}\n` +
                `📍 ${tripData.stops?.length || 0} stops • ` +
                `📏 ${(tripData.distance / 1609.34).toFixed(1)} mi • ` +
                `⏱️ ${Math.floor(tripData.duration / 60)} minutes`
            );
        }

        // Return PDF or download link
        if (download === 'true') {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.send(pdfBuffer);
        } else {
            res.json({
                success: true,
                message: 'PDF generated successfully',
                filename,
                filepath,
                size: pdfBuffer.length,
                downloadUrl: `/api/pdf/download/${filename}`,
                tripId,
                vehicleName: tripData.vehicleName
            });
        }

    } catch (error) {
        console.error('Error generating trip PDF:', error);
        res.status(500).json({
            error: 'Failed to generate PDF',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * POST /api/pdf/daily-report
 * Generate daily fleet report PDF
 */
router.post('/daily-report', async (req: Request, res: Response) => {
    try {
        const { date, download = false, slack = false } = req.query;

        // Use provided date or default to today
        const reportDate = date ? new Date(date as string) : new Date();
        const dateStr = reportDate.toISOString().split('T')[0];

        // Fetch all trips for the date
        const allTrips = await tripHistoryService.getTripHistory(undefined, 1000);

        // Filter trips for the specified date
        const dayTrips = allTrips.filter((trip: any) => {
            const tripDate = new Date(trip.startTime).toISOString().split('T')[0];
            return tripDate === dateStr;
        });

        if (dayTrips.length === 0) {
            return res.status(404).json({
                error: 'No trips found for this date',
                date: dateStr
            });
        }

        // Group trips by vehicle
        const vehicleMap = new Map<string, any[]>();
        dayTrips.forEach((trip: any) => {
            const vehicleId = trip.vehicleId;
            if (!vehicleMap.has(vehicleId)) {
                vehicleMap.set(vehicleId, []);
            }
            vehicleMap.get(vehicleId)!.push(trip);
        });

        // Calculate summary statistics
        let totalDistance = 0;
        let totalDuration = 0;
        let totalStops = 0;

        const vehicles = Array.from(vehicleMap.entries()).map(([vehicleId, trips]) => {
            const vehicleDistance = trips.reduce((sum, trip) => sum + (trip.distance || 0), 0);
            const vehicleDuration = trips.reduce((sum, trip) => sum + (trip.duration || 0), 0);
            const vehicleStops = trips.reduce((sum, trip) => sum + (trip.stops?.length || 0), 0);

            totalDistance += vehicleDistance;
            totalDuration += vehicleDuration;
            totalStops += vehicleStops;

            return {
                vehicleId,
                vehicleName: trips[0].vehicleName || vehicleId,
                trips: trips.map(trip => ({
                    tripId: trip._id?.toString() || '',
                    vehicleId: trip.vehicleId,
                    vehicleName: trip.vehicleName || vehicleId,
                    startTime: trip.startTime,
                    endTime: trip.endTime || new Date().toISOString(),
                    duration: trip.duration || 0,
                    distance: trip.distance || 0,
                    stops: trip.stops || [],
                    route: trip.route || []
                })),
                totalDistance: vehicleDistance,
                totalDuration: vehicleDuration,
                activeTime: `${Math.floor(vehicleDuration / 3600)}h ${Math.floor((vehicleDuration % 3600) / 60)}m`
            };
        });

        // Build report data
        const reportData: DailyReportData = {
            date: reportDate.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric'
            }),
            vehicles,
            summary: {
                totalTrips: dayTrips.length,
                totalDistance,
                totalDuration,
                totalStops
            }
        };

        // Generate PDF
        console.log(`📊 Generating daily report PDF for ${dateStr}...`);
        const pdfBuffer = await pdfGenerationService.generateDailyReportPDF(reportData);

        // Save PDF
        const filename = `daily-report-${dateStr}.pdf`;
        const filepath = path.join(PDF_DIR, filename);
        await pdfGenerationService.savePDF(pdfBuffer, filepath);

        // Send to Slack if requested
        if (slack === 'true' && slackService.isConfigured()) {
            await slackService.sendDailyFleetReport({
                date: reportData.date,
                totalTrips: reportData.summary.totalTrips,
                totalDistance: reportData.summary.totalDistance,
                totalDuration: reportData.summary.totalDuration,
                vehicles: vehicles.map(v => ({
                    name: v.vehicleName,
                    trips: v.trips.length,
                    distance: v.totalDistance,
                    duration: v.totalDuration
                })),
                pdfPath: filepath
            });
        }

        // Return PDF or download link
        if (download === 'true') {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.send(pdfBuffer);
        } else {
            res.json({
                success: true,
                message: 'Daily report PDF generated successfully',
                filename,
                filepath,
                size: pdfBuffer.length,
                downloadUrl: `/api/pdf/download/${filename}`,
                date: dateStr,
                summary: reportData.summary,
                vehicleCount: vehicles.length
            });
        }

    } catch (error) {
        console.error('Error generating daily report PDF:', error);
        res.status(500).json({
            error: 'Failed to generate daily report PDF',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * GET /api/pdf/download/:filename
 * Download a previously generated PDF
 */
router.get('/download/:filename', async (req: Request, res: Response) => {
    try {
        const { filename } = req.params;

        // Security: Prevent directory traversal
        const safeName = path.basename(filename);
        const filepath = path.join(PDF_DIR, safeName);

        // Check if file exists
        if (!fs.existsSync(filepath)) {
            return res.status(404).json({
                error: 'PDF not found'
            });
        }

        // Read and send PDF
        const pdfBuffer = fs.readFileSync(filepath);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
        res.send(pdfBuffer);

    } catch (error) {
        console.error('Error downloading PDF:', error);
        res.status(500).json({
            error: 'Failed to download PDF',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * GET /api/pdf/list
 * List all generated PDFs
 */
router.get('/list', async (req: Request, res: Response) => {
    try {
        const files = fs.readdirSync(PDF_DIR)
            .filter(f => f.endsWith('.pdf'))
            .map(filename => {
                const filepath = path.join(PDF_DIR, filename);
                const stats = fs.statSync(filepath);
                return {
                    filename,
                    size: stats.size,
                    created: stats.birthtime,
                    modified: stats.mtime,
                    downloadUrl: `/api/pdf/download/${filename}`
                };
            })
            .sort((a, b) => b.created.getTime() - a.created.getTime());

        res.json({
            total: files.length,
            pdfs: files
        });

    } catch (error) {
        console.error('Error listing PDFs:', error);
        res.status(500).json({
            error: 'Failed to list PDFs',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * DELETE /api/pdf/:filename
 * Delete a generated PDF
 */
router.delete('/:filename', async (req: Request, res: Response) => {
    try {
        const { filename } = req.params;

        // Security: Prevent directory traversal
        const safeName = path.basename(filename);
        const filepath = path.join(PDF_DIR, safeName);

        // Check if file exists
        if (!fs.existsSync(filepath)) {
            return res.status(404).json({
                error: 'PDF not found'
            });
        }

        // Delete file
        fs.unlinkSync(filepath);

        res.json({
            success: true,
            message: 'PDF deleted successfully',
            filename: safeName
        });

    } catch (error) {
        console.error('Error deleting PDF:', error);
        res.status(500).json({
            error: 'Failed to delete PDF',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * POST /api/pdf/test-slack
 * Test Slack integration
 */
router.post('/test-slack', async (req: Request, res: Response) => {
    try {
        if (!slackService.isConfigured()) {
            return res.status(400).json({
                error: 'Slack is not configured',
                message: 'Please set SLACK_WEBHOOK_URL environment variable'
            });
        }

        const success = await slackService.sendTestMessage();

        if (success) {
            res.json({
                success: true,
                message: 'Test message sent to Slack successfully'
            });
        } else {
            res.status(500).json({
                error: 'Failed to send test message to Slack'
            });
        }

    } catch (error) {
        console.error('Error testing Slack integration:', error);
        res.status(500).json({
            error: 'Failed to test Slack integration',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export default router;
