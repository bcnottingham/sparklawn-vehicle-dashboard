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
            res.json({
                connected: false,
                error: `API request failed: ${response.status} ${response.statusText}`,
                errorDetails: data,
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

export default router;