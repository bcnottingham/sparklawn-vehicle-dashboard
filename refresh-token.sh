#!/bin/bash

# 1️⃣ Use the correct credentials
CLIENT_ID="e65b5e78-9995-49e9-bd06-37427e27a53f"
CLIENT_SECRET="9d06e7d7-3d17-4c29-9ffd-fd31eeb70106"
REFRESH_TOKEN="14f2d5f4-13fd-43ff-9ae0-547c5e22a0d3"

# 2️⃣ Exchange refresh_token for a new access_token
AUTH=$(printf '%s:%s' "$CLIENT_ID" "$CLIENT_SECRET" | base64)
RESP=$(curl -s -X POST https://auth.smartcar.com/oauth/token \
  -H "Authorization: Basic $AUTH" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=refresh_token" \
  -d "refresh_token=$REFRESH_TOKEN")

# 3️⃣ Pretty-print the full JSON response
echo "$RESP" | python3 -m json.tool

# 4️⃣ Save access_token to your shell for this session
ACCESS=$(echo "$RESP" | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

# 5️⃣ Save rotated refresh_token if Smartcar gives you a new one
ROTATED=$(echo "$RESP" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("refresh_token",""))')
if [ -n "$ROTATED" ] && [ "$ROTATED" != "None" ] && [ "$ROTATED" != "$REFRESH_TOKEN" ]; then
  REFRESH_TOKEN="$ROTATED"
  printf 'CLIENT_ID="%s"\nCLIENT_SECRET="%s"\nREFRESH_TOKEN="%s"\n' \
    "$CLIENT_ID" "$CLIENT_SECRET" "$REFRESH_TOKEN" > ~/.smartcar_tokens.env
  echo "Saved rotated refresh token."
fi

# 6️⃣ Update project .env file with new access token and correct credentials
cat > .env << EOF
SMARTCAR_CLIENT_ID=$CLIENT_ID
SMARTCAR_CLIENT_SECRET=$CLIENT_SECRET
SMARTCAR_ACCESS_TOKEN=$ACCESS
SMARTCAR_REFRESH_TOKEN=$REFRESH_TOKEN
EOF

echo "✅ Updated project .env file with fresh access token"
echo "Access token: ${ACCESS:0:20}..."