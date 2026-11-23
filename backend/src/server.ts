import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { prisma } from './config/db';
import webhookRoutes from './routes/webhook.routes';
import { WebhookRequest } from './middleware/verifyGithubWebhook';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: 'http://localhost:3000' }));

// Capture raw buffer before JSON parsing so HMAC-SHA256 verification matches exact bytes
app.use(
  express.json({
    verify: (req: WebhookRequest, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// Routes
app.use('/api/webhooks', webhookRoutes);

app.get('/api/health', async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({
      status: 'healthy',
      service: 'CodePulse AI Backend',
      database: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Database health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      service: 'CodePulse AI Backend',
      database: 'disconnected',
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 CodePulse AI Backend running on http://localhost:${PORT}`);
});