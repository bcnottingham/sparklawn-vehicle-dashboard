import { Router } from 'express';
import { jobberClient } from '../services/jobberClient';

const router = Router();

// Jobber OAuth authorization URL
router.get('/jobber', (req, res) => {
    const clientId = process.env.JOBBER_CLIENT_ID;
    const redirectUri = process.env.JOBBER_REDIRECT_URI || 'https://sparklawn-vehicle-dashboard.onrender.com/auth/jobber/callback';
    
    if (!clientId) {
        return res.status(400).json({ error: 'Jobber client ID not configured' });
    }

    // Jobber OAuth scopes we need
    const scopes = [
        'clients:read',
        'properties:read', 
        'jobs:read',
        'scheduled_items:read'
    ].join(' ');

    const authUrl = `https://api.getjobber.com/api/oauth/authorize?` +
        `response_type=code&` +
        `client_id=${clientId}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `scope=${encodeURIComponent(scopes)}&` +
        `state=sparklawn-fleet-auth`;

    res.redirect(authUrl);
});

// Jobber OAuth callback
router.get('/jobber/callback', async (req, res) => {
    const { code, state, error } = req.query;

    if (error) {
        return res.status(400).json({ 
            error: 'OAuth authorization failed', 
            details: error 
        });
    }

    if (state !== 'sparklawn-fleet-auth') {
        return res.status(400).json({ 
            error: 'Invalid state parameter' 
        });
    }

    if (!code) {
        return res.status(400).json({ 
            error: 'Authorization code not provided' 
        });
    }

    try {
        // Exchange authorization code for access token
        const clientId = process.env.JOBBER_CLIENT_ID;
        const clientSecret = process.env.JOBBER_CLIENT_SECRET;
        const redirectUri = process.env.JOBBER_REDIRECT_URI || 'https://sparklawn-vehicle-dashboard.onrender.com/auth/jobber/callback';

        const tokenResponse = await fetch('https://api.getjobber.com/api/oauth/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                grant_type: 'authorization_code',
                client_id: clientId,
                client_secret: clientSecret,
                code: code,
                redirect_uri: redirectUri
            })
        });

        if (!tokenResponse.ok) {
            const errorData = await tokenResponse.text();
            throw new Error(`Token exchange failed: ${tokenResponse.status} ${errorData}`);
        }

        const tokens = await tokenResponse.json();

        // Display tokens for manual configuration
        res.send(`
            <html>
                <head>
                    <title>Jobber OAuth Success</title>
                    <style>
                        body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
                        .success { color: #28a745; }
                        .token-box { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 10px 0; }
                        .copy-button { background: #007bff; color: white; border: none; padding: 5px 10px; cursor: pointer; }
                    </style>
                </head>
                <body>
                    <h1 class="success">✅ Jobber OAuth Authorization Successful!</h1>
                    <p>Your SparkLawn Fleet Tracker now has access to your Jobber data.</p>
                    
                    <h3>🔑 Add these to your Render Environment Variables:</h3>
                    
                    <div class="token-box">
                        <strong>JOBBER_ACCESS_TOKEN:</strong><br>
                        <code id="access-token">${tokens.access_token}</code>
                        <button class="copy-button" onclick="copyToClipboard('access-token')">Copy</button>
                    </div>
                    
                    <div class="token-box">
                        <strong>JOBBER_REFRESH_TOKEN:</strong><br>
                        <code id="refresh-token">${tokens.refresh_token || 'N/A'}</code>
                        <button class="copy-button" onclick="copyToClipboard('refresh-token')">Copy</button>
                    </div>
                    
                    <div class="token-box">
                        <strong>Token expires in:</strong> ${tokens.expires_in} seconds (${Math.round(tokens.expires_in / 3600)} hours)
                    </div>
                    
                    <h3>🚀 Next Steps:</h3>
                    <ol>
                        <li>Add the tokens above to your Render environment variables</li>
                        <li>Restart your Render service</li>
                        <li>Test the integration at <code>/geofencing/jobber/properties</code></li>
                        <li>Initialize geofences at <code>/geofencing/initialize</code></li>
                    </ol>
                    
                    <p><a href="/">← Back to Dashboard</a></p>
                    
                    <script>
                        function copyToClipboard(elementId) {
                            const element = document.getElementById(elementId);
                            const text = element.textContent;
                            navigator.clipboard.writeText(text).then(() => {
                                alert('Copied to clipboard!');
                            });
                        }
                    </script>
                </body>
            </html>
        `);

    } catch (error) {
        console.error('OAuth callback error:', error);
        res.status(500).json({ 
            error: 'Failed to exchange authorization code for tokens',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Check current Jobber connection status
router.get('/jobber/status', async (req, res) => {
    try {
        // Try a simple GraphQL query to test connection
        const accessToken = process.env.JOBBER_ACCESS_TOKEN;
        if (!accessToken) {
            throw new Error('Jobber access token not configured');
        }

        // Debug token info
        console.log('=== JOBBER TOKEN DEBUG ===');
        console.log('Token length:', accessToken.length);
        console.log('Token starts with:', accessToken.substring(0, 30));
        console.log('Token ends with:', accessToken.substring(accessToken.length - 30));
        console.log('Has whitespace:', /\s/.test(accessToken));
        console.log('All env vars with JOBBER:', Object.keys(process.env).filter(k => k.includes('JOBBER')));
        
        // Try to decode JWT to check expiration
        try {
            const tokenParts = accessToken.split('.');
            if (tokenParts.length === 3) {
                const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
                console.log('Token exp:', payload.exp);
                console.log('Current time:', Math.floor(Date.now() / 1000));
                console.log('Time until expiry:', payload.exp - Math.floor(Date.now() / 1000), 'seconds');
            }
        } catch (e) {
            console.log('Failed to decode JWT:', e instanceof Error ? e.message : 'Unknown error');
        }
        console.log('========================');

        const testQuery = `
            query {
                clients(first: 1) {
                    edges {
                        node {
                            id
                        }
                    }
                }
            }
        `;

        const response = await fetch('https://api.getjobber.com/api/graphql', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'X-JOBBER-GRAPHQL-VERSION': '2023-08-18'
            },
            body: JSON.stringify({
                query: testQuery
            })
        });

        const data = await response.json();

        if (!response.ok) {
            // Return the actual error response for debugging
            console.log('Full response headers:', Object.fromEntries(response.headers.entries()));
            console.log('Response body:', JSON.stringify(data, null, 2));
            res.json({
                connected: false,
                error: `API request failed: ${response.status} ${response.statusText}`,
                errorDetails: data,
                tokenLength: accessToken.length,
                tokenStart: accessToken.substring(0, 20),
                message: 'Jobber API connection failed - check error details'
            });
            return;
        }
        
        if (data.errors) {
            throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
        }

        // Log the response for debugging
        console.log('Jobber API response:', JSON.stringify(data, null, 2));

        res.json({
            connected: true,
            message: 'Jobber API connection successful',
            clientsCount: data.data.clients.edges.length,
            data: data.data
        });
    } catch (error) {
        res.json({
            connected: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            message: 'Jobber API connection failed - check tokens'
        });
    }
});

// Test endpoint for MongoDB token management
router.get('/jobber/mongodb-test', async (req, res) => {
    try {
        const { tokenManager } = await import('../services/tokenManager');
        
        console.log('Testing MongoDB token retrieval...');
        const tokens = await tokenManager.getCurrentJobberTokens();
        
        res.json({
            success: true,
            hasTokens: !!tokens,
            tokenInfo: tokens ? {
                hasAccessToken: !!tokens.accessToken,
                hasRefreshToken: !!tokens.refreshToken,
                expiresAt: tokens.expiresAt,
                lastUpdated: tokens.lastUpdated
            } : null
        });
    } catch (error) {
        res.json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            details: 'MongoDB token test failed'
        });
    }
});

// Smartcar OAuth callback
router.get('/smartcar/callback', async (req, res) => {
    const { code, state, error } = req.query;

    if (error) {
        return res.status(400).json({ 
            error: 'OAuth authorization failed', 
            details: error 
        });
    }

    if (state !== 'sparklawn-connect') {
        return res.status(400).json({ 
            error: 'Invalid state parameter' 
        });
    }

    if (!code) {
        return res.status(400).json({ 
            error: 'Authorization code not provided' 
        });
    }

    try {
        // Exchange authorization code for access token
        const clientId = process.env.SMARTCAR_CLIENT_ID;
        const clientSecret = process.env.SMARTCAR_CLIENT_SECRET;
        const redirectUri = process.env.SMARTCAR_REDIRECT_URI || 'https://sparklawn-vehicle-dashboard.onrender.com/auth/smartcar/callback';

        const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        
        const tokenResponse = await fetch('https://auth.smartcar.com/oauth/token', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code: code as string,
                redirect_uri: redirectUri
            })
        });

        if (!tokenResponse.ok) {
            const errorData = await tokenResponse.text();
            throw new Error(`Token exchange failed: ${tokenResponse.status} ${errorData}`);
        }

        const tokens = await tokenResponse.json();

        // Display tokens for manual configuration (and auto-save to MongoDB)
        const { tokenManager } = await import('../services/tokenManager');
        
        try {
            // Save to MongoDB automatically
            const tokenData = {
                clientId: clientId!,
                clientSecret: clientSecret!,
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
                lastUpdated: new Date()
            };
            
            await tokenManager.saveTokens(tokenData);
            console.log('✅ Smartcar tokens saved to MongoDB automatically');
        } catch (dbError) {
            console.error('⚠️ Failed to save tokens to MongoDB:', dbError);
        }

        // Display success page
        res.send(`
            <html>
                <head>
                    <title>Smartcar Connection Success</title>
                    <style>
                        body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
                        .success { color: #28a745; }
                        .token-box { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 10px 0; }
                    </style>
                </head>
                <body>
                    <h1 class="success">✅ Vehicles Connected Successfully!</h1>
                    <p>Your SparkLawn Fleet Tracker is now connected to your Ford vehicles.</p>
                    
                    <h3>🚗 Connection Details:</h3>
                    <div class="token-box">
                        <strong>Access Token:</strong> ${tokens.access_token.substring(0, 20)}...<br>
                        <strong>Expires in:</strong> ${tokens.expires_in} seconds (${Math.round(tokens.expires_in / 3600)} hours)<br>
                        <strong>Auto-saved to MongoDB:</strong> ✅ Yes
                    </div>
                    
                    <h3>🚀 Next Steps:</h3>
                    <ol>
                        <li>Tokens are automatically saved to your database</li>
                        <li>Return to your dashboard to see your vehicles</li>
                        <li>Your vehicles will now appear on the map</li>
                    </ol>
                    
                    <p><a href="/">← Back to Dashboard</a></p>
                </body>
            </html>
        `);

    } catch (error) {
        console.error('Smartcar OAuth callback error:', error);
        res.status(500).json({ 
            error: 'Failed to exchange authorization code for tokens',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export default router;