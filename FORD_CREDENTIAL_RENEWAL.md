# Ford Telematics API Credential Renewal Guide

## Problem
Your Ford Telematics API credentials have expired, causing `401 Unauthorized` errors:
```
{"message":"Unable to retrieve access token. Please check clientId and clientSecret"}
```

## Solution: Regenerate Credentials in Ford Fleet Marketplace

### Step 1: Access Ford Fleet Marketplace
1. Navigate to https://www.fleet.ford.com/
2. Log in with your **Admin account** (only admins can manage credentials)

### Step 2: Navigate to Credential Management
1. Click on the **"Settings"** or **"Admin"** menu
2. Select **"Credential Management"**

### Step 3: Create New API Credentials
1. Click **"Create Credentials"** or **"New API User"**
2. Enter a descriptive name (e.g., "SparkLawn Dashboard API - 2025")
3. Click **"Generate"** or **"Create"**
4. **IMPORTANT**: Copy both values immediately:
   - `clientId` (UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
   - `clientSecret` (starts with letters/numbers)
5. Store them securely - you cannot retrieve the `clientSecret` again!

### Step 4: Update Your .env File
Replace the old credentials in `/Users/billycourtney/GodMode/ford-location-dashboard/.env`:

```bash
FORD_TELEMATICS_CLIENT_ID=<your-new-client-id>
FORD_TELEMATICS_CLIENT_SECRET=<your-new-client-secret>
FORD_TELEMATICS_BASE_URL=https://api.fordpro.com/vehicle-status-api
```

### Step 5: Verify Vehicle Access
The Ford API pulls data directly via **VIN numbers**:

**Current Fleet VINs**:
- `1FTVW1EL3NWG00285` (Lightning 1)
- `1FTVW1EV3NWG07402` (Lightning XLT)
- `1FT6W1EV3PWG37779` (Lightning 2)
- `1FTBW1XK6PKA30591` (eTransit 1)

Verify in Ford Fleet Marketplace:
1. Go to **"Fleet"** or **"Vehicles"** tab
2. Confirm all VINs are listed and have **Telematics Status = "Active"**
3. If any vehicle shows "Inactive", activate telematics for that VIN

### Step 6: Assign API Access (if needed)
Some Ford accounts require explicit API user assignment:
1. Go to **"Groups"** or **"User Management"** tab
2. Ensure your API credentials have access to the vehicle group
3. Save changes if any modifications were made

### Step 7: Restart Dashboard
```bash
cd /Users/billycourtney/GodMode/ford-location-dashboard
npm start
```

## Verification
Once restarted, check the logs for:
```
✅ Ford Telematics token acquired, expires: <timestamp>
```

Instead of:
```
❌ Ford Telematics authentication failed: 401 Unauthorized
```

## Important Notes

### Token Expiration
- Ford Telematics tokens expire after **5 minutes**
- Our dashboard automatically refreshes tokens before expiry
- No manual intervention needed once credentials are valid

### Credential Expiration
- `clientId` and `clientSecret` don't expire automatically
- However, they can be:
  - Revoked by Ford
  - Deleted in Fleet Marketplace
  - Suspended due to API abuse/rate limits

### Rate Limits
- Be mindful of Ford's rate limits (mentioned in API docs)
- Our dashboard includes exponential backoff for 429 errors
- Background monitoring runs every 3 seconds per vehicle

### Troubleshooting
If credentials still don't work after renewal:

1. **Check Vehicle Enrollment**:
   ```bash
   curl -X GET -H "Authorization: Bearer <token>" \
   "https://api.fordpro.com/vehicle-status-api/v1/vehicles"
   ```

2. **Verify Group Assignment**:
   - Ensure API user is in correct group
   - Ensure group contains the VINs you're trying to access

3. **Test Single Vehicle**:
   ```bash
   curl -X GET -H "Authorization: Bearer <token>" \
   "https://api.fordpro.com/vehicle-status-api/v1/vehicle/<VIN>/status"
   ```

4. **Check Ford Service Status**:
   - Visit Ford's status page or contact support
   - API outages do happen

## Contact Ford Support
If issues persist:
- **Email**: fordtelematicsapi@ford.com
- **Phone**: Check Ford Fleet Marketplace for support number
- **Documentation**: https://api.fordpro.com/vehicle-status-api/docs

## Last Known Working Credentials
- **Created**: Unknown (credentials in sparklawn-website-manager)
- **Status**: EXPIRED as of 2025-10-02
- **Action Required**: Generate new credentials following steps above
