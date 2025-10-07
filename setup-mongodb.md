# 🍃 MongoDB Atlas Setup for SparkLawn Dashboard

## ✅ SETUP COMPLETE - READY TO USE

**Current Connection Status**: 🟢 **ACTIVE**
- **Cluster**: `sparklawn-cluster.evvvpal.mongodb.net`
- **Database**: `sparklawn_fleet`
- **Username**: `bc1414`
- **Connection String**: Configured in `.env`

## Database Schema

### Collections Created:
1. **`trips`** - Complete trip records with start/end times, locations, and metrics
2. **`trip_points`** - Individual GPS coordinates with timestamps and battery data  
3. **`movement_events`** - Event-based tracking (trip_start, trip_end, location_update, stop_detected)

### Indexes for Performance:
```typescript
// Trip queries
{ vehicleId: 1, startTime: -1 }
{ isComplete: 1 }

// Trip points queries  
{ vehicleId: 1, timestamp: -1 }
{ timestamp: -1 }

// Movement events queries
{ vehicleId: 1, timestamp: -1 }
{ eventType: 1, timestamp: -1 }
```

## Current Environment Configuration

```bash
# .env:2
MONGODB_URI=mongodb+srv://bc1414:4m624XuKd%2AxC9%40B@sparklawn-cluster.evvvpal.mongodb.net/sparklawn?retryWrites=true&w=majority
```

**Password Encoding Notes**:
- Original: `4m624XuKd*xC9@B`
- URL Encoded: `4m624XuKd%2AxC9%40B` (required for MongoDB Atlas)
- Special characters: `*` → `%2A`, `@` → `%40`

## Setup History (Completed)

### 1. ✅ Created MongoDB Atlas Account
- Free tier cluster selected
- Region: US-East (N. Virginia)

### 2. ✅ Database Configuration
- **Cluster Name**: `sparklawn-cluster`  
- **Database Name**: `sparklawn_fleet` (updated for fleet management)
- **Collections**: Auto-created by application

### 3. ✅ Connection String Configured
- Full connection string with credentials
- Special character encoding resolved
- Environment variable updated

### 4. ✅ Network Access Configured
- **IP Whitelist**: `0.0.0.0/0` (Allow all - required for Render deployment)
- **Security**: Connection secured by username/password + TLS

### 5. ✅ Database User Created
- **Username**: `bc1414`
- **Password**: Strong password with special characters
- **Role**: `readWriteAnyDatabase` (full access for fleet operations)

## Real-Time Monitoring Active

### Current Status:
- 🟢 **Background Monitoring**: 3-second intervals
- 🟢 **Trip History Service**: Connected and tracking
- 🟢 **Client Location Matching**: 96 locations loaded
- 🟢 **Linear Timeline**: Available via API endpoint

### Active Features:

## ✨ What this gives you:

- **Automatic token refresh** every 90 minutes
- **No manual token updates** needed
- **Persistent token storage** across deployments
- **Zero downtime** for token management

## 🔒 Security Features:

- Tokens stored encrypted in MongoDB
- Automatic token rotation
- Secure connection to MongoDB Atlas
- Environment variable protection