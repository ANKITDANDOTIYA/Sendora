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

export function createRedisClient(): Redis {
  if (process.env.NODE_ENV === "test") {
    return new Redis({
      lazyConnect: true,
      maxRetriesPerRequest: null,
    });
  }

  let client: Redis;
  if (redisUrl) {
    let hostname: string | undefined;
    try {
      hostname = new URL(redisUrl).hostname;
    } catch {
      // URL parsing fallback
    }

    const isTls = redisUrl.startsWith("rediss://");

    client = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      connectTimeout: 10000,
      keepAlive: 30000,
      family: 0, // Dual-stack IPv4/IPv6 resolution (prevents ENOTFOUND on cloud endpoints)
      ...(isTls && hostname
        ? {
            tls: {
              servername: hostname,
            },
          }
        : {}),
      retryStrategy(times) {
        // Exponential backoff capped at 5 seconds
        const delay = Math.min(times * 200, 5000);
        return delay;
      },
      reconnectOnError(err) {
        const targetErrors = ["READONLY", "ETIMEDOUT", "ECONNRESET"];
        if (targetErrors.some((e) => err.message.includes(e))) {
          return true; // Force reconnect
        }
        return false;
      },
    });
  } else {
    const redisOptions: any = {
      host,
      port,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      connectTimeout: 10000,
      keepAlive: 30000,
      retryStrategy(times: number) {
        return Math.min(times * 200, 5000);
      },
      reconnectOnError(err: Error) {
        const targetErrors = ["READONLY", "ETIMEDOUT", "ECONNRESET"];
        if (targetErrors.some((e) => err.message.includes(e))) {
          return true;
        }
        return false;
      },
    };
    if (host === "localhost" || host === "127.0.0.1") {
      redisOptions.family = 4;
    } else {
      redisOptions.family = 0;
    }
    if (process.env.REDIS_PASSWORD) {
      redisOptions.password = process.env.REDIS_PASSWORD;
    }
    client = new Redis(redisOptions);
  }

  let lastLoggedErrorTime = 0;
  client.on("error", (err: any) => {
    const now = Date.now();
    if (now - lastLoggedErrorTime > 10000) {
      lastLoggedErrorTime = now;
      if (err.code === "ENOTFOUND") {
        console.error(
          `[REDIS] CRITICAL: Cannot resolve Redis host (${err.hostname || "unknown"}). Upstash database may be paused, expired, or deleted. Please check your Upstash console and update REDIS_URL in .env and Render dashboard.`,
        );
      } else if (err.code === "ETIMEDOUT") {
        console.error(
          `[REDIS] Connection timed out (${err.message}). Verify Redis host and network connectivity.`,
        );
      } else {
        console.error(`[REDIS] Connection error: ${err.message}`);
      }
    }
  });

  return client;
}

const redisConnection: Redis = createRedisClient();
const redis = redisConnection;

redisConnection.on("connect", () => {
  console.log("[REDIS] Connected successfully.");
});

redisConnection.on("reconnecting", (delay: number) => {
  console.log(`[REDIS] Reconnecting in ${delay}ms...`);
});

export { Queue, Worker, redisConnection, redis };
