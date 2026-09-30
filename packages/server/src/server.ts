import { PrismaClient } from '@prisma/client';
import { buildApp } from './app.js';
import { loadEnvOrThrow } from './config/env.js';
import { PrismaIcpRepository } from './modules/icp/prisma-icp-repository.js';
import { PrismaIcpAnalysisRepository } from './modules/icp/prisma-icp-analysis-repository.js';
import { PrismaCandidateRepository } from './modules/discovery/prisma-candidate-repository.js';

async function main(): Promise<void> {
  const env = loadEnvOrThrow();
  const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  const app = await buildApp({
    env,
    icpRepository: new PrismaIcpRepository(prisma),
    analysisRepository: new PrismaIcpAnalysisRepository(prisma),
    candidateRepository: new PrismaCandidateRepository(prisma),
  });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await prisma.$connect();
    await app.listen({ port: env.PORT, host: env.HOST });
  } catch (error) {
    app.log.error({ err: error }, 'failed to start server');
    await prisma.$disconnect();
    process.exit(1);
  }
}

void main();
