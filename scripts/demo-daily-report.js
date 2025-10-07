const { dailyReportsService } = require('../dist/services/dailyReportsService');
require('dotenv').config();

async function demonstrateDailyReports() {
    console.log('\n🚀 SMART ALERTS & DAILY REPORTS DEMO');
    console.log('═'.repeat(60));
    
    try {
        // Initialize the service
        await dailyReportsService.initialize();
        
        console.log('\n📊 Generating daily reports for dates with trip data...');
        
        // Generate reports for dates with known trip data
        const datesWithData = [
            '2025-08-22', // Has the 35-mile trip
            '2025-08-23',
            '2025-08-25',
            '2025-08-26',
            '2025-09-01',
            '2025-09-02',
            '2025-09-06'
        ];
        
        for (const date of datesWithData) {
            console.log(`\n🔍 Checking ${date} for activity...`);
            try {
                await dailyReportsService.printDailyReport(date);
            } catch (error) {
                if (error.message && error.message.includes('No activity found')) {
                    console.log(`   ℹ️ No activity found for ${date}`);
                } else {
                    console.error(`   ❌ Error generating report for ${date}:`, error.message);
                }
            }
        }
        
    } catch (error) {
        console.error('❌ Demo error:', error);
    } finally {
        await dailyReportsService.close();
        console.log('\n✅ Demo completed');
    }
}

// Run the demo
if (require.main === module) {
    demonstrateDailyReports();
}