# Deploy fix for production SMS CORS

The production browser was failing before the SMS was sent because Supabase Edge Function `OPTIONS` preflight was rejected before the function CORS code ran.

This build fixes the frontend by calling the Edge Function with a simple `text/plain` POST, so the browser does not send a preflight request. The Edge Function was also updated to parse both JSON and text/plain JSON bodies.

## Required after uploading this zip

### 1. Redeploy Supabase Edge Function
Use one of these:

```bash
supabase functions deploy send-sms --project-ref vvopvfteonhnixxqvxms --no-verify-jwt
```

Or in Supabase Dashboard ensure the function JWT verification is OFF. The included `supabase/config.toml` has:

```toml
[functions.send-sms]
verify_jwt = false
```

### 2. Add Edge Function secrets in Supabase
Set these in Supabase Dashboard → Edge Functions → Secrets:

```env
SMS_API_KEY=your_fortius_api_key
SMS_SENDER_ID=DVRKRT
SMS_TEMPLATE_ID=1707177575099416766
SMS_BASE_URL=https://smsfortius.org/V2/apikey.php
```

Do not put SMS_API_KEY only on Render. Production browser must not call smsfortius.org directly.

### 3. Redeploy Render frontend
Render Static Site env vars must include:

```env
VITE_SUPABASE_URL=https://vvopvfteonhnixxqvxms.supabase.co
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

`VITE_SUPABASE_PUBLISHABLE_KEY` is also supported, but keep `VITE_SUPABASE_ANON_KEY` if already present.

### 4. Clear cache / redeploy
After Render deploy finishes, open the site in an incognito window and send test SMS.

If the console still shows CORS, it means the old frontend or old Edge Function is still deployed.
