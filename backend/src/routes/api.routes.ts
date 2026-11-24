import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/db';

const router = Router();

// Query validation schema for filtering and paginating PRs
// z.coerce.number() automatically converts URL query strings (e.g. "?page=2") into integers
const listPrQuerySchema = z.object({
  status: z.enum(['PENDING', 'COMPLETED', 'FAILED']).optional(),
  repoId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});


// 1. GET /api/stats - Top-level KPI metrics for the dashboard header
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const [totalRepos, totalPrs, pendingPrs, completedPrs] = await Promise.all([
      prisma.repository.count(),
      prisma.pullRequest.count(),
      prisma.pullRequest.count({ where: { status: 'PENDING' } }),
      prisma.pullRequest.count({ where: { status: 'COMPLETED' } }),
    ]);

    res.status(200).json({
      totalRepos,
      totalPrs,
      pendingPrs,
      completedPrs,
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard statistics' });
  }
});


// 2. GET /api/repositories - List all connected repositories with PR & CodeChunk counts
router.get('/repositories', async (_req: Request, res: Response) => {
  try {
    const repositories = await prisma.repository.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            pullRequests: true,
            codeChunks: true,
          },
        },
      },
    });

    res.status(200).json({ repositories });
  } catch (error) {
    console.error('Error fetching repositories:', error);
    res.status(500).json({ error: 'Failed to fetch repositories' });
  }
});



// 3. GET /api/pull-requests - Paginated list of PRs with optional status/repo filters
router.get('/pull-requests', async (req: Request, res: Response) => {
  const parsed = listPrQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid query parameters',
      details: parsed.error.flatten(),
    });
    return;
  }

  const { status, repoId, page, limit } = parsed.data;
  const skip = (page - 1) * limit;

  const where = {
    ...(status ? { status } : {}),
    ...(repoId ? { repoId } : {}),
  };

  try {
    // Run data fetch and total count in parallel instead of sequentially
    const [pullRequests, total] = await Promise.all([
      prisma.pullRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          repository: {
            select: {
              id: true,
              name: true,
              owner: true,
              url: true,
            },
          },
        },
      }),
      prisma.pullRequest.count({ where }),
    ]);

    res.status(200).json({
      data: pullRequests,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching pull requests:', error);
    res.status(500).json({ error: 'Failed to fetch pull requests' });
  }
});


// 4. GET /api/pull-requests/:id - Single PR details & AI review report
router.get('/pull-requests/:id', async (req: Request, res: Response) => {
  const parsedId = z.string().uuid().safeParse(req.params.id);

  if (!parsedId.success) {
    res.status(400).json({ error: 'Invalid pull request UUID format' });
    return;
  }

  try {
    const pullRequest = await prisma.pullRequest.findUnique({
      where: { id: parsedId.data },
      include: {
        repository: true,
      },
    });

    if (!pullRequest) {
      res.status(404).json({ error: 'Pull request not found' });
      return;
    }

    res.status(200).json({ pullRequest });
  } catch (error) {
    console.error('Error fetching pull request details:', error);
    res.status(500).json({ error: 'Failed to fetch pull request details' });
  }
});

export default router;