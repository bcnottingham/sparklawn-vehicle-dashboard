# 🍃 MongoDB Atlas Setup for SparkLawn Dashboard

## Quick Setup (5 minutes)

### 1. Create Free MongoDB Atlas Account
- Go to **[mongodb.com/cloud/atlas](https://mongodb.com/cloud/atlas)**
- Sign up for free account
- Choose **"Shared (FREE)"** cluster

### 2. Create Database
- **Cluster Name**: `sparklawn-cluster`
- **Database Name**: `sparklawn`
- **Collection**: Will be created automatically

### 3. Get Connection String
- Click **"Connect"** → **"Connect your application"**
- Copy connection string, it looks like:
  ```
  mongodb+srv://<username>:<password>@sparklawn-cluster.xxxxx.mongodb.net/sparklawn?retryWrites=true&w=majority
  ```

### 4. Network Access
- Go to **"Network Access"** → **"Add IP Address"**
- Click **"Allow Access from Anywhere"** (0.0.0.0/0)

### 5. Database User
- Go to **"Database Access"** → **"Add New Database User"**
- Username: `sparklawn-user`
- Password: Generate strong password
- Role: **"Read and write to any database"**

## For Render Deployment

Add this environment variable in Render:

```
MONGODB_URI=mongodb+srv://sparklawn-user:YOUR_PASSWORD@sparklawn-cluster.xxxxx.mongodb.net/sparklawn?retryWrites=true&w=majority
```

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