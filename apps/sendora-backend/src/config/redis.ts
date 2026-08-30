import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { config } from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Load environment variables (.env in backend directory or cwd)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = process.env.NODE_ENV || "development";
const possibleEnvPaths = [
  path.resolve(process.cwd(), `.env.${env}`),
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "apps/sendora-backend/.env"),
  path.resolve(__dirname, "../../.env"),
];

for (const envPath of possibleEnvPaths) {
  if (fs.existsSync(envPath)) {
    config({ path: envPath });
    break;
  }
}

const redisUrl = process.env.REDIS_URL;
const host = process.env.REDIS_HOST || "localhost";
const port = parseInt(process.env.REDIS_PORT || "6379");

let redisConnection: Redis;

if (redisUrl) {
  console.log(`[Redis Config] Initializing Redis client via REDIS_URL`);
  redisConnection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
  });
} else {
  console.log(
    `[Redis Config] Initializing Redis client (host=${host}, port=${port})`,
  );
  const redisOptions: any = {
    host,
    port,
    maxRetriesPerRequest: null,
  };
  if (host === "localhost") {
    redisOptions.family = 4;
  }
  if (process.env.REDIS_PASSWORD) {
    redisOptions.password = process.env.REDIS_PASSWORD;
  }
  redisConnection = new Redis(redisOptions);
}

const redis = redisConnection;

export { Queue, Worker, redisConnection, redis };
