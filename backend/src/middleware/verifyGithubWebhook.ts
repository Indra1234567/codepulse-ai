import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

// Extend Express Request to carry the raw unparsed buffer
export interface WebhookRequest extends Request {
  rawBody?: Buffer;
}

export const verifyGithubWebhook = (
  req: WebhookRequest,
  res: Response,
  next: NextFunction
): void => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    console.error('GITHUB_WEBHOOK_SECRET is not configured');
    res.status(500).json({ error: 'Webhook secret not configured on server' });
    return;
  }

  const signatureHeader = req.header('x-hub-signature-256');
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    res.status(401).json({ error: 'Missing or malformed X-Hub-Signature-256 header' });
    return;
  }

  if (!req.rawBody) {
    res.status(400).json({ error: 'Missing raw request body for signature verification' });
    return;
  }

  const expectedSignature =
    'sha256=' +
    crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');

  const signatureBuffer = Buffer.from(signatureHeader, 'utf8');
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    res.status(401).json({ error: 'Invalid webhook signature' });
    return;
  }

  next();
};