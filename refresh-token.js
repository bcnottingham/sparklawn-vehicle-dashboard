const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function refreshAccessToken() {
    const envPath = path.join(__dirname, '.env');
    const envContent = fs.readFileSync(envPath, 'utf8');
    
    // Parse current .env file
    const envLines = envContent.split('\n');
    const envVars = {};
    
    envLines.forEach(line => {
        const [key, value] = line.split('=');
        if (key && value !== undefined) {
            envVars[key] = value;
        }
    });

    const clientId = envVars.SMARTCAR_CLIENT_ID;
    const clientSecret = envVars.SMARTCAR_CLIENT_SECRET;
    const refreshToken = envVars.SMARTCAR_REFRESH_TOKEN;

    if (!refreshToken) {
        console.error('No refresh token found in .env file. You need to complete the OAuth flow first.');
        console.log('Visit: https://smartcar.com/docs/api-reference/oauth2/');
        process.exit(1);
    }

    try {
        const response = await axios.post('https://auth.smartcar.com/oauth/token', {
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: clientId,
            client_secret: clientSecret
        }, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        const { access_token, refresh_token } = response.data;

        // Update .env file
        const updatedEnvVars = {
            ...envVars,
            SMARTCAR_ACCESS_TOKEN: access_token,
            SMARTCAR_REFRESH_TOKEN: refresh_token || refreshToken
        };

        const updatedEnvContent = Object.entries(updatedEnvVars)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');

        fs.writeFileSync(envPath, updatedEnvContent);

        console.log('✅ Access token refreshed successfully!');
        console.log(`New token expires in: ${response.data.expires_in} seconds`);

    } catch (error) {
        console.error('❌ Error refreshing token:', error.response?.data || error.message);
        process.exit(1);
    }
}

refreshAccessToken();