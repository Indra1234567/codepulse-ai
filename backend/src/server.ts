import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { prisma } from './config/db';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors({ origin: 'http://localhost:3000' }));
app.use(express.json());

// Health Check Endpoint (Verifies Express + PostgreSQL connectivity)
app.get('/api/health', async (_req: Request, res: Response) => {
  try {
    // Execute a lightweight raw query to verify live DB connection
    console.log('Performing database health check...');
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
      error: error instanceof Error ? error.message : 'Unknown database error',
    });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 CodePulse AI Backend running on http://localhost:${PORT}`);
});