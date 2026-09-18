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
