# Gmail OAuth Authentication Setup Guide
**SparkLawn Fleet Dashboard - Mobile-First Authentication**

## ✅ What's Been Implemented

### 1. **Authentication Infrastructure**
- JWT-based session management with HTTP-only cookies
- Email domain validation (`@sparklawnnwa.com`)
- Optional email whitelist support
- Mobile-optimized login flow
- 30-day persistent sessions for field convenience

### 2. **Files Created**

#### Backend (`src/`)
- `middleware/auth.ts` - JWT middleware, email validation, route protection
- `routes/googleAuth.ts` - Google OAuth flow, Passport configuration
- `views/login.html` - Mobile-first login page with Google sign-in
- `views/unauthorized.html` - Mobile-optimized access denied page

#### Configuration
- `.env.example` - Updated with Google OAuth and JWT configuration

### 3. **Protected Routes**
All dashboard routes now require authentication:
- `/` → redirects to `/fleet-advanced`
- `/fleet-advanced` → Main dashboard
- `/trips` → Trip analytics
- `/client-management` → Client management
- `/daily-report-preview` → Daily reports
- `/trip-modal-preview` → Trip modals

### 4. **Public Routes**
- `/login` → Google OAuth sign-in (auto-redirects if already authenticated)
- `/unauthorized` → Access denied page
- `/auth/google` → Initiates OAuth flow
- `/auth/google/callback` → OAuth callback
- `/auth/logout` → Clear session
- `/auth/me` → Get current user info (API)

---

## 🚀 Setup Instructions

### Step 1: Google Cloud Console Setup

