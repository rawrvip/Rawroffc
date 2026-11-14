# Rawroffc WhatsApp Cloud API starter

Starter server for Meta's **official WhatsApp Cloud API**, built with Node.js and TypeScript. This is not a Baileys clone and does not implement WhatsApp's private Web protocol.

## Run locally

Requirements: Node.js 20 or newer.

```bash
npm install
cp .env.example .env
```

Fill in `.env` with credentials from your Meta developer app and WhatsApp Business account, then run:

```bash
npm run dev
```

Build and run the compiled server:

```bash
npm run build
npm start
```

The server exits on startup if required environment variables are missing. Never commit `.env` or share access tokens.

## Endpoints

- `GET /health` — health check.
- `GET /webhook` — Meta webhook verification. Configure this URL in the Meta developer dashboard and use the same `META_VERIFY_TOKEN` value.
- `POST /webhook` — receives webhook events and verifies `X-Hub-Signature-256` with `META_APP_SECRET`. It logs sender/type/status metadata, not message bodies.
- `POST /messages` — sends a text message via the official Cloud API. Requires `Authorization: Bearer <APP_API_KEY>`.

Example send request:

```bash
curl -X POST http://localhost:3000/messages \
  -H 'Authorization: Bearer YOUR_APP_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"to":"6281234567890","text":"Halo!"}'
```

For production, deploy behind HTTPS, configure the webhook subscription in Meta, use secure secret storage, and comply with WhatsApp's opt-in and messaging policies. The Graph API version is configurable with `META_GRAPH_API_VERSION`; use a version currently supported by Meta.
