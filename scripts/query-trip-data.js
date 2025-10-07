const { MongoClient } = require('mongodb');
const moment = require('moment-timezone');

class TripDataAnalyzer {
    constructor() {
        this.mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/sparklawn-fleet';
        this.client = null;
        this.db = null;
    }

    async connect() {
        this.client = new MongoClient(this.mongoUri);
        await this.client.connect();
        this.db = this.client.db();
        console.log('✅ Connected to MongoDB');
    }

    async disconnect() {
        if (this.client) {
            await this.client.close();
            console.log('✅ Disconnected from MongoDB');
        }
    }

    // Get all trips from last 2 weeks
    async getTripsLast2Weeks() {
        const twoWeeksAgo = new Date();
        twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
        
        const trips = await this.db.collection('ignition_trips').find({
            ignitionOnTime: { $gte: twoWeeksAgo.toISOString() }
        }).sort({ ignitionOnTime: 1 }).toArray();

        return trips;
    }

    // Get all route points from last 2 weeks
    async getRoutePointsLast2Weeks() {
        const twoWeeksAgo = new Date();
        twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
        
        const points = await this.db.collection('route_points').find({
            timestamp: { $gte: twoWeeksAgo.toISOString() }
        }).sort({ vehicleId: 1, timestamp: 1 }).toArray();

        return points;
    }

