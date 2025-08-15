#!/bin/bash

# Exchange authorization code for tokens
CLIENT_ID="e65b5e78-9995-49e9-bd06-37427e27a53f"
CLIENT_SECRET="9d06e7d7-3d17-4c29-9ffd-fd31eeb70106"
AUTH_CODE="da84dbea-25a8-498c-97b1-73b0f12d3eb3"
REDIRECT_URI="http://localhost:3000/callback"

AUTH=$(printf '%s:%s' "$CLIENT_ID" "$CLIENT_SECRET" | base64)
RESP=$(curl -s -X POST https://auth.smartcar.com/oauth/token \
  -H "Authorization: Basic $AUTH" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "code=$AUTH_CODE" \
  -d "redirect_uri=$REDIRECT_URI")

echo "Token exchange response:"
echo "$RESP" | python3 -m json.tool

# Extract tokens
ACCESS_TOKEN=$(echo "$RESP" | python3 -c 'import sys,json; data=json.load(sys.stdin); print(data.get("access_token", ""))')
REFRESH_TOKEN=$(echo "$RESP" | python3 -c 'import sys,json; data=json.load(sys.stdin); print(data.get("refresh_token", ""))')

if [ -n "$ACCESS_TOKEN" ] && [ "$ACCESS_TOKEN" != "" ]; then
    # Update project .env file
    cat > .env << EOF
SMARTCAR_CLIENT_ID=$CLIENT_ID
SMARTCAR_CLIENT_SECRET=$CLIENT_SECRET
SMARTCAR_ACCESS_TOKEN=$ACCESS_TOKEN
SMARTCAR_REFRESH_TOKEN=$REFRESH_TOKEN
EOF

    # Update global tokens file
    cat > ~/.smartcar_tokens.env << EOF
CLIENT_ID="$CLIENT_ID"
CLIENT_SECRET="$CLIENT_SECRET"
REFRESH_TOKEN="$REFRESH_TOKEN"
EOF

    echo "✅ Tokens saved successfully!"
    echo "Access token: ${ACCESS_TOKEN:0:20}..."
    echo "Refresh token: ${REFRESH_TOKEN:0:20}..."
else
    echo "❌ Failed to get tokens"
fi