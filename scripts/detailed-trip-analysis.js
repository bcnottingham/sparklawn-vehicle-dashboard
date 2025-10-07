const { MongoClient } = require('mongodb');
const moment = require('moment-timezone');
const axios = require('axios');
require('dotenv').config();

class DetailedTripAnalyzer {
    constructor() {
        this.mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/sparklawn-fleet';
        this.googleApiKey = process.env.GOOGLE_MAPS_API_KEY;
        this.client = null;
        this.db = null;
        this.locationCache = new Map();
    }

    async connect() {
        this.client = new MongoClient(this.mongoUri);
        await this.client.connect();
        this.db = this.client.db();
    }

    async disconnect() {
        if (this.client) {
            await this.client.close();
        }
    }

    // Geocode location using Google Maps API
    async geocodeLocation(lat, lng) {
        const key = `${lat},${lng}`;
        if (this.locationCache.has(key)) {
            return this.locationCache.get(key);
        }

        try {
            if (!this.googleApiKey) {
                return `${lat}, ${lng}`;
            }

            const response = await axios.get(`https://maps.googleapis.com/maps/api/geocode/json`, {
                params: {
                    latlng: `${lat},${lng}`,
                    key: this.googleApiKey
                }
            });

            let locationName = `${lat}, ${lng}`;
            
            if (response.data.status === 'OK' && response.data.results.length > 0) {
                const result = response.data.results[0];
                locationName = result.formatted_address;
                
                // Try to get a more specific business name if available
                const businessResult = response.data.results.find(r => 
                    r.types.includes('establishment') || 
                    r.types.includes('point_of_interest')
                );
                
                if (businessResult) {
                    locationName = businessResult.name || businessResult.formatted_address;
                }
            }
            
            this.locationCache.set(key, locationName);
            
            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
            
            return locationName;
        } catch (error) {
            console.error(`❌ Geocoding error for ${lat}, ${lng}:`, error.message);
            return `${lat}, ${lng}`;
        }
    }

    // Calculate distance between two points in meters
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

