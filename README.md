# Rawroffc WhatsApp Cloud API

A small Indonesian web app for sending text messages through Meta's **official WhatsApp Cloud API**. It includes a browser interface, a protected send endpoint, and a signed webhook receiver. It does not implement Baileys or WhatsApp's private Web protocol.

## Deploy without using a terminal

1. Create/configure a Meta developer app with WhatsApp Cloud API and a WhatsApp Business phone number. Meta credentials are required; uploading code alone cannot connect a WhatsApp number.
2. In Render, choose **New → Blueprint**, connect this GitHub repository, and deploy. Render reads `render.yaml` and asks you to provide the secret environment variables.
3. Set `META_ACCESS_TOKEN`, `META_PHONE_NUMBER_ID`, `META_VERIFY_TOKEN`, `META_APP_SECRET`, and `APP_API_KEY` in Render. Choose a long, random value for `APP_API_KEY`; do not share it publicly.
4. Open the deployed site's URL. Enter the server API key, recipient's international phone number, and message, then press **Kirim pesan**.
5. For incoming-message webhooks, configure the deployed URL plus `/webhook` in Meta's developer dashboard and subscribe to the WhatsApp message webhook field. Use the same `META_VERIFY_TOKEN` configured on Render.

The app's web form does not store the API key in the browser. The server still needs the Meta credentials configured by its owner. Meta may require approved templates for business-initiated conversations; follow WhatsApp's opt-in and messaging rules.

## What's included

- `GET /` — browser form for sending a text message.
- `GET /health` — deployment health check.
- `GET /webhook` — Meta webhook verification.
- `POST /webhook` — validates Meta's `X-Hub-Signature-256` signature.
- `POST /messages` — protected message-send API.

The Graph API version is configurable with `META_GRAPH_API_VERSION`; use a version currently supported by Meta. Never commit secrets or place them in the repository.
