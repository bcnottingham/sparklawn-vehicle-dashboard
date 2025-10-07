import gmailInvoiceExtractor from './gmailInvoiceExtractor';

/**
 * Scheduled service for daily automated invoice and payment extraction
 * Runs daily at 2:00 AM to extract new invoices/receipts from the last 24 hours
 */
export class ScheduledInvoiceExtraction {
    private dailyExtractionInterval: NodeJS.Timeout | null = null;

    /**
     * Start the scheduled daily extraction
     */
    startDailyExtraction(): void {
        console.log('📅 Starting scheduled invoice extraction service...');

        // Calculate time until next 2:00 AM
        const now = new Date();
        const next2AM = new Date();
        next2AM.setHours(2, 0, 0, 0);

        // If 2 AM has already passed today, schedule for tomorrow
        if (now > next2AM) {
            next2AM.setDate(next2AM.getDate() + 1);
        }

        const msUntilNext2AM = next2AM.getTime() - now.getTime();

        console.log(`⏰ Next automated extraction scheduled for: ${next2AM.toLocaleString()}`);
        console.log(`⏱️  Time until next extraction: ${Math.round(msUntilNext2AM / 1000 / 60 / 60)} hours`);

        // Schedule first extraction
        setTimeout(() => {
            this.runDailyExtraction();

            // Then schedule to run every 24 hours
            this.dailyExtractionInterval = setInterval(() => {
                this.runDailyExtraction();
            }, 24 * 60 * 60 * 1000); // 24 hours
        }, msUntilNext2AM);
    }

    /**
     * Stop the scheduled extraction
     */
    stopDailyExtraction(): void {
        if (this.dailyExtractionInterval) {
            clearInterval(this.dailyExtractionInterval);
            this.dailyExtractionInterval = null;
            console.log('🛑 Stopped scheduled invoice extraction');
        }
    }

    /**
     * Run the daily extraction for new invoices/receipts from last 24 hours
     */
    private async runDailyExtraction(): Promise<void> {
        try {
            console.log('\n═══════════════════════════════════════════════');
            console.log('🤖 AUTOMATED DAILY INVOICE EXTRACTION STARTED');
            console.log(`⏰ Time: ${new Date().toLocaleString()}`);
            console.log('═══════════════════════════════════════════════\n');

            // Calculate date range for last 24 hours
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 1); // Yesterday

            const startDateStr = this.formatDateForGmail(startDate);
            const endDateStr = this.formatDateForGmail(endDate);

            console.log(`📅 Extracting invoices/receipts from: ${startDateStr} to ${endDateStr}`);

            // Extract invoices
            console.log('\n📄 Extracting invoices...');
            const invoiceResults = await gmailInvoiceExtractor.extractAllInvoices(startDate, endDate);
            console.log(`✅ Invoice extraction complete: ${invoiceResults.length} invoices processed`);

            // Extract payment receipts
            console.log('\n💰 Extracting payment receipts...');
            const paymentResults = await gmailInvoiceExtractor.extractPaymentReceipts(startDate, endDate);
            console.log(`✅ Payment extraction complete: ${paymentResults.length} payments processed`);

            console.log('\n═══════════════════════════════════════════════');
            console.log('✅ AUTOMATED DAILY EXTRACTION COMPLETE');
            console.log(`📊 Summary: ${invoiceResults.length} invoices, ${paymentResults.length} payments`);
            console.log(`⏰ Next extraction: ${new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleString()}`);
            console.log('═══════════════════════════════════════════════\n');

        } catch (error) {
            console.error('❌ Automated extraction failed:', error);
        }
    }

    /**
     * Format date for Gmail API search (YYYY/MM/DD)
     */
    private formatDateForGmail(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}/${month}/${day}`;
    }

    /**
     * Manually trigger extraction (for testing)
     */
    async manualExtraction(days: number = 1): Promise<void> {
        console.log(`\n🔧 Manual extraction triggered for last ${days} day(s)`);

        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const invoiceResults = await gmailInvoiceExtractor.extractAllInvoices(startDate, endDate);
        const paymentResults = await gmailInvoiceExtractor.extractPaymentReceipts(startDate, endDate);

        console.log(`✅ Manual extraction complete:`);
        console.log(`   Invoices: ${invoiceResults.length} processed`);
        console.log(`   Payments: ${paymentResults.length} processed`);
    }
}

export const scheduledInvoiceExtraction = new ScheduledInvoiceExtraction();