        return R * c;
    }

    // Analyze parking periods from route points
    async analyzeParkingPeriodsFromRoutePoints() {
        const routePoints = await this.db.collection('route_points')
            .find()
            .sort({ vehicleId: 1, timestamp: 1 })
            .toArray();

        const parkingPeriods = [];
        const vehicleData = {};

        // Group by vehicle
        routePoints.forEach(point => {
            if (!vehicleData[point.vehicleId]) {
                vehicleData[point.vehicleId] = [];
            }
            vehicleData[point.vehicleId].push(point);
        });

        for (const [vehicleId, points] of Object.entries(vehicleData)) {
            console.log(`\n🔍 Analyzing parking for ${vehicleId} (${points.length} points)...`);
            
            let currentLocation = null;
            let locationStartTime = null;

            for (let i = 0; i < points.length; i++) {
                const point = points[i];
                
                if (!currentLocation) {
                    currentLocation = { lat: point.latitude, lng: point.longitude };
                    locationStartTime = point.timestamp;
                    continue;
                }

                // Check if vehicle moved significantly (>50m)
                const distance = this.calculateDistance(
                    currentLocation.lat, currentLocation.lng,
                    point.latitude, point.longitude
                );

                const timeDiff = (new Date(point.timestamp) - new Date(locationStartTime)) / (1000 * 60 * 60); // hours

                // If vehicle moved >50m or we're at the last point, end current parking period
                if (distance > 50 || i === points.length - 1) {
                    if (timeDiff >= 0.5) { // At least 30 minutes
                        const endTime = i === points.length - 1 ? point.timestamp : points[i-1].timestamp;
                        const actualDuration = (new Date(endTime) - new Date(locationStartTime)) / (1000 * 60 * 60);
                        
                        parkingPeriods.push({
                            vehicleId,
                            startTime: locationStartTime,
                            endTime: endTime,
                            duration: actualDuration,
                            location: currentLocation,
                            ignitionStatus: 'OFF' // Most parking is ignition off
                        });
                    }

                    // Start new location
                    currentLocation = { lat: point.latitude, lng: point.longitude };
                    locationStartTime = point.timestamp;
                }
            }
        }

        return parkingPeriods.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
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
            const m = Math.round(((hours % 24) - h) * 60);
            return `${days}d ${h}h ${m}m`;
        }
    }

    async generateComprehensiveReport() {
        console.log('\n🚗 SPARKLAWN FLEET - COMPREHENSIVE TRIP & LOCATION ANALYSIS');
        console.log('=' .repeat(90));
        console.log(`📅 Report Generated: ${moment().tz('America/Chicago').format('MMMM DD, YYYY h:mm A')} CT`);
        
        // Get all data
        const trips = await this.db.collection('ignition_trips').find().sort({ignitionOnTime: 1}).toArray();
        const routePoints = await this.db.collection('route_points').find().sort({timestamp: 1}).toArray();
        const parkingPeriods = await this.analyzeParkingPeriodsFromRoutePoints();

        console.log(`\n📊 DATA SUMMARY:`);
        console.log(`   Total Trips: ${trips.length}`);
        console.log(`   Total Route Points: ${routePoints.length}`);
        console.log(`   Parking Periods: ${parkingPeriods.length}`);

        // Vehicle activity summary
        const vehicleStats = {};
        routePoints.forEach(point => {
            if (!vehicleStats[point.vehicleId]) {
                vehicleStats[point.vehicleId] = { points: 0, firstSeen: point.timestamp, lastSeen: point.timestamp };
            }
            vehicleStats[point.vehicleId].points++;
            if (point.timestamp < vehicleStats[point.vehicleId].firstSeen) {
                vehicleStats[point.vehicleId].firstSeen = point.timestamp;
            }
            if (point.timestamp > vehicleStats[point.vehicleId].lastSeen) {
                vehicleStats[point.vehicleId].lastSeen = point.timestamp;
            }
        });

        console.log(`\n🚙 VEHICLE MONITORING SUMMARY:`);
        for (const [vehicleId, stats] of Object.entries(vehicleStats)) {
            const duration = (new Date(stats.lastSeen) - new Date(stats.firstSeen)) / (1000 * 60 * 60 * 24);
            console.log(`   ${vehicleId}:`);
            console.log(`      GPS Points: ${stats.points}`);
            console.log(`      Monitoring Period: ${duration.toFixed(1)} days`);
            console.log(`      First Seen: ${moment(stats.firstSeen).tz('America/Chicago').format('MMM DD h:mm A')}`);
            console.log(`      Last Seen: ${moment(stats.lastSeen).tz('America/Chicago').format('MMM DD h:mm A')}`);
        }

        // DETAILED TRIPS WITH GEOCODING
        console.log(`\n🛣️  DETAILED TRIP ANALYSIS WITH LOCATIONS`);
        console.log('-'.repeat(90));
        
        for (let i = 0; i < trips.length; i++) {
            const trip = trips[i];
            const startTime = moment(trip.ignitionOnTime).tz('America/Chicago');
            const endTime = moment(trip.ignitionOffTime).tz('America/Chicago');
            
            console.log(`\n${i + 1}. 🚗 ${trip.vehicleName || trip.vehicleId}`);
            console.log(`   📅 ${startTime.format('dddd, MMM DD, YYYY')}`);
            console.log(`   🕐 ${startTime.format('h:mm:ss A')} → ${endTime.format('h:mm:ss A')} CT`);
            console.log(`   ⏱️  Duration: ${trip.totalRunTime} minutes`);
            console.log(`   📏 Distance: ${trip.distanceTraveled || 0} miles`);
            console.log(`   🔋 Battery Used: ${trip.batteryUsed || 'N/A'}%`);
            
            // Geocode start and end locations
            if (trip.startLocation && trip.startLocation.latitude) {
                const startLocationName = await this.geocodeLocation(
                    trip.startLocation.latitude, 
                    trip.startLocation.longitude
                );
                console.log(`   📍 START: ${startLocationName}`);
                console.log(`      GPS: (${trip.startLocation.latitude}, ${trip.startLocation.longitude})`);
            }
            
            if (trip.endLocation && trip.endLocation.latitude) {
                const endLocationName = await this.geocodeLocation(
                    trip.endLocation.latitude, 
                    trip.endLocation.longitude
                );
                console.log(`   🏁 END: ${endLocationName}`);
                console.log(`      GPS: (${trip.endLocation.latitude}, ${trip.endLocation.longitude})`);
            }
            
            // If start and end are different, show trip movement
            if (trip.startLocation && trip.endLocation && 
                trip.startLocation.latitude && trip.endLocation.latitude) {
                const tripDistance = this.calculateDistance(
                    trip.startLocation.latitude, trip.startLocation.longitude,
                    trip.endLocation.latitude, trip.endLocation.longitude
                );
                console.log(`   📐 Straight-line Distance: ${Math.round(tripDistance)}m`);
            }
        }

        // PARKING ANALYSIS WITH GEOCODING
        console.log(`\n🅿️  DETAILED PARKING ANALYSIS`);
        console.log('-'.repeat(90));
        
        for (let i = 0; i < parkingPeriods.length; i++) {
            const period = parkingPeriods[i];
            const startTime = moment(period.startTime).tz('America/Chicago');
            const endTime = moment(period.endTime).tz('America/Chicago');
            
            console.log(`\n${i + 1}. 🅿️ ${period.vehicleId}`);
            console.log(`   📅 ${startTime.format('dddd, MMM DD')} → ${endTime.format('dddd, MMM DD, YYYY')}`);
            console.log(`   🕐 ${startTime.format('h:mm A')} → ${endTime.format('h:mm A')} CT`);
            console.log(`   ⏱️  Duration: ${this.formatDuration(period.duration)}`);
            
            // Geocode parking location
            const locationName = await this.geocodeLocation(
                period.location.lat, 
                period.location.lng
            );
            console.log(`   📍 LOCATION: ${locationName}`);
            console.log(`      GPS: (${period.location.lat}, ${period.location.lng})`);
            console.log(`   🔧 Status: ${period.ignitionStatus}`);
        }

        // TIME ACCOUNTING
        console.log(`\n⏰ COMPREHENSIVE TIME ACCOUNTING`);
        console.log('-'.repeat(90));
        
        const totalTripMinutes = trips.reduce((sum, trip) => sum + (trip.totalRunTime || 0), 0);
        const totalParkingHours = parkingPeriods.reduce((sum, period) => sum + period.duration, 0);
        
        // Calculate monitoring period
        const firstPoint = routePoints[0];
        const lastPoint = routePoints[routePoints.length - 1];
        const monitoringPeriodHours = firstPoint && lastPoint ? 
            (new Date(lastPoint.timestamp) - new Date(firstPoint.timestamp)) / (1000 * 60 * 60) : 0;
        
        console.log(`📊 Trip Time: ${this.formatDuration(totalTripMinutes / 60)} (${trips.length} trips)`);
        console.log(`📊 Parking Time: ${this.formatDuration(totalParkingHours)} (${parkingPeriods.length} periods)`);
        console.log(`📊 Total Accounted: ${this.formatDuration(totalTripMinutes / 60 + totalParkingHours)}`);
        console.log(`📊 Monitoring Period: ${this.formatDuration(monitoringPeriodHours)}`);
        
        if (monitoringPeriodHours > 0) {
            const accountedPercentage = ((totalTripMinutes / 60 + totalParkingHours) / monitoringPeriodHours) * 100;
            console.log(`📈 Time Coverage: ${accountedPercentage.toFixed(1)}%`);
            
            const unaccountedHours = monitoringPeriodHours - (totalTripMinutes / 60 + totalParkingHours);
            console.log(`⚠️  Unaccounted Time: ${this.formatDuration(unaccountedHours)}`);
        }

        // Daily breakdown
        console.log(`\n📅 DAILY ACTIVITY BREAKDOWN`);
        console.log('-'.repeat(90));
        
        const dailyActivity = {};
        
        // Add trips to daily activity
        trips.forEach(trip => {
            const date = moment(trip.ignitionOnTime).tz('America/Chicago').format('YYYY-MM-DD');
            if (!dailyActivity[date]) {
                dailyActivity[date] = { trips: [], parking: [], tripMinutes: 0, parkingHours: 0 };
            }
            dailyActivity[date].trips.push(trip);
            dailyActivity[date].tripMinutes += trip.totalRunTime || 0;
        });

        // Add parking to daily activity
        parkingPeriods.forEach(period => {
            const startDate = moment(period.startTime).tz('America/Chicago').format('YYYY-MM-DD');
            const endDate = moment(period.endTime).tz('America/Chicago').format('YYYY-MM-DD');
            
            // For multi-day parking, split across days
            if (startDate === endDate) {
                if (!dailyActivity[startDate]) {
                    dailyActivity[startDate] = { trips: [], parking: [], tripMinutes: 0, parkingHours: 0 };
                }
                dailyActivity[startDate].parking.push(period);
                dailyActivity[startDate].parkingHours += period.duration;
            } else {
                // Handle multi-day parking (split proportionally)
                const startOfNextDay = moment(period.startTime).tz('America/Chicago').add(1, 'day').startOf('day');
                const firstDayHours = (startOfNextDay - moment(period.startTime)) / (1000 * 60 * 60);
                const remainingHours = period.duration - firstDayHours;
                
                if (!dailyActivity[startDate]) {
                    dailyActivity[startDate] = { trips: [], parking: [], tripMinutes: 0, parkingHours: 0 };
                }
                dailyActivity[startDate].parkingHours += firstDayHours;
                
                if (!dailyActivity[endDate]) {
                    dailyActivity[endDate] = { trips: [], parking: [], tripMinutes: 0, parkingHours: 0 };
                }
                dailyActivity[endDate].parkingHours += remainingHours;
            }
        });

        // Sort and display daily activity
        const sortedDates = Object.keys(dailyActivity).sort();
        
        for (const date of sortedDates) {
            const activity = dailyActivity[date];
            const dayName = moment(date).format('dddd, MMM DD, YYYY');
            
            console.log(`\n📅 ${dayName}`);
            console.log(`   🚗 Trips: ${activity.trips.length} (${this.formatDuration(activity.tripMinutes / 60)})`);
            console.log(`   🅿️ Parking: ${this.formatDuration(activity.parkingHours)}`);
            console.log(`   📊 Total: ${this.formatDuration(activity.tripMinutes / 60 + activity.parkingHours)}`);
            
            // Show trip details for the day
            activity.trips.forEach(trip => {
                const startTime = moment(trip.ignitionOnTime).tz('America/Chicago');
                const endTime = moment(trip.ignitionOffTime).tz('America/Chicago');
                console.log(`      • ${startTime.format('h:mm A')} → ${endTime.format('h:mm A')}: ${trip.vehicleName} (${trip.totalRunTime}min, ${trip.distanceTraveled || 0}mi)`);
            });
        }

        return {
            trips,
            parkingPeriods,
            routePoints,
            dailyActivity,
            stats: {
                totalTrips: trips.length,
                totalTripMinutes,
                totalParkingHours,
                monitoringPeriodHours,
                coverage: monitoringPeriodHours > 0 ? 
                    ((totalTripMinutes / 60 + totalParkingHours) / monitoringPeriodHours) * 100 : 0
            }
        };
    }
}

async function main() {
    const analyzer = new DetailedTripAnalyzer();
    
    try {
        await analyzer.connect();
        const report = await analyzer.generateComprehensiveReport();
        
        console.log(`\n✅ ANALYSIS COMPLETE`);
        console.log(`📊 ${report.stats.totalTrips} trips, ${report.parkingPeriods.length} parking periods analyzed`);
        console.log(`📈 ${report.stats.coverage.toFixed(1)}% time coverage achieved`);
        
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await analyzer.disconnect();
    }
}

if (require.main === module) {
    main();
}

module.exports = DetailedTripAnalyzer;