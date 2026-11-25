import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';
import { prisma } from '../config/db';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface CodeFileInput {
  filePath: string;
  content: string;
}

export interface RetrievedChunk {
  id: string;
  filePath: string;
  content: string;
  similarity: number;
}

/**
 * Splits source files into overlapping line-based chunks so large files
 * fit cleanly within embedding token limits while preserving context.
 */
export function chunkCodeFile(
  filePath: string,
  content: string,
  chunkSizeLines = 60,
  overlapLines = 10
): CodeFileInput[] {
  const lines = content.split('\n');
  if (lines.length <= chunkSizeLines) {
    return [{ filePath, content: content.trim() }];
  }

  const chunks: CodeFileInput[] = [];
  let start = 0;

  while (start < lines.length) {
    const end = Math.min(start + chunkSizeLines, lines.length);
    const slice = lines.slice(start, end).join('\n').trim();
    if (slice.length > 0) {
      chunks.push({
        filePath: `${filePath}#L${start + 1}-L${end}`,
        content: slice,
      });
    }
    if (end === lines.length) break;
    start += chunkSizeLines - overlapLines;
  }

  return chunks;
}

/**
 * Generates a 1536-dimensional embedding vector matching CodeChunk.embedding
 * and L2-normalizes it for accurate cosine similarity search.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is missing in backend/.env');
  }

  const response = await ai.models.embedContent({
    model: 'gemini-embedding-001',
    contents: text,
    config: {
      outputDimensionality: 1536,
    },
  });

  const values = response.embeddings?.[0]?.values;
  if (!values || values.length !== 1536) {
    throw new Error('Failed to generate 1536-dimensional embedding');
  }

  // L2 normalize so cosine distance (<=>) reflects pure directional similarity
  const norm = Math.sqrt(values.reduce((sum, val) => sum + val * val, 0));
  return norm === 0 ? values : values.map((val) => val / norm);
}

/**
 * Re-indexes a repository's code files into PostgreSQL pgvector.
 */
export async function indexRepositoryFiles(
  repoId: string,
  files: CodeFileInput[]
): Promise<number> {
  const allChunks = files.flatMap((file) =>
    chunkCodeFile(file.filePath, file.content)
  );

  // Clear stale embeddings for this repository before inserting fresh chunks
  await prisma.codeChunk.deleteMany({ where: { repoId } });

  let indexedCount = 0;
  for (const chunk of allChunks) {
    const embedding = await generateEmbedding(
      `File: ${chunk.filePath}\n\n${chunk.content}`
    );
    const vectorLiteral = `[${embedding.join(',')}]`;
    const id = crypto.randomUUID();

    await prisma.$executeRaw`
      INSERT INTO "CodeChunk" ("id", "repoId", "filePath", "content", "embedding", "createdAt")
      VALUES (${id}, ${repoId}, ${chunk.filePath}, ${chunk.content}, ${vectorLiteral}::vector, NOW())
    `;
    indexedCount++;
  }

  return indexedCount;
}

/**
 * Finds the top-K most semantically similar code chunks in a repository
 * using pgvector cosine distance (<=>). Similarity = 1 - cosine_distance.
 */
export async function searchSimilarCode(
  repoId: string,
  query: string,
  limit = 4
): Promise<RetrievedChunk[]> {
  const queryEmbedding = await generateEmbedding(query);
  const vectorLiteral = `[${queryEmbedding.join(',')}]`;

  const results = await prisma.$queryRaw<RetrievedChunk[]>`
    SELECT
      "id",
      "filePath",
      "content",
      1 - ("embedding" <=> ${vectorLiteral}::vector) AS "similarity"
    FROM "CodeChunk"
    WHERE "repoId" = ${repoId}
      AND "embedding" IS NOT NULL
    ORDER BY "embedding" <=> ${vectorLiteral}::vector ASC
    LIMIT ${limit}
  `;

  return results;
}