# SparkLawn Fleet Dashboard - Page Overview
**What Users See After Login**

---

## 🏠 **Main Pages (All Protected with Gmail OAuth)**

### **1. Fleet Advanced Dashboard** (Primary View)
**Route**: `/fleet-advanced`
**File**: [src/views/fleet-advanced.html](src/views/fleet-advanced.html)
**Size**: 248KB (247,999 bytes)

**What It Shows**:
- **Left Panel**:
  - Google Maps with live vehicle locations
  - Real-time vehicle markers with custom icons
  - Route/trip visualization

- **Right Sidebar**:
  - Vehicle status cards (4 Lightning trucks)
  - Battery levels with visual indicators
  - Charging status (AC/DC/Not charging)
  - Ignition status (On/Off/Run)
  - Last update timestamps

- **Bottom Panels**:
  - Recent trips timeline
  - Fleet statistics (total miles, active time, etc.)
  - Quick actions

**Design**:
- Dark theme (#0a0e1a background)
- Modern glassmorphism effects
- Hover animations on vehicle cards
- Mobile-responsive grid layout
- Real-time auto-refresh

---

### **2. Client Management**
**Route**: `/client-management`
**File**: [src/views/client-management.html](src/views/client-management.html)
**Size**: 66KB (67,342 bytes)

**What It Shows**:
- List of all SparkLawn clients with addresses
- Google Maps integration showing client locations
- Add/edit/delete client functionality
- Search and filter clients
- Client visit history
- Integration with trip data (which vehicle visited which client)

**Features**:
- Client database management
- Geocoded addresses on map
- Quick "Navigate to Client" actions
- Client notes and details
- Visit tracking

---

### **3. Daily Report Preview**
**Route**: `/daily-report-preview`
**File**: [src/views/daily-report-preview.html](src/views/daily-report-preview.html)
**Size**: 30KB (30,265 bytes)

**What It Shows**:
- Daily fleet summary report
- Per-vehicle breakdown:
  - Total trips
  - Miles driven
  - Active hours
  - Stops made
  - Locations visited
- Fleet-wide totals
- Date picker for historical reports
- Export to PDF button
- Send to Slack button

**Use Case**:
- End-of-day fleet summary
- Manager overview
- Weekly/monthly reporting
- Client billing support

---

### **4. Trip Modal Preview**
**Route**: `/trip-modal-preview`
**File**: [src/views/trip-modal-preview.html](src/views/trip-modal-preview.html)
**Size**: 21KB (21,306 bytes)

**What It Shows**:
- Detailed individual trip view
- Trip summary stats:
  - Total distance
  - Duration
  - Number of stops
  - Start/end times
- Stop-by-stop breakdown:
  - Location names
  - Arrival/departure times
  - Dwell time at each stop
  - Addresses
- Route visualization on map
- PDF export for individual trip

**Mobile-Optimized**:
- Touch-friendly buttons
- Swipe gestures
- Fullscreen modal on mobile
- Easy sharing

---

### **5. Trip Analytics**
**Route**: `/trips`
**File**: [src/views/trips-real.html](src/views/trips-real.html)
**Size**: 34KB (34,278 bytes)

**What It Shows**:
- Historical trip data table
- Sortable columns (date, vehicle, distance, duration)
- Filter by:
  - Date range
  - Vehicle
  - Trip type
  - Distance threshold
- Trip trends and analytics
- Charts and graphs:
  - Daily miles driven
  - Most active vehicles
  - Peak usage times
- Export to CSV/PDF

---

## 🔐 **Authentication Pages** (Public)

### **6. Login Page** (Mobile-First)
**Route**: `/login`
**File**: [src/views/login.html](src/views/login.html)
**Size**: 7KB (7,174 bytes)

**Design**:
- Beautiful gradient background (#0f1419 → #1a2332)
- Large 80px SparkLawn logo (🚗 emoji with gradient)
- "Sign in with Google" button (56px height - thumb-friendly)
- Google logo with proper branding colors
- Info box explaining @sparklawnnwa.com requirement
- Loading state animation
- iOS double-tap prevention
- PWA-ready (Add to Home Screen)

**Colors**:
- Primary: #10b981 (SparkLawn green)
- Background: Dark gradient
- Button: White (#ffffff)
- Text: Light (#e2e8f0)

---

### **7. Unauthorized Page**
**Route**: `/unauthorized`
**File**: [src/views/unauthorized.html](src/views/unauthorized.html)
**Size**: 5KB (4,843 bytes)

**Design**:
- Red gradient icon (🚫)
- Clear error message
- Email requirements displayed
- "Try Different Account" button
- "Visit Main Website" fallback
- Support email link

---

## 🎨 **Design System**

### **Color Palette**:
```css
Primary Green:   #10b981
Dark Background: #0a0e1a, #0f1419, #1a1f2e
Card Background: #1a1f2e
Borders:         #2a3441, #334155
Text Primary:    #e2e8f0
Text Secondary:  #94a3b8
Accent Blue:     #3b82f6
Warning Orange:  #f59e0b
```

### **Typography**:
- Font: Inter (Google Fonts)
- Fallback: -apple-system, BlinkMacSystemFont
- Sizes: 10px - 24px
- Weights: 400, 500, 600, 700

### **Components**:
- **Vehicle Cards**: Glassmorphism with backdrop blur
- **Stat Cards**: Gradient backgrounds with icons
- **Buttons**: 56px height (mobile-friendly tap targets)
- **Modals**: Fullscreen on mobile, centered on desktop
- **Maps**: Google Maps with custom dark theme

---

## 📱 **Mobile Optimizations**

### **Responsive Breakpoints**:
- **Mobile**: < 768px (single column, stacked cards)
- **Tablet**: 768px - 1024px (two column grid)
- **Desktop**: > 1024px (full three column layout)

### **Touch-Friendly**:
- **56px minimum tap targets** (thumb-sized)
- **Swipe gestures** for modals
- **Pull-to-refresh** on trip lists
- **Smooth scrolling** with momentum
- **No zoom required** (viewport optimized)

### **Performance**:
- **Lazy loading** for trip history
- **Pagination** (50 trips per page)
- **Debounced search** (300ms delay)
- **Image optimization** (WebP with PNG fallback)
- **Gzip compression** enabled

---

## 🗺️ **Navigation Flow**

```
Login Page (/login)
    ↓ (Gmail OAuth)
Fleet Dashboard (/fleet-advanced) [DEFAULT]
    ├── Trip Analytics (/trips)
    ├── Client Management (/client-management)
    ├── Daily Reports (/daily-report-preview)
    └── Trip Details (/trip-modal-preview)
```

### **Protected Routes**:
All routes except `/login` and `/unauthorized` require authentication. If not logged in, users are redirected to `/login` with a `returnTo` parameter to bring them back after auth.

---

## 🚀 **Quick Start Guide**

### **For Field Workers (Mobile)**:
1. Tap "Sign in with Google" on login page
2. Select your @sparklawnnwa.com account
3. Dashboard loads automatically
4. View vehicle status in real-time
5. Check trip history with one tap
6. Add to Home Screen for quick access

### **For Managers (Desktop)**:
1. Sign in with Google OAuth
2. Fleet dashboard shows all 4 Lightning trucks
3. Click vehicle cards for detailed status
4. View daily reports for fleet analytics
5. Export to PDF for record keeping
6. Send summaries to Slack

---

## 📊 **Data Sources**

### **Real-Time Data**:
- Ford Telematics API (vehicle status)
- Google Maps API (geocoding, maps)
- MongoDB (trip history, clients)

### **Refresh Rates**:
- Vehicle status: Every 30 seconds
- Map markers: Real-time on update
- Trip history: On page load + manual refresh

---

## 🎯 **Key Features Visible to Users**

✅ **Live vehicle tracking** with Google Maps
✅ **Battery/charging status** with visual indicators
✅ **Trip history** with detailed stop breakdowns
✅ **Client database** with map integration
✅ **Daily/weekly reports** with export to PDF
✅ **Slack integration** for notifications
✅ **Mobile-first design** with touch optimization
✅ **Dark theme** optimized for field use
✅ **Offline-ready** (PWA capabilities)
✅ **Session persistence** (30-day login)

---

**Created**: October 2, 2025
**Status**: ✅ Production-Ready
**Mobile-First**: ✅ Optimized for Field Workers