    // Analyze parking periods between trips
    async analyzeParkingPeriods(routePoints) {
        const vehicleData = {};
        
        // Group points by vehicle
        routePoints.forEach(point => {
            if (!vehicleData[point.vehicleId]) {
                vehicleData[point.vehicleId] = [];
            }
            vehicleData[point.vehicleId].push(point);
        });

        const parkingPeriods = [];

        for (const [vehicleId, points] of Object.entries(vehicleData)) {
            // Find gaps between location updates (parking periods)
            for (let i = 0; i < points.length - 1; i++) {
                const currentPoint = points[i];
                const nextPoint = points[i + 1];
                
                const timeDiff = new Date(nextPoint.timestamp) - new Date(currentPoint.timestamp);
                const hoursDiff = timeDiff / (1000 * 60 * 60);
                
                // If more than 1 hour gap and similar location, it's parking
                if (hoursDiff > 1) {
                    const distance = this.calculateDistance(
                        currentPoint.latitude, currentPoint.longitude,
                        nextPoint.latitude, nextPoint.longitude
                    );
                    
                    if (distance < 100) { // Within 100m = parked
                        parkingPeriods.push({
                            vehicleId,
                            startTime: currentPoint.timestamp,
                            endTime: nextPoint.timestamp,
                            duration: hoursDiff,
                            location: {
                                lat: currentPoint.latitude,
                                lng: currentPoint.longitude
                            },
                            ignitionStatus: currentPoint.ignitionStatus || 'OFF'
                        });
                    }
                }
            }
        }

        return parkingPeriods.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    }

    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371e3; // Earth's radius in meters
        const φ1 = lat1 * Math.PI/180;
        const φ2 = lat2 * Math.PI/180;
        const Δφ = (lat2-lat1) * Math.PI/180;
        const Δλ = (lon2-lon1) * Math.PI/180;

        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ/2) * Math.sin(Δλ/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        return R * c; // Distance in meters
    }

    formatDuration(hours) {
        if (hours < 1) {
            return `${Math.round(hours * 60)} minutes`;
        } else if (hours < 24) {
            const h = Math.floor(hours);
            const m = Math.round((hours - h) * 60);
            return `${h}h ${m}m`;
        } else {
            const days = Math.floor(hours / 24);
            const h = Math.floor(hours % 24);
            return `${days}d ${h}h`;
        }
    }

    async generateComprehensiveReport() {
        console.log('\n🚗 SPARKLAWN FLEET - 2-WEEK TRIP ANALYSIS REPORT');
        console.log('=' .repeat(80));
        
        // Get trips and route points
        const trips = await this.getTripsLast2Weeks();
        const routePoints = await this.getRoutePointsLast2Weeks();
        const parkingPeriods = await this.analyzeParkingPeriods(routePoints);

        console.log(`\n📊 SUMMARY STATISTICS`);
        console.log(`   Trips Found: ${trips.length}`);
        console.log(`   Route Points: ${routePoints.length}`);
        console.log(`   Parking Periods: ${parkingPeriods.length}`);
        
        // Vehicle breakdown
        const vehicleStats = {};
        routePoints.forEach(point => {
            if (!vehicleStats[point.vehicleId]) {
                vehicleStats[point.vehicleId] = 0;
            }
            vehicleStats[point.vehicleId]++;
        });
        
        console.log('\n🚙 VEHICLE ACTIVITY BREAKDOWN:');
        for (const [vehicleId, count] of Object.entries(vehicleStats)) {
            console.log(`   ${vehicleId}: ${count} GPS points`);
        }

        // Show all trips in detail
        console.log('\n🛣️  DETAILED TRIP RECORDS (Last 2 Weeks)');
        console.log('-'.repeat(80));
        
        if (trips.length === 0) {
            console.log('❌ No trips found in database for the last 2 weeks');
        } else {
            trips.forEach((trip, index) => {
                const startTime = moment(trip.ignitionOnTime).tz('America/Chicago');
                const endTime = moment(trip.ignitionOffTime).tz('America/Chicago');
                const duration = endTime.diff(startTime, 'minutes');
                
                console.log(`\n${index + 1}. TRIP - ${trip.vehicleName || trip.vehicleId}`);
                console.log(`   📅 Date: ${startTime.format('MMM DD, YYYY')}`);
                console.log(`   🕐 Start: ${startTime.format('h:mm A')} CT`);
                console.log(`   🕐 End: ${endTime.format('h:mm A')} CT`);
                console.log(`   ⏱️  Duration: ${duration} minutes`);
                console.log(`   📍 Start Location: ${trip.startLocation || 'N/A'}`);
                console.log(`   🏁 End Location: ${trip.endLocation || 'N/A'}`);
                console.log(`   🛣️  Distance: ${trip.distanceTraveled || 'N/A'} miles`);
                console.log(`   📊 Route Points: ${trip.routePoints ? trip.routePoints.length : 0}`);
                console.log(`   🔋 Battery Used: ${trip.batteryUsed || 'N/A'}%`);
            });
        }

        // Show parking analysis
        console.log('\n🅿️  PARKING ANALYSIS (Stationary Periods > 1 Hour)');
        console.log('-'.repeat(80));
        
        if (parkingPeriods.length === 0) {
            console.log('❌ No significant parking periods detected');
        } else {
            parkingPeriods.forEach((period, index) => {
                const startTime = moment(period.startTime).tz('America/Chicago');
                const endTime = moment(period.endTime).tz('America/Chicago');
                
                console.log(`\n${index + 1}. PARKED - ${period.vehicleId}`);
                console.log(`   📅 From: ${startTime.format('MMM DD h:mm A')}`);
                console.log(`   📅 To: ${endTime.format('MMM DD h:mm A')}`);
                console.log(`   ⏱️  Duration: ${this.formatDuration(period.duration)}`);
                console.log(`   📍 Location: ${period.location.lat}, ${period.location.lng}`);
                console.log(`   🔧 Status: ${period.ignitionStatus}`);
            });
        }

        // Time accounting summary
        console.log('\n⏰ TIME ACCOUNTING SUMMARY');
        console.log('-'.repeat(80));
        
        const totalTripMinutes = trips.reduce((sum, trip) => {
            const duration = moment(trip.ignitionOffTime).diff(moment(trip.ignitionOnTime), 'minutes');
            return sum + duration;
        }, 0);
        
        const totalParkingHours = parkingPeriods.reduce((sum, period) => sum + period.duration, 0);
        
        console.log(`📊 Total Trip Time: ${Math.round(totalTripMinutes)} minutes (${Math.round(totalTripMinutes/60 * 10)/10} hours)`);
        console.log(`📊 Total Parking Time: ${Math.round(totalParkingHours * 10)/10} hours`);
        console.log(`📊 Total Monitored Time: ${Math.round((totalTripMinutes/60 + totalParkingHours) * 10)/10} hours`);
        
        // Coverage analysis
        const fourteenDays = 14 * 24; // 336 hours in 2 weeks
        const monitoredHours = totalTripMinutes/60 + totalParkingHours;
        const coverage = (monitoredHours / fourteenDays * 100);
        
        console.log(`📈 Time Coverage: ${Math.round(coverage * 10)/10}% of last 14 days`);
        console.log(`⚠️  Unaccounted Time: ${Math.round((fourteenDays - monitoredHours) * 10)/10} hours`);

        return {
            trips,
            parkingPeriods,
            routePoints,
            stats: {
                totalTrips: trips.length,
                totalTripMinutes,
                totalParkingHours,
                coverage: Math.round(coverage * 10)/10
            }
        };
    }
}

async function main() {
    require('dotenv').config();
    
    const analyzer = new TripDataAnalyzer();
    
    try {
        await analyzer.connect();
        const report = await analyzer.generateComprehensiveReport();
        
        console.log('\n✅ Analysis Complete');
        console.log(`📝 Report generated for ${report.stats.totalTrips} trips and ${report.parkingPeriods.length} parking periods`);
        
    } catch (error) {
        console.error('❌ Error analyzing trip data:', error);
    } finally {
        await analyzer.disconnect();
    }
}

if (require.main === module) {
    main();
}

module.exports = TripDataAnalyzer;