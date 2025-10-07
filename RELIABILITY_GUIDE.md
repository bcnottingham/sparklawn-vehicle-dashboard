# 🛡️ SparkLawn Fleet Dashboard - Bulletproof Reliability Guide

**Complete guide to ensure your fleet tracking never goes down**

---

## 🚀 PM2 Production Setup

### 1. Install PM2 Globally
```bash
npm install -g pm2
```

### 2. Start with Production Configuration
```bash
# Build the application first
npm run build

# Start with PM2 using ecosystem config
pm2 start ecosystem.config.js

# Save PM2 process list for auto-restart on server reboot
pm2 save

# Generate startup script (run the generated command)
pm2 startup
```

### 3. PM2 Management Commands
```bash
# Monitor all processes
pm2 monit

# View logs
pm2 logs sparklawn-fleet-tracker

# Restart application
pm2 restart sparklawn-fleet-tracker

# Stop application
pm2 stop sparklawn-fleet-tracker

# Delete application from PM2
pm2 delete sparklawn-fleet-tracker

# Reload configuration
pm2 reload ecosystem.config.js
```

---

## 🏥 Health Monitoring

### Health Check Endpoint
Your dashboard now includes a comprehensive health check at `/health`:

```bash
curl http://localhost:8080/health
```

**Response Example:**
```json
{
  "status": "healthy",
  "timestamp": "2025-09-08T15:00:00.000Z",
  "uptime": 3600.123,
  "memory": {
    "rss": 45678912,
    "heapTotal": 23456789,
    "heapUsed": 12345678
  },
  "services": {
    "tokenManager": "healthy",
    "backgroundMonitoring": "healthy", 
    "database": "healthy"
  }
}
```

### External Monitoring Setup
Set up external monitoring services to ping your health endpoint:

**UptimeRobot (Free):**
1. Sign up at uptimerobot.com
2. Add HTTP(s) monitor
3. URL: `https://your-render-url.onrender.com/health`
4. Check interval: 5 minutes
5. Alert contacts: Your email/SMS

**Render Health Checks:**
Render automatically uses your `/health` endpoint when configured in `ecosystem.config.js`.

---

## 🗄️ Database Reliability

### MongoDB Atlas Configuration
Your enhanced connection includes:
- **Automatic Retries:** Up to 10 attempts with exponential backoff
- **Connection Pooling:** 5-10 connections maintained
- **Health Monitoring:** Real-time connection status tracking
- **Jitter Prevention:** Random delays to prevent thundering herd

### Connection Features
```typescript
// Automatic retry with exponential backoff
mongoConnection.withRetry(async (db) => {
    return await db.collection('trips').insertOne(tripData);
});

// Health status monitoring
const health = mongoConnection.getHealth(); // 'healthy' | 'degraded' | 'unhealthy'
```

### Backup Strategy
**Automatic Atlas Backups:**
- MongoDB Atlas provides automatic continuous backups
- Point-in-time recovery available
- No additional configuration needed

**Manual Backup Script:**
```bash
# Create backup script
cat > backup-database.sh << 'EOF'
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
mongodump --uri="mongodb+srv://bc1414:4m624XuKd%2AxC9%40B@sparklawn-cluster.evvvpal.mongodb.net/sparklawn_fleet" --out="./backups/backup_$DATE"
echo "Backup completed: backup_$DATE"
EOF

chmod +x backup-database.sh

# Run daily via cron
crontab -e
# Add: 0 2 * * * /path/to/backup-database.sh
```

---

## 🔄 Token Management Reliability

### Automatic Refresh System
- **90-minute refresh cycle** with MongoDB persistence
- **Fallback to environment variables** if MongoDB unavailable
- **Error recovery** with retry logic
- **Health monitoring** integrated

### Manual Token Refresh
```bash
./refresh-token.sh
```

---

## 📊 Process Monitoring

### PM2 Process Configuration
Your `ecosystem.config.js` includes:

**Redundancy:**
- 2 instances in cluster mode
- Auto-restart on crashes
- Memory limit monitoring (500MB)

**Health Monitoring:**
- Health check endpoint: `http://localhost:8080/health`
- Grace period: 3 seconds
- Kill timeout: 5 seconds

**Logging:**
- Combined logs: `./logs/combined.log`
- Separate error logs: `./logs/error.log`
- Timestamped entries

**Scheduled Maintenance:**
- Daily restart at 3 AM via cron
- Prevents memory leaks
- Ensures fresh connections

### Log Monitoring
```bash
# Monitor all logs in real-time
pm2 logs

# Monitor specific application
pm2 logs sparklawn-fleet-tracker

# View error logs only
tail -f ./logs/error.log

# Search logs for errors
grep "ERROR" ./logs/combined.log
```

---

## 🚨 Alerting & Notifications

### System Alerts
Set up monitoring for:
1. **Process crashes** (PM2 notifications)
2. **Memory usage** (over 400MB)
3. **Database connectivity** (health endpoint)
4. **API rate limits** (Ford/Smartcar)
5. **Disk space** (log rotation)

