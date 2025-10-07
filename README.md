# 🌱 SparkLawn Fleet Dashboard

**Advanced fleet management system** for SparkLawn's electric vehicle fleet with real-time tracking, trip analysis, and comprehensive operational insights.

## 🚀 Latest Updates (September 2025)

### 🚨 **CRITICAL DATABASE ROUTING FIX & TELEMETRY RESTORATION** (Sept 16, 2025)
- **Database Issue Resolved**: Fixed critical .env database routing from `sparklawn` to `sparklawn_fleet`
- **24/7 Data Capture Restored**: Background monitoring service now properly writing to correct database
- **Parking Duration Fix**: Eliminated stale 28-day fallback data, accurate real-time status display
- **Trip Recovery Ready**: Infrastructure prepared for 6-7 AM morning trip data reconstruction
- **Custom Time Querying**: Historical analysis capabilities enabled for client visit tracking
- **Business Intelligence Foundation**: End-of-day reporting architecture established

### 🎯 **TRIP TIMELINE VISUALIZATION SYSTEM COMPLETED** (Sept 9, 2025)
- **VIN-Based Data Queries**: Fixed critical vehicleId field missing from route_points collection
- **Trip Timeline API**: Complete timeline service with comprehensive event processing and client correlation
- **Advanced Trip Visualization**: Road-based path reconstruction with detailed Google Maps integration
- **Timeline Page Built**: Complete trip timeline visualization at `/trip-timeline` with real-time data
- **Event Processing**: Ignition tracking, stop detection, client visits, and route analysis
- **3-Second Precision Confirmed**: Ford Telematics data collection with proper VIN association

### 🌟 FLEET-ADVANCED PRIMARY DASHBOARD  
- **New North Star**: Fleet-advanced.html is now the primary dashboard (localhost:3002)
- **Motion-Based Trip Detection**: Intelligent status using GPS timestamps and ignition data
- **Precision Hover Tooltips**: 30px proximity detection with comprehensive vehicle details
- **Center Button**: One-click map reset to optimal fleet overview
- **Real-time Client Detection**: Vehicles at customer locations show green borders with client names

### 🎯 INTELLIGENT BUSINESS DETECTION
- **Smart Location Recognition**: Prioritizes SparkLawn clients over generic businesses  
- **96 Client Database**: Pre-geocoded customer locations with intelligent radius zones
- **Major Chain Priority**: Detects Casey's, Lowe's, Whataburger, Maverik, McDonald's, etc.
- **Minor Service Filtering**: Skips ATMs, propane exchanges, kiosks to show main business
- **Multi-Tier Detection**: Client Locations → Google Places API → Street Addresses

### ✨ COMPREHENSIVE TRIP TIMELINE VISUALIZATION
- **Advanced Timeline API**: Complete event-based timeline reconstruction with MongoDB integration
- **Event Processing**: Ignition ON → Departure → Arrival → Stops → Client Visits → Current Status
- **Route Visualization**: Google Maps integration with polyline route display and detailed timeline
- **Client Correlation**: Real-time detection of vehicles at SparkLawn customer locations
- **Timeline Endpoints**: `/api/trips/timeline/:vehicleId` and `/api/trips/route-points/:vehicleId`
- **Interactive Dashboard**: Complete trip timeline page at `/trip-timeline` with vehicle selection

### 🗄️ MONGODB ATLAS INTEGRATION  
- **Persistent Storage**: All trip data stored in MongoDB Atlas cloud database
- **Real-time Monitoring**: 3-second interval tracking with zero data loss
- **Advanced Analytics**: Historical trip analysis and fleet performance metrics

## ✨ Core Features

### 🚗 Real-Time Fleet Tracking
- **Live Vehicle Monitoring** with 3-second precision updates
- **4-Vehicle Fleet**: Lightning 1, Lightning Pro, Lightning XLT, Lightning 2, eTransit Van
- **Interactive Map** with click-to-zoom vehicle targeting and precision hover tooltips
- **Battery & Charging Status** with real-time percentage and range display
- **Intelligent Location Names** with client detection and Google Maps business filtering
- **Motion Detection** using GPS timestamps for accurate trip status

### 📊 Trip Intelligence  
- **Linear Timeline View**: Chronological journey reconstruction
- **Client Location Detection**: 96+ customer addresses with radius-based matching
- **Stop Analysis**: Automatic detection of 5+ minute stops with duration tracking
- **Drive Time Calculation**: Precise duration and distance between locations
- **Parking Detection**: Real-time status with duration tracking

### 🎯 Advanced Analytics
- **Daily Statistics**: Trips, runtime, distance, battery usage per vehicle
- **Fleet Overview**: Performance metrics across entire fleet
- **Trip History**: Complete historical record with MongoDB persistence  
- **Client Correlation**: Track which vehicles visit which customers

### 🔄 Background Services
- **Automatic Token Management**: 90-minute refresh cycle with MongoDB storage
- **Ford Telematics Integration**: Direct API connection to Ford's vehicle data
- **Smart Alerts**: Proactive notifications for fleet events
- **Self-Healing Systems**: Automatic error recovery and data validation

## Project Structure
```
ford-location-dashboard
├── src
│   ├── server.ts               # Entry point of the application
│   ├── smartcar
│   │   └── smartcarClient.ts    # Smartcar API client
│   ├── db
│   │   └── index.ts             # Database operations
│   ├── routes
│   │   ├── vehicles.ts          # Vehicle location routes
│   │   └── diagnostics.ts       # Vehicle diagnostics routes
│   ├── views
│   │   └── index.html           # Main HTML view
│   ├── public
│   │   ├── css
│   │   │   └── styles.css       # CSS styles for the dashboard
│   │   └── js
│   │       └── map.js           # JavaScript for map rendering
│   └── types
│       └── index.ts             # TypeScript interfaces
├── package.json                 # npm configuration
├── tsconfig.json                # TypeScript configuration
└── README.md                    # Project documentation
```

## 🚀 Quick Deploy to Render

1. **Push to GitHub**:
   ```bash
   git init
   git add .
   git commit -m "Initial SparkLawn dashboard"
   git remote add origin YOUR_GITHUB_REPO
   git push -u origin main
   ```

2. **Deploy on Render**:
   - Go to [render.com](https://render.com)
   - Connect your GitHub repo
   - Select "Web Service"
   - Choose this repository
   - Render will auto-detect the `render.yaml` config

3. **Set Environment Variables** in Render dashboard:
   ```
   FORDPASS_USERNAME=[your_ford_account_username]
   FORDPASS_PASSWORD=[your_ford_account_password]
   FORDPASS_VIN=[your_vehicle_vin]
   MONGODB_URI=[your_mongodb_connection_string]
   ```

## 🔧 Local Development

```bash
npm install
npm run dev
```

Visit `http://localhost:3000` to view the dashboard.

## 📱 Vehicle Fleet

- **Van** - Ford Transit (2023)
- **Truck** - Ford F-150 Lightning (2024)
- **Truck** - Ford F-150 Lightning (2024)  
- **Truck** - Ford F-150 Lightning (2024)

## 🔄 Token Refresh

The dashboard automatically refreshes Smartcar API tokens. To manually refresh:

```bash
./refresh-token.sh
```

## 🌐 Live Dashboard

Once deployed, share the Render URL with your business partner for real-time fleet tracking!

---

Built with ❤️ for SparkLawn's sustainable lawn care mission.