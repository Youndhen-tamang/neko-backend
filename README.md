# API

Express + Knex + PostgreSQL. Run this independently of the frontends.

## Setup

```bash
cp .env.example .env
docker compose up -d
npm install
npm run migrate
npm run dev
```

API: http://localhost:4000

Fill Cloudinary, Stripe, SMTP, OpenRouter, and super-admin credentials in this folder's `.env`.
# neko-backend

## WhatsApp assistant (Meta Cloud API)

Each store connects its own WhatsApp number. The bot shares the storefront chat assistant: it answers questions, matches photos customers send to the catalog, sends product and try-on links, and takes orders via Stripe.

### Platform setup (once, in `.env`)

| Variable | Where it comes from |
| --- | --- |
| `WHATSAPP_APP_SECRET` | Meta developer app → App settings → Basic → App Secret. Used to verify webhook signatures. |
| `WHATSAPP_VERIFY_TOKEN` | Any string you choose. Paste the same value into Meta's webhook config. |
| `WHATSAPP_GRAPH_VERSION` | Graph API version, default `v21.0`. |
| `INTEGRATION_SECRET_KEY` | Random string used to encrypt stored access tokens. Changing it invalidates tokens already saved. |
| `PUBLIC_API_URL` | Optional. Public base URL of this API, shown to store owners as the webhook URL. |
| `TRYON_MODEL` | OpenRouter image model for virtual try-on, default `google/gemini-2.5-flash-image`. |

Then in the Meta app → WhatsApp → Configuration → Webhook:

1. Callback URL: `https://<api-host>/api/webhooks/whatsapp`
2. Verify token: the value of `WHATSAPP_VERIFY_TOKEN`
3. Click **Verify and save**, then subscribe to the **messages** field.

For local development expose port 4000 with ngrok or cloudflared and make sure `FRONTEND_STORE_URL` is reachable from a phone, since links sent to customers are built from it.

### Per store (store owner, `/admin/settings`)

1. Meta app → WhatsApp → API setup: copy the **Phone number ID**.
2. Create a System User with `whatsapp_business_messaging` and `whatsapp_business_management` permissions and generate a permanent access token.
3. Paste both into the WhatsApp card, click **Test connection**, then enable.

While the Meta app is in development mode, only recipient numbers added in the Meta dashboard can message the test number.

### Notes

- Free-form replies are only allowed within 24 hours of the customer's last message. The paid-order confirmation may fall outside that window; it is logged and skipped if Meta rejects it.
- Inbound messages are deduplicated by Meta's message id, so webhook retries are safe.
- Try-on renders cost money per image; `/api/tryon` is rate limited to 5 requests per 10 minutes per IP.
