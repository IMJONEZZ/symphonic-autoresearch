import express from "express";
import type { Server } from "node:http";
import type { Orchestrator } from "../orchestrator/orchestrator.js";
import { createRoutes } from "./routes.js";
import type { Logger } from "../logging/logger.js";

export function startServer(
  orchestrator: Orchestrator,
  port: number,
  logger: Logger,
): Server {
  const app = express();

  app.use(express.json());
  app.use(createRoutes(orchestrator));

  // 405 for unsupported methods on defined routes
  app.all("/api/v1/refresh", (_req, res) => {
    res.status(405).json({ error: { code: "method_not_allowed", message: "Use POST" } });
  });

  const server = app.listen(port, "0.0.0.0", () => {
    const addr = server.address();
    const boundPort = typeof addr === "object" && addr ? addr.port : port;
    logger.info({ port: boundPort }, `HTTP server listening on http://0.0.0.0:${boundPort}`);
  });

  return server;
}
