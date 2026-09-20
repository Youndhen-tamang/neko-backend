# neko-backend

Multi-tenant ecommerce API for Neko storefronts. Each store lives on `{slug}.{storeHost}` and is served by this Express + Knex + PostgreSQL service, independently of the frontends.

It handles catalog, orders, Stripe and eSewa checkout, cash on delivery, store admin and super-admin dashboards, virtual try-on, a shop chatbot (web and WhatsApp), and voice replies.

## Requirements

- Node.js 20+
- Docker (for local PostgreSQL), or any Postgres 16 instance

## Setup

```bash
cp .env.example .env
docker compose up -d
npm install
npm run migrate:latest
npm run seed          # optional: sample women's clothing catalog
npm run dev
```

API: [http://localhost:4000](http://localhost:4000)

Health check: `GET /api/health`

Fill Cloudinary, Stripe, SMTP, OpenRouter, ElevenLabs, and super-admin credentials in `.env`. See [`.env.example`](.env.example) for every variable. In production (`NODE_ENV=production`) the frontend URLs, `DATABASE_URL`, `JWT_SECRET`, and super-admin credentials are required, and the frontend URLs must not point at localhost.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Watch mode via `tsx` |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server |
| `npm test` | Run `*.test.ts` files |
| `npm run migrate:latest` | Apply Knex migrations |
| `npm run migrate:rollback` | Roll back the last batch |
| `npm run migrate:list` | List applied / pending migrations |
| `npm run seed` | Run Knex seeds |

## API

All routes are under `/api`. Store-scoped endpoints resolve the tenant from the request origin (`{slug}.{storeHost}`).

| Prefix | Purpose |
| --- | --- |
| `/api/health` | Liveness |
| `/api/auth` | Super-admin, store-admin, and customer auth; password reset |
| `/api/tenant-requests` | New store applications |
| `/api/super-admin/agencies` | Super-admin agency management |
| `/api/super-admin/dashboard` | Super-admin metrics |
| `/api/admin/dashboard` | Store-admin metrics |
| `/api/products` | Catalog CRUD, likes, comments |
| `/api/engagement` | Storefront engagement |
| `/api/orders` | Stripe checkout, COD, order admin |
| `/api/esewa` | eSewa ePay v2 |
| `/api/chat` | Storefront chatbot |
| `/api/tryon` | Virtual try-on (rate limited) |
| `/api/tts` | Shop assistant voice (ElevenLabs) |
| `/api/notifications` | In-app notifications |
| `/api/settings` | Store settings, including WhatsApp |
| `/api/webhooks/stripe` | Stripe `checkout.session.completed` |
| `/api/webhooks/whatsapp` | Meta Cloud API inbound messages |

CORS allows the configured storefront (and its tenant subdomains) plus the super-admin origin. Any localhost origin is allowed in development.

## Payments

- **Stripe** — `POST /api/orders/checkout` creates a Checkout Session. Fulfillment runs on `POST /api/webhooks/stripe`.
- **eSewa** — sandbox defaults (`EPAYTEST`) work out of the box. Set `ESEWA_MODE=live` plus your merchant product code and secret for production.
- **Cash on delivery** — `POST /api/orders/cod`.

For local Stripe webhooks, expose port 4000 (ngrok or cloudflared) and set `STRIPE_WEBHOOK_SECRET` to the signing secret for `https://<api-host>/api/webhooks/stripe`.

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
| `TRYON_MODEL` | OpenRouter image model for virtual try-on, default `google/gemini-3.1-flash-image`. |

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

## License

This project is licensed under the [MIT License](LICENSE).
