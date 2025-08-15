# 🌱 SparkLawn Vehicle Locations Dashboard

Real-time vehicle tracking dashboard for SparkLawn's eco-friendly fleet using the Smartcar API.

## ✨ Features

- **Real-time vehicle tracking** with 45-second auto-refresh
- **Named vehicles**: Van and Truck (F-150 Lightning)
- **Battery charge display** with animated battery icons
- **Street addresses** instead of coordinates
- **Interactive map** with high-quality Leaflet integration
- **SparkLawn branding** with eco-friendly green color scheme
- **Automatic token refresh** - set and forget!
- **Responsive design** for desktop and mobile

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
   SMARTCAR_CLIENT_ID=e65b5e78-9995-49e9-bd06-37427e27a53f
   SMARTCAR_CLIENT_SECRET=9d06e7d7-3d17-4c29-9ffd-fd31eeb70106
   SMARTCAR_ACCESS_TOKEN=[current_token]
   SMARTCAR_REFRESH_TOKEN=[current_refresh_token]
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