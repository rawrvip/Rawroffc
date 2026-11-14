import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';

const app = express();
const port = Number(process.env.PORT ?? 3000);
const accessToken = process.env.META_ACCESS_TOKEN;
const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
const verifyToken = process.env.META_VERIFY_TOKEN;
const appSecret = process.env.META_APP_SECRET;
const apiKey = process.env.APP_API_KEY;
const graphApiVersion = process.env.META_GRAPH_API_VERSION ?? 'v23.0';

const requiredSettings = {
  META_ACCESS_TOKEN: accessToken,
  META_PHONE_NUMBER_ID: phoneNumberId,
  META_VERIFY_TOKEN: verifyToken,
  META_APP_SECRET: appSecret,
  APP_API_KEY: apiKey,
};

const missingSettings = Object.entries(requiredSettings)
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missingSettings.length > 0) {
  console.error(`Missing required environment variables: ${missingSettings.join(', ')}`);
  process.exit(1);
}

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

app.use(express.json({
  verify: (request, _response, body) => {
    (request as RequestWithRawBody).rawBody = Buffer.from(body);
  },
}));

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function requireApiKey(request: Request, response: Response, next: () => void): void {
  const authorization = request.header('authorization') ?? '';
  const suppliedKey = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';

  if (!apiKey || !safeEqual(suppliedKey, apiKey)) {
    response.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

app.get('/health', (_request, response) => {
  response.json({ status: 'ok' });
});

// Meta calls this endpoint to verify the webhook URL during setup.
app.get('/webhook', (request, response) => {
  const mode = request.query['hub.mode'];
  const token = request.query['hub.verify_token'];
  const challenge = request.query['hub.challenge'];

  if (mode === 'subscribe' && typeof token === 'string' && verifyToken && safeEqual(token, verifyToken)) {
    response.status(200).send(challenge);
    return;
  }

  response.sendStatus(403);
});

// Validate Meta's signature before accepting webhook events.
app.post('/webhook', (request: RequestWithRawBody, response) => {
  const signature = request.header('x-hub-signature-256') ?? '';
  const expected = `sha256=${createHmac('sha256', appSecret!)
    .update(request.rawBody ?? Buffer.alloc(0))
    .digest('hex')}`;

  if (!safeEqual(signature, expected)) {
    response.status(401).json({ error: 'Invalid webhook signature' });
    return;
  }

  const body = request.body as {
    entry?: Array<{
      changes?: Array<{
        value?: {
          messages?: Array<{ from?: string; type?: string; id?: string }>;
          statuses?: Array<{ id?: string; status?: string }>;
        };
      }>;
    }>;
  };

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        // Avoid logging message contents or credentials.
        console.log('Incoming WhatsApp message', {
          from: message.from,
          type: message.type,
          id: message.id,
        });
      }

      for (const status of change.value?.statuses ?? []) {
        console.log('WhatsApp message status', {
          id: status.id,
          status: status.status,
        });
      }
    }
  }

  response.sendStatus(200);
});

app.post('/messages', requireApiKey, async (request, response) => {
  const { to, text } = request.body as { to?: unknown; text?: unknown };

  if (typeof to !== 'string' || !/^\+?\d{7,15}$/.test(to)) {
    response.status(400).json({ error: 'to must be a phone number in international format' });
    return;
  }

  if (typeof text !== 'string' || text.trim().length === 0 || text.length > 4096) {
    response.status(400).json({ error: 'text must contain 1–4096 characters' });
    return;
  }

  try {
    const apiResponse = await fetch(
      `https://graph.facebook.com/${graphApiVersion}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: to.replace(/^\+/, ''),
          type: 'text',
          text: { preview_url: false, body: text },
        }),
      },
    );

    const result: unknown = await apiResponse.json();
    response.status(apiResponse.status).json(result);
  } catch (error) {
    console.error('WhatsApp API request failed', error);
    response.status(502).json({ error: 'Could not reach the WhatsApp API' });
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