### PM2 Keymetrics (Optional)
```bash
# Sign up at keymetrics.io for advanced monitoring
pm2 link <secret_key> <public_key>
pm2 install pm2-server-monit
```

### Custom Alert Script
```javascript
// monitor.js - Run via cron every 5 minutes
const axios = require('axios');

async function checkHealth() {
    try {
        const response = await axios.get('http://localhost:8080/health', { timeout: 10000 });
        if (response.status !== 200 || response.data.status !== 'healthy') {
            sendAlert('Dashboard unhealthy', response.data);
        }
    } catch (error) {
        sendAlert('Dashboard unreachable', error.message);
    }
}

async function sendAlert(subject, details) {
    // Implement email/SMS notification
    console.error(`ALERT: ${subject}`, details);
}

checkHealth();
```

---

## 🔧 System-Level Reliability

### Server Resources
**Minimum Requirements:**
- RAM: 2GB (4GB recommended)
- CPU: 2 cores
- Storage: 20GB with log rotation

### Log Rotation
```bash
# Install logrotate configuration
sudo cat > /etc/logrotate.d/sparklawn-dashboard << 'EOF'
/path/to/ford-location-dashboard/logs/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 644 pm2 pm2
    postrotate
        pm2 reload sparklawn-fleet-tracker
    endscript
}
EOF
```

### Firewall Configuration
```bash
# Allow only necessary ports
sudo ufw allow 8080/tcp
sudo ufw allow ssh
sudo ufw enable
```

---

## 🎯 Deployment Reliability

### Render.com Configuration
**Auto-Deploy:** 
- Connected to GitHub repository
- Automatic deploys on code changes
- Health check endpoint monitoring

**Environment Variables:**
```
MONGODB_URI=mongodb+srv://bc1414:4m624XuKd%2AxC9%40B@sparklawn-cluster.evvvpal.mongodb.net/sparklawn_fleet?retryWrites=true&w=majority
FORDPASS_USERNAME=your_username
FORDPASS_PASSWORD=your_password
FORDPASS_VIN=comma_separated_vins
GOOGLE_MAPS_API_KEY=your_api_key
NODE_ENV=production
```

### Zero-Downtime Deployments
Render provides:
- Rolling deployments
- Health check validation
- Automatic rollback on failure

---

## 📈 Performance Optimization

### Database Optimization
```javascript
// Index creation for faster queries
db.trips.createIndex({ "vehicleId": 1, "startTime": -1 });
db.trip_points.createIndex({ "tripId": 1, "timestamp": 1 });
db.movement_events.createIndex({ "vehicleId": 1, "timestamp": -1 });
```

### Memory Management
- Automatic memory limit restarts (500MB)
- Garbage collection optimization
- Connection pool management

---

## 🛠️ Troubleshooting Guide

### Common Issues

**1. MongoDB Connection Failed**
```bash
# Check environment variables
echo $MONGODB_URI

# Test connection
node -e "
const { MongoClient } = require('mongodb');
new MongoClient(process.env.MONGODB_URI).connect()
  .then(() => console.log('✅ Connected'))
  .catch(err => console.error('❌ Failed:', err.message));
"
```

**2. PM2 Process Crashes**
```bash
# Check process status
pm2 status

# View detailed logs
pm2 logs sparklawn-fleet-tracker --lines 100

# Restart if needed
pm2 restart sparklawn-fleet-tracker
```

**3. High Memory Usage**
```bash
# Monitor memory
pm2 monit

# Check for memory leaks in logs
grep -i "memory" ./logs/combined.log

# Force restart if needed
pm2 reload sparklawn-fleet-tracker
```

**4. API Rate Limits**
- Ford/Smartcar APIs have rate limits
- Monitor for 429 responses in logs
- Implement exponential backoff (already included)

### Emergency Procedures

**Complete System Recovery:**
```bash
# 1. Stop all processes
pm2 kill

# 2. Rebuild application
npm run build

# 3. Restart with fresh configuration
pm2 start ecosystem.config.js

# 4. Verify health
curl http://localhost:8080/health
```

---

## 📋 Maintenance Checklist

### Daily
- [ ] Check health endpoint status
- [ ] Monitor PM2 process status
- [ ] Review error logs for anomalies

### Weekly
- [ ] Review database performance metrics
- [ ] Check disk space usage
- [ ] Validate backup integrity
- [ ] Review API usage against limits

### Monthly
- [ ] Update dependencies (`npm audit`)
- [ ] Rotate API keys if needed
- [ ] Review and archive old logs
- [ ] Test disaster recovery procedures

---

## 🎯 Success Metrics

Your bulletproof setup should achieve:
- **99.9% Uptime** (8.7 hours downtime per year)
- **< 3 second response times** for dashboard
- **< 30 second recovery** from database connection loss
- **Zero data loss** during outages
- **24/7 fleet tracking** with persistent storage

With this architecture, your SparkLawn fleet tracking will be enterprise-grade reliable! 🌱