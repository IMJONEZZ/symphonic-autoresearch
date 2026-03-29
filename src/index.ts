#!/usr/bin/env node

import { Command } from "commander";
import path from "node:path";
import fs from "node:fs";
import { configureLogging, type Logger } from "./logging/logger.js";
import { createConfigManager, type ConfigManager } from "./config/watcher.js";
import { LinearClient } from "./tracker/linear-client.js";
import { WorkspaceManager } from "./workspace/workspace-manager.js";
import { OpenCodeClient } from "./agent/opencode-client.js";
import { Orchestrator } from "./orchestrator/orchestrator.js";
import { startServer } from "./server/server.js";
import type { Server } from "node:http";

const program = new Command();

program
  .name("symphonic-autoresearch")
  .description(
    "A long-running automation service for autonomous ML research experiments",
  )
  .version("1.0.0")
  .argument("[workflow-path]", "Path to WORKFLOW.md", "./WORKFLOW.md")
  .option("--port <number>", "HTTP server port")
  .action(async (workflowPath: string, options: { port?: string }) => {
    const logger = configureLogging();

    // Resolve workflow path
    const resolvedPath = path.resolve(workflowPath);
    if (!fs.existsSync(resolvedPath)) {
      logger.error({ path: resolvedPath }, "Workflow file not found");
      process.exit(1);
    }

    let configManager: ConfigManager | null = null;
    let orchestrator: Orchestrator | null = null;
    let httpServer: Server | null = null;

    try {
      // Initialize config
      configManager = createConfigManager(resolvedPath, logger);
      const config = configManager.getConfig();

      // Initialize tracker client (only for linear mode)
      let trackerClient: LinearClient | null = null;
      if (config.mode === "linear") {
        trackerClient = new LinearClient(
          () => configManager!.getConfig().tracker,
          logger.child({ component: "linear" }),
        );
      }

      // Initialize workspace manager
      const workspaceManager = new WorkspaceManager(
        () => configManager!.getConfig().workspace.root,
        () => configManager!.getConfig().hooks,
        logger.child({ component: "workspace" }),
      );

      // Initialize OpenCode client
      const openCodeClient = new OpenCodeClient(
        () => configManager!.getConfig().opencode,
        logger.child({ component: "agent" }),
      );

      // Initialize orchestrator
      orchestrator = new Orchestrator(
        configManager,
        trackerClient,
        workspaceManager,
        openCodeClient,
        logger.child({ component: "orchestrator" }),
      );

      // Start HTTP server if configured
      const portStr = options.port;
      const serverPort = portStr
        ? parseInt(portStr, 10)
        : config.server.port;

      if (serverPort !== null && serverPort !== undefined) {
        httpServer = startServer(
          orchestrator,
          serverPort,
          logger.child({ component: "server" }),
        );
      }

      // Start orchestrator
      await orchestrator.start();
      logger.info({ mode: config.mode }, "Symphonic Autoresearch started successfully");

      // Graceful shutdown
      const shutdown = async () => {
        logger.info("Shutdown signal received");

        if (httpServer) {
          httpServer.close();
        }

        if (orchestrator) {
          await orchestrator.shutdown();
        }

        if (configManager) {
          configManager.stop();
        }

        logger.info("Shutdown complete");
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    } catch (err) {
      logger.error({ err }, "Startup failed");
      if (configManager) configManager.stop();
      process.exit(1);
    }
  });

program.parse();
