import { CronJob } from 'cron';
import moment from 'moment-timezone';
import path from 'path';
import { dailyReportsService } from './dailyReportsService';
import { slackService } from './slackService';
import { pdfReportService } from './pdfReportService';

/**
 * Daily Slack Report Scheduler
 * Sends automated daily fleet reports to Slack channel
 */
class DailySlackReportScheduler {
    private cronJob: CronJob | null = null;
    private timezone = 'America/Chicago';

    /**
     * Start the daily report scheduler
     * Runs every day at 7:00 PM CST
     */
    async start(): Promise<void> {
        if (!slackService.isConfigured()) {
            console.log('⏭️ Slack not configured - daily report scheduler disabled');
            console.log('   Set SLACK_WEBHOOK_URL in .env to enable automated Slack reports');
            return;
        }

        // Initialize TTL index for report locks (auto-delete after expiry)
        try {
            const { getDatabase } = await import('../db/index');
            const db = await getDatabase();
            await db.collection('report_locks').createIndex(
                { expiresAt: 1 },
                { expireAfterSeconds: 0 }
            );
            console.log('✅ Report locks TTL index created');
        } catch (error) {
            console.error('❌ Failed to create report locks index:', error);
        }

        // Run every day at 7:00 PM CST (19:00)
        // Cron format: second minute hour day month dayOfWeek
        this.cronJob = new CronJob(
            '0 0 19 * * *', // 7:00 PM every day
            async () => {
                await this.sendDailyReport();
            },
            null, // onComplete
            true, // start immediately
            this.timezone
        );

        const nextRun = this.cronJob.nextDate().toFormat('MM/dd/yyyy h:mm a ZZZZ');
        console.log(`✅ Daily Slack report scheduler started`);
        console.log(`   📅 Next report: ${nextRun}`);
        console.log(`   🕐 Schedule: Every day at 7:00 PM CST`);
    }

    /**
     * Stop the scheduler
     */
    stop(): void {
        if (this.cronJob) {
            this.cronJob.stop();
            console.log('🛑 Daily Slack report scheduler stopped');
        }
    }

    /**
     * Send daily report for today (or specified date)
     */
    async sendDailyReport(date?: string): Promise<void> {
        try {
            // Default to today (send recap of today's activity at 7pm)
            const reportDate = date || moment.tz(this.timezone).format('YYYY-MM-DD');

            console.log(`📊 Generating daily Slack report for ${reportDate}...`);

            // Distributed lock: Prevent duplicate reports if multiple instances are running
            const { getDatabase } = await import('../db/index');
            const db = await getDatabase();
            const locksCollection = db.collection<{
                _id: string;
                acquiredAt: Date;
                expiresAt: Date;
            }>('report_locks');

            const lockKey = `slack_report_${reportDate}`;
            const lockExpiry = new Date(Date.now() + 60000); // Lock expires in 1 minute

            try {
                // Try to acquire lock
                await locksCollection.insertOne({
                    _id: lockKey,
                    acquiredAt: new Date(),
                    expiresAt: lockExpiry
                });
                console.log(`🔒 Acquired report lock for ${reportDate}`);
            } catch (error: any) {
                if (error.code === 11000) {
                    // Duplicate key error - another instance already sent the report
                    console.log(`⏭️ Report for ${reportDate} already sent by another instance`);
                    return;
                }
                throw error;
            }

            try {
                // Generate PDF report
                console.log(`📄 Generating PDF report for ${reportDate}...`);
                const pdfFilename = await pdfReportService.generateDailyReportPDF(reportDate);
                const pdfFilePath = path.join(__dirname, '../../public/reports', pdfFilename);

                // Format date for display
                const formattedDate = moment.tz(reportDate, this.timezone).format('dddd, MMMM DD, YYYY');

                // Upload PDF to Slack - title only, no summary message
                const titleMessage = `📊 *Daily Fleet Report - ${formattedDate}*`;

                console.log(`📤 Uploading PDF report to Slack...`);
                const uploaded = await slackService.uploadFile(
                    pdfFilePath,
                    titleMessage,
                    `Daily Fleet Report - ${formattedDate}`
                );

                if (uploaded) {
                    console.log(`✅ Daily Slack report sent successfully for ${reportDate}`);
                } else {
                    console.error(`❌ Failed to send daily Slack report for ${reportDate}`);
                }
            } finally {
                // ALWAYS release lock, even if report fails
                try {
                    await locksCollection.deleteOne({ _id: lockKey });
                    console.log(`🔓 Released report lock for ${reportDate}`);
                } catch (lockError) {
                    console.error(`⚠️ Failed to release lock for ${reportDate}:`, lockError);
                }
            }

        } catch (error) {
            console.error('❌ Error sending daily Slack report:', error);
        }
    }

    /**
     * Send test report for today
     */
    async sendTestReport(): Promise<void> {
        const today = moment.tz(this.timezone).format('YYYY-MM-DD');
        console.log(`🧪 Sending test Slack report for ${today}...`);
        await this.sendDailyReport(today);
    }

    /**
     * Get scheduler status
     */
    getStatus(): { running: boolean; nextRun?: string; schedule: string } {
        if (!this.cronJob) {
            return {
                running: false,
                schedule: 'Every day at 7:00 AM CST'
            };
        }

        return {
            running: true,
            nextRun: this.cronJob.nextDate().toFormat('MM/dd/yyyy h:mm a ZZZZ'),
            schedule: 'Every day at 7:00 AM CST'
        };
    }
}

export const dailySlackReportScheduler = new DailySlackReportScheduler();
