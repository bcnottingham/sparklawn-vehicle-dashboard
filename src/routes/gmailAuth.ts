import { Router, Request, Response } from 'express';
import gmailService from '../services/gmailService';

const router = Router();

/**
 * GET /gmail-auth/authorize
 * Redirect to Google OAuth for Gmail access
 */
router.get('/authorize', (req: Request, res: Response) => {
  try {
    const authUrl = gmailService.getAuthUrl();
    res.redirect(authUrl);
  } catch (error: any) {
    res.status(500).send(`Error generating auth URL: ${error.message}`);
  }
});

/**
 * GET /gmail-auth/callback
 * Handle OAuth callback from Google
 */
router.get('/callback', async (req: Request, res: Response) => {
  try {
    const code = req.query.code as string;

    if (!code) {
      return res.status(400).send('No authorization code provided');
    }

    // Save the token
    await gmailService.saveToken(code);

    // Redirect back to invoices page with success message
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Gmail Authorization Success</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          }
          .success-box {
            background: white;
            padding: 40px;
            border-radius: 10px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.2);
            text-align: center;
            max-width: 500px;
          }
          h1 {
            color: #10b981;
            margin-bottom: 20px;
          }
          p {
            color: #666;
            margin-bottom: 30px;
            line-height: 1.6;
          }
          button {
            background: #667eea;
            color: white;
            border: none;
            padding: 12px 30px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 16px;
            font-weight: bold;
          }
          button:hover {
            background: #5568d3;
          }
        </style>
      </head>
      <body>
        <div class="success-box">
          <h1>✅ Gmail Authorized!</h1>
          <p>Your Gmail account has been successfully connected. You can now extract invoices from your inbox.</p>
          <button onclick="window.close()">Close this window</button>
          <br><br>
          <a href="/invoices" style="color: #667eea; text-decoration: none;">Or go back to Invoices Dashboard</a>
        </div>
        <script>
          // Auto-close after 3 seconds if opened in popup
          if (window.opener) {
            setTimeout(() => {
              window.close();
            }, 3000);
          }
        </script>
      </body>
      </html>
    `);

  } catch (error: any) {
    console.error('Error saving Gmail token:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Gmail Authorization Failed</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          }
          .error-box {
            background: white;
            padding: 40px;
            border-radius: 10px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.2);
            text-align: center;
            max-width: 500px;
          }
          h1 {
            color: #ef4444;
            margin-bottom: 20px;
          }
          p {
            color: #666;
            margin-bottom: 30px;
            line-height: 1.6;
          }
          .error-details {
            background: #fee2e2;
            padding: 15px;
            border-radius: 5px;
            color: #991b1b;
            font-family: monospace;
            font-size: 12px;
            margin-bottom: 20px;
          }
          button {
            background: #667eea;
            color: white;
            border: none;
            padding: 12px 30px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 16px;
            font-weight: bold;
          }
        </style>
      </head>
      <body>
        <div class="error-box">
          <h1>❌ Authorization Failed</h1>
          <p>There was an error connecting your Gmail account.</p>
          <div class="error-details">${error.message}</div>
          <button onclick="window.location.href='/invoices'">Go Back to Invoices</button>
        </div>
      </body>
      </html>
    `);
  }
});

/**
 * GET /gmail-auth/status
 * Check Gmail authorization status
 */
router.get('/status', (req: Request, res: Response) => {
  const isAuthorized = gmailService.isAuthorized();
  const tokenInfo = gmailService.getTokenInfo();

  res.json({
    success: true,
    authorized: isAuthorized,
    tokenInfo: tokenInfo ? {
      hasRefreshToken: !!tokenInfo.refresh_token,
      expiryDate: tokenInfo.expiry_date
    } : null
  });
});

export default router;
