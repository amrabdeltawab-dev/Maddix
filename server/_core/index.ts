import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { sql } from "drizzle-orm";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic } from "./static";
import { resetAllOrders } from "../db";
import { getDb } from "../db";

const WEEKLY_ORDER_RESET_MS = 7 * 24 * 60 * 60 * 1000;
let weeklyOrderResetRunning = false;
function startWeeklyOrderResetScheduler() {
  const runReset = async () => {
    if (weeklyOrderResetRunning) return;
    weeklyOrderResetRunning = true;
    try {
      const result = await resetAllOrders();
      console.log(`[Weekly order reset] Completed. Deleted ${result.deletedCount} orders.`);
    } catch (error) {
      console.error("[Weekly order reset] Failed; will retry at the next weekly interval.", error);
    } finally {
      weeklyOrderResetRunning = false;
    }
  };
  const timer = setInterval(() => void runReset(), WEEKLY_ORDER_RESET_MS);
  timer.unref?.();
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const isDevelopment = process.env.NODE_ENV === "development" && !process.env.VERCEL;
  if (!isDevelopment) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be configured in production");
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error("JWT_SECRET must be configured with at least 32 characters in production");
    if (!process.env.OAUTH_SERVER_URL) throw new Error("OAUTH_SERVER_URL must be configured in production");
    if (!process.env.VITE_APP_ID) throw new Error("VITE_APP_ID must be configured in production");
    const db = await getDb();
    if (!db) throw new Error("Production database connection failed");
    await db.execute(sql`SELECT 1`);
  }
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.get("/healthz", async (_req, res) => {
    try {
      const db = await getDb();
      if (!db) return res.status(503).json({ ok: false, database: false });
      await db.execute(sql`SELECT 1`);
      return res.status(200).json({ ok: true, database: true });
    } catch {
      return res.status(503).json({ ok: false, database: false });
    }
  });
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (isDevelopment) {
    const { setupVite } = await import("./vite");
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = !isDevelopment ? preferredPort : await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, "0.0.0.0", () => {
    console.log(`Server listening on port ${port}`);
    if (!isDevelopment) startWeeklyOrderResetScheduler();
  });
}

startServer().catch(error => {
  console.error("[Startup] Server failed to start:", error);
  process.exitCode = 1;
});
