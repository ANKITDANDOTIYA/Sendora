import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { queueRoutes } from "./routes/queue.routes.js";
import imapQueue from "./queues/imap.queue.js";
import { campaignWorker } from "./workers/campaign.worker.js";
import { authWorker } from "./workers/auth.worker.js";
import { batchemailWorker } from "./workers/batchemail.worker.js";
import { imapWorker } from "./workers/imap.worker.js";

import { trackingRoutes } from "./routes/tracking.routes.js";
import { miscRoutes } from "./routes/misc.routes.js";
import { imapRoutes } from "./routes/imap.routes.js";

const app = new Hono();

// Enable CORS for Vercel frontend and configured domains in production
app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return origin;
      const allowedFrontends = process.env.FRONTEND_URL
        ? process.env.FRONTEND_URL.split(",").map((url) => url.trim())
        : [];
      if (
        allowedFrontends.includes(origin) ||
        origin.endsWith(".vercel.app") ||
        origin.includes("localhost") ||
        origin.includes("127.0.0.1")
      ) {
        return origin;
      }
      return allowedFrontends[0] || origin;
    },
    allowHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  }),
);

app.route("/queue", queueRoutes);
app.route("/tracking", trackingRoutes);
app.route("/email", imapRoutes);
app.route("/", miscRoutes);

const port = parseInt(process.env.PORT || "8100");
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });

console.log(`Hono backend server running on port ${port}...`);