1. **Go to** [Google Cloud Console](https://console.cloud.google.com/)

2. **Create a new project** or select existing:
   - Project name: "SparkLawn Fleet Dashboard"

3. **Enable Google+ API**:
   - APIs & Services → Library
   - Search for "Google+ API"
   - Click "Enable"

4. **Create OAuth 2.0 Credentials**:
   - APIs & Services → Credentials
   - Click "Create Credentials" → "OAuth client ID"
   - Application type: "Web application"
   - Name: "SparkLawn Fleet Dashboard"

5. **Configure Authorized URIs**:

   **Authorized JavaScript origins:**
   ```
   http://localhost:3002
   https://your-production-domain.com
   ```

   **Authorized redirect URIs:**
   ```
   http://localhost:3002/auth/google/callback
   https://your-production-domain.com/auth/google/callback
   ```

6. **Copy credentials**:
   - Client ID: `xxxxx.apps.googleusercontent.com`
   - Client Secret: `xxxxx`

### Step 2: Environment Configuration

1. **Create `.env` file** (copy from `.env.example`):
```bash
cp .env.example .env
```

2. **Add Google OAuth credentials**:
```bash
# Google OAuth Authentication
GOOGLE_CLIENT_ID=your-actual-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-actual-client-secret
GOOGLE_CALLBACK_URL=http://localhost:3002/auth/google/callback

# JWT Secret (generate with: openssl rand -base64 32)
JWT_SECRET=your-random-jwt-secret-key-here

# Email Whitelist (Optional - leave empty to allow all @sparklawnnwa.com)
AUTHORIZED_EMAILS=user1@sparklawnnwa.com,user2@sparklawnnwa.com
```

3. **Generate secure JWT_SECRET**:
```bash
openssl rand -base64 32
```

### Step 3: Test Locally

1. **Start the server**:
```bash
npm start
```

2. **Open browser** to `http://localhost:3002`

3. **Expected flow**:
   - Browser redirects to `/login`
   - Click "Sign in with Google"
   - Select `@sparklawnnwa.com` account
   - Redirect back to dashboard
   - 30-day cookie stored

4. **Test unauthorized access**:
   - Try signing in with non-`@sparklawnnwa.com` email
   - Should redirect to `/unauthorized` page

---

## 📱 Mobile-First Design

### Login Page Features:
- **56px tap targets** (thumb-friendly)
- **Loading states** for slow connections
- **iOS double-tap prevention**
- **Responsive design** 320px - 1920px
- **PWA-ready** (apple-mobile-web-app tags)

### Navigation:
All dashboard pages are protected with authentication middleware. Users must log in to access any page.

### Session Management:
- **30-day expiration** (convenient for field workers)
- **HTTP-only cookies** (XSS protection)
- **Auto-redirect** to login on expiration
- **Return URL** preserved during auth flow

---

## 🔒 Security Features

### Email Validation:
- **Domain check**: Only `@sparklawnnwa.com` emails
- **Optional whitelist**: Specific emails in `AUTHORIZED_EMAILS`
- **Automatic rejection**: Non-authorized emails → `/unauthorized`

### JWT Security:
- **HTTP-only cookies** (not accessible via JavaScript)
- **Secure flag** in production (HTTPS only)
- **SameSite: lax** (CSRF protection)
- **30-day expiration** with automatic refresh

### Route Protection:
```typescript
// Page protection
app.get('/fleet-advanced', requireAuth, (req, res) => {
    // req.user available with email, name, picture
});

// API protection
app.use('/api/trips', requireAuth, tripsRouter);
```

---

## 🌐 Production Deployment (Render)

### 1. Update Environment Variables in Render:
```
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxx
GOOGLE_CALLBACK_URL=https://your-app.onrender.com/auth/google/callback
JWT_SECRET=your-production-secret
NODE_ENV=production
```

### 2. Update Google Cloud Console:
Add production redirect URI:
```
https://your-app.onrender.com/auth/google/callback
```

### 3. Test Production:
- Visit `https://your-app.onrender.com`
- Should redirect to `/login`
- OAuth should work with production URL

---

## 🧪 Testing Checklist

- [ ] `/login` loads without errors
- [ ] "Sign in with Google" button works
- [ ] Google account picker appears
- [ ] `@sparklawnnwa.com` emails are accepted
- [ ] Non-authorized emails redirect to `/unauthorized`
- [ ] Dashboard loads after successful login
- [ ] Session persists after browser close
- [ ] `/auth/logout` clears session
- [ ] Protected routes redirect to `/login` when not authenticated
- [ ] Mobile responsive (test on iPhone/Android)

---

## 🐛 Troubleshooting

### Error: "redirect_uri_mismatch"
**Fix**: Add exact callback URL to Google Cloud Console authorized redirect URIs

### Error: "Unauthorized email domain"
**Fix**: Check email ends with `@sparklawnnwa.com` or add to `AUTHORIZED_EMAILS`

### Error: "Invalid JWT token"
**Fix**: Regenerate `JWT_SECRET` and clear browser cookies

### Error: "Google OAuth not configured"
**Fix**: Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`

### Session not persisting
**Fix**: Check `JWT_SECRET` is set and cookies are enabled in browser

---

## 📚 API Reference

### `GET /auth/google`
Initiates Google OAuth flow

### `GET /auth/google/callback`
OAuth callback (handles authentication)

### `GET /auth/logout`
Clears session, redirects to `/login`

### `GET /auth/me`
Returns current user info:
```json
{
  "user": {
    "email": "user@sparklawnnwa.com",
    "name": "John Doe",
    "picture": "https://...",
    "googleId": "..."
  }
}
```

---

## 🎯 Next Steps

### Optional Enhancements:

1. **Mobile navigation header**
   - Add logout button to dashboard
   - Display user profile picture
   - Hamburger menu for mobile

2. **Admin panel**
   - Manage authorized emails via UI
   - View active sessions
   - Revoke user access

3. **Session analytics**
   - Track login activity
   - Monitor failed auth attempts
   - User activity logs

---

**Created**: October 2, 2025
**Status**: ✅ Ready for Production
**Mobile-First**: ✅ Optimized for Field Workers
