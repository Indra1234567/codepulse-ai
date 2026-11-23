import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/db';
import { verifyGithubWebhook } from '../middleware/verifyGithubWebhook';

const router = Router();

// Zod schema to validate incoming GitHub Pull Request webhook payloads
const pullRequestWebhookSchema = z.object({
  action: z.string(),
  number: z.number().int().positive(),
  pull_request: z.object({
    title: z.string(),
    html_url: z.string().url(),
  }),
  repository: z.object({
    name: z.string(),
    html_url: z.string().url(),
    owner: z.object({
      login: z.string(),
    }),
  }),
});

router.post('/github', verifyGithubWebhook, async (req: Request, res: Response) => {
  const eventType = req.header('x-github-event');
  const deliveryId = req.header('x-github-delivery');

  if (!deliveryId) {
    res.status(400).json({ error: 'Missing X-GitHub-Delivery header' });
    return;
  }

  // Acknowledge non-PR events cleanly (e.g., GitHub's initial "ping" test event)
  if (eventType !== 'pull_request') {
    res.status(200).json({ message: `Event '${eventType}' ignored` });
    return;
  }

  const parsed = pullRequestWebhookSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid pull_request payload', details: parsed.error.flatten() });
    return;
  }

  const { action, number, pull_request, repository } = parsed.data;

  // Only trigger AI review pipeline when a PR is opened or new commits are pushed
  if (action !== 'opened' && action !== 'synchronize') {
    res.status(200).json({ message: `PR action '${action}' ignored` });
    return;
  }

  try {
    // 1. Idempotency Check: Skip if this exact GitHub delivery was already processed
    const existingDelivery = await prisma.pullRequest.findUnique({
      where: { githubDeliveryId: deliveryId },
    });

    if (existingDelivery) {
      res.status(200).json({
        message: 'Duplicate delivery ignored (idempotent)',
        pullRequestId: existingDelivery.id,
      });
      return;
    }

    // 2. Upsert Repository so it exists before linking the PullRequest
    const repoRecord = await prisma.repository.upsert({
      where: { name: repository.name },
      update: {
        owner: repository.owner.login,
        url: repository.html_url,
      },
      create: {
        name: repository.name,
        owner: repository.owner.login,
        url: repository.html_url,
      },
    });

    // 3. Persist the Pull Request with PENDING status for our AI worker
    const prRecord = await prisma.pullRequest.create({
      data: {
        githubDeliveryId: deliveryId,
        repoId: repoRecord.id,
        prNumber: number,
        title: pull_request.title,
        status: 'PENDING',
      },
    });

    // Respond quickly (202 Accepted) so GitHub never times out while AI runs
    res.status(202).json({
      message: 'Pull request queued for CodePulse AI review',
      pullRequest: prRecord,
    });
  } catch (error) {
    console.error('Error ingesting GitHub webhook:', error);
    res.status(500).json({ error: 'Internal server error processing webhook' });
  }
});

export default router;