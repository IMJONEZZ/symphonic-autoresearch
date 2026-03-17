import { watch, type FSWatcher } from "chokidar";
import { EventEmitter } from "node:events";
import { loadWorkflow } from "./workflow-loader.js";
import { buildServiceConfig } from "./config-layer.js";
import type { ServiceConfig, WorkflowDefinition } from "../types/workflow.js";
import type { Logger } from "../logging/logger.js";

export interface ConfigManager extends EventEmitter {
  getConfig(): ServiceConfig;
  getWorkflow(): WorkflowDefinition;
  reload(): boolean;
  stop(): void;
}

/**
 * Watch WORKFLOW.md for changes and maintain the current effective config.
 * Emits "reload" events when config changes successfully.
 * On invalid reload, keeps last known good config and logs an error.
 */
export function createConfigManager(
  workflowPath: string,
  logger: Logger,
): ConfigManager {
  const emitter = new EventEmitter() as ConfigManager;

  let currentWorkflow: WorkflowDefinition = loadWorkflow(workflowPath);
  let currentConfig: ServiceConfig = buildServiceConfig(currentWorkflow.config);
  let watcher: FSWatcher | null = null;

  emitter.getConfig = () => currentConfig;
  emitter.getWorkflow = () => currentWorkflow;

  emitter.reload = () => {
    try {
      const newWorkflow = loadWorkflow(workflowPath);
      const newConfig = buildServiceConfig(newWorkflow.config);
      currentWorkflow = newWorkflow;
      currentConfig = newConfig;
      logger.info("Workflow config reloaded successfully");
      emitter.emit("reload", currentConfig);
      return true;
    } catch (err) {
      logger.error(
        { err },
        "Failed to reload workflow config, keeping last known good config",
      );
      return false;
    }
  };

  // Start file watching
  watcher = watch(workflowPath, {
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  });

  watcher.on("change", () => {
    logger.info("Workflow file changed, reloading...");
    emitter.reload();
  });

  emitter.stop = () => {
    if (watcher) {
      watcher.close();
      watcher = null;
    }
  };

  return emitter;
}
