# Deployment Guide: fleet.sparklawnnwa.com

## Prerequisites ✅

- GitHub repository with clean production code
- Domain: `sparklawnnwa.com` (DNS access required)
- All environment variables documented in `.env` file

## How to Spin Up fleet.sparklawnnwa.com

### Option 1: Render.com (Recommended - Free Tier Available)

**Step 1: Create Render Account**
1. Go to https://render.com
2. Sign up with GitHub account
3. Connect your GitHub repository

**Step 2: Create New Web Service**
1. Click "New +" → "Web Service"
2. Connect repository: `ford-location-dashboard`
3. Configure settings:
   - **Name**: `sparklawn-fleet-dashboard`
   - **Environment**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Plan**: Free (or Starter for $7/month)

**Step 3: Add Environment Variables**
In Render dashboard, go to "Environment" tab and add:

```
NODE_ENV=production
PORT=3002
MONGODB_URI=<your-mongodb-atlas-uri>
FORD_TELEMATICS_CLIENT_ID=<your-client-id>
FORD_TELEMATICS_CLIENT_SECRET=<your-client-secret>
FORD_TELEMATICS_BASE_URL=https://api.fordpro.com/vehicle-status-api
SLACK_BOT_TOKEN=<your-slack-bot-token>
SLACK_CHANNEL_ID=<your-channel-id>
SLACK_WEBHOOK_URL=<your-webhook-url>
GOOGLE_CLIENT_ID=<your-google-client-id>
GOOGLE_CLIENT_SECRET=<your-google-client-secret>
GOOGLE_CALLBACK_URL=https://fleet.sparklawnnwa.com/auth/google/callback
SESSION_SECRET=<generate-random-32-char-string>
JWT_SECRET=<generate-random-32-char-string>
```

**Step 4: Configure Custom Domain**
1. In Render dashboard → Settings → Custom Domains
2. Add domain: `fleet.sparklawnnwa.com`
3. Render will provide DNS records

**Step 5: Update DNS (GoDaddy/Namecheap/etc.)**
1. Log into your domain registrar
2. Go to DNS settings for `sparklawnnwa.com`
3. Add CNAME record:
   - **Type**: CNAME
   - **Name**: fleet
   - **Value**: `<your-render-app>.onrender.com`
   - **TTL**: 600 (10 minutes)

**Step 6: Wait for DNS Propagation** (5-30 minutes)
Check status: `dig fleet.sparklawnnwa.com`

**Step 7: Enable HTTPS** (Automatic on Render)
Render auto-provisions Let's Encrypt SSL certificate

---

### Option 2: Vercel (Alternative - Free Tier)

**Note**: Vercel is better for static sites. For Node.js apps with background services, Render is recommended.

**Step 1**: Install Vercel CLI
```bash
npm install -g vercel
```

**Step 2**: Deploy
```bash
cd ford-location-dashboard
vercel
```

**Step 3**: Add Custom Domain in Vercel Dashboard
- Go to project settings
- Add `fleet.sparklawnnwa.com`
- Update DNS as instructed

---

### Option 3: Self-Hosted VPS (DigitalOcean, AWS, etc.)

**Requirements:**
- Ubuntu 22.04 LTS server
- Node.js 18+
- PM2 process manager
- Nginx reverse proxy

**Quick Setup:**

```bash
# On your server
git clone https://github.com/yourusername/ford-location-dashboard.git
cd ford-location-dashboard
npm install
npm run build

# Install PM2
npm install -g pm2

# Start app
pm2 start ecosystem.config.js
pm2 save
pm2 startup

# Configure Nginx
sudo nano /etc/nginx/sites-available/fleet.sparklawnnwa.com
```

**Nginx Config:**
```nginx
server {
    listen 80;
    server_name fleet.sparklawnnwa.com;

    location / {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/fleet.sparklawnnwa.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Get SSL certificate
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d fleet.sparklawnnwa.com
```

---

## Post-Deployment Checklist

- [ ] Verify HTTPS is working
- [ ] Test Google Sign-In with @sparklawnnwa.com email
- [ ] Check MongoDB connection
- [ ] Verify Ford API token refresh works
- [ ] Test Slack daily report at 7 PM CST
- [ ] Monitor error logs for 24 hours
- [ ] Set up uptime monitoring (UptimeRobot, Pingdom)
- [ ] Document emergency procedures

---

## Monitoring & Maintenance

**Uptime Monitoring:**
- Use UptimeRobot (free): https://uptimerobot.com
- Monitor: `https://fleet.sparklawnnwa.com/api/health`
- Alert via email/Slack if down

**Log Monitoring:**
- Render: Built-in logs dashboard
- VPS: `pm2 logs` or Papertrail

**Weekly Tasks:**
- Review error logs
- Check MongoDB storage usage
- Verify Slack reports sending

**Monthly Tasks:**
- Update Node.js dependencies: `npm update`
- Review security patches
- Test backup/restore procedures

---

## Troubleshooting

**Site not loading:**
- Check DNS: `dig fleet.sparklawnnwa.com`
- Check Render deployment logs
- Verify environment variables are set

**Google Sign-In fails:**
- Update `GOOGLE_CALLBACK_URL` in .env
- Verify OAuth redirect URI in Google Console

**Slack reports not sending:**
- Check `SLACK_BOT_TOKEN` is valid
- Verify bot is in #daily-trips channel
- Check cron schedule (7 PM CST)

**Database connection issues:**
- Verify MongoDB Atlas IP whitelist (0.0.0.0/0 for cloud hosting)
- Check connection string format
- Test connection manually

---

## Security Notes

✅ **Enabled:**
- HTTPS enforced
- Google OAuth restricted to @sparklawnnwa.com
- Environment variables secured
- MongoDB uses Atlas with TLS

⚠️ **Recommendations:**
- Set up 2FA on hosting account
- Rotate secrets quarterly
- Enable MongoDB IP whitelist (after testing)
- Set up automated backups

---

## Support

**Documentation:**
- See `PRODUCTION_CLEANUP_REPORT.md` for weak points
- See `PRODUCTION_READY_STATUS.md` for feature checklist

**Emergency Contacts:**
- MongoDB Support: https://support.mongodb.com
- Render Support: https://render.com/docs
- Ford Telematics: Check API documentation
