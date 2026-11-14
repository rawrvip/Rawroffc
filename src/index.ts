import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';

const app = express();
const port = Number(process.env.PORT ?? 3000);
const accessToken = process.env.META_ACCESS_TOKEN;
const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
const verifyToken = process.env.META_VERIFY_TOKEN;
const appSecret = process.env.META_APP_SECRET;
const apiKey = process.env.APP_API_KEY;
const graphApiVersion = process.env.META_GRAPH_API_VERSION ?? 'v23.0';

type LogLevel = 'info' | 'warn' | 'error';

function log(level: LogLevel, event: string, details: Record<string, unknown> = {}): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...details,
  };
  console[level](JSON.stringify(entry));
}

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
  log('error', 'startup.missing_configuration', { missingSettings });
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

app.use(express.static(path.join(__dirname, '../public')));

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function requireApiKey(request: Request, response: Response, next: () => void): void {
  const authorization = request.header('authorization') ?? '';
  const suppliedKey = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';

  if (!apiKey || !safeEqual(suppliedKey, apiKey)) {
    log('warn', 'message.send.unauthorized');
    response.status(401).json({ error: 'API key salah atau belum diisi.' });
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
    log('info', 'webhook.verification_succeeded');
    response.status(200).send(challenge);
    return;
  }

  log('warn', 'webhook.verification_failed');
  response.sendStatus(403);
});

// Validate Meta's signature before accepting webhook events.
app.post('/webhook', (request: RequestWithRawBody, response) => {
  const signature = request.header('x-hub-signature-256') ?? '';
  const expected = `sha256=${createHmac('sha256', appSecret!)
    .update(request.rawBody ?? Buffer.alloc(0))
    .digest('hex')}`;

  if (!safeEqual(signature, expected)) {
    log('warn', 'webhook.signature_invalid');
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

  let incomingMessageCount = 0;
  let statusCount = 0;
  const messageTypes = new Set<string>();
  const messageStatuses = new Set<string>();

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        incomingMessageCount += 1;
        if (message.type) messageTypes.add(message.type);
      }

      for (const status of change.value?.statuses ?? []) {
        statusCount += 1;
        if (status.status) messageStatuses.add(status.status);
      }
    }
  }

  log('info', 'webhook.received', {
    incomingMessageCount,
    messageTypes: [...messageTypes],
    statusCount,
    messageStatuses: [...messageStatuses],
  });
  response.sendStatus(200);
});

app.post('/messages', requireApiKey, async (request, response) => {
  const requestId = randomUUID();
  const { to, text } = request.body as { to?: unknown; text?: unknown };

  if (typeof to !== 'string' || !/^\+?\d{7,15}$/.test(to)) {
    log('warn', 'message.send.invalid_recipient', { requestId });
    response.status(400).json({ error: 'Nomor tujuan harus format internasional, misalnya 6281234567890.' });
    return;
  }

  if (typeof text !== 'string' || text.trim().length === 0 || text.length > 4096) {
    log('warn', 'message.send.invalid_text', { requestId });
    response.status(400).json({ error: 'Pesan harus berisi 1–4096 karakter.' });
    return;
  }

  log('info', 'message.send.started', { requestId });

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
    const payload = result as {
      messages?: Array<{ id?: string }>;
      error?: { code?: number; type?: string };
    };

    if (apiResponse.ok) {
      log('info', 'message.send.succeeded', {
        requestId,
        httpStatus: apiResponse.status,
        messageId: payload.messages?.[0]?.id,
      });
    } else {
      log('warn', 'message.send.rejected_by_meta', {
        requestId,
        httpStatus: apiResponse.status,
        errorCode: payload.error?.code,
        errorType: payload.error?.type,
      });
    }

    response.status(apiResponse.status).json(result);
  } catch {
    log('error', 'message.send.connection_failed', { requestId });
    response.status(502).json({ error: 'Tidak bisa terhubung ke WhatsApp API.' });
  }
});

app.listen(port, () => {
  log('info', 'server.listening', {
    port,
    graphApiVersion,
    whatsappProvider: 'official-cloud-api',
  });
});
