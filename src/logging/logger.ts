import pino from "pino";

export type Logger = pino.Logger;

let rootLogger: Logger | null = null;

export function configureLogging(): Logger {
  rootLogger = pino({
    level: process.env.LOG_LEVEL ?? "info",
    transport:
      process.env.NODE_ENV === "development"
        ? { target: "pino/file", options: { destination: 2 } }
        : undefined,
  });
  return rootLogger;
}

export function getLogger(): Logger {
  if (!rootLogger) {
    rootLogger = configureLogging();
  }
  return rootLogger;
}

export function createChildLogger(
  bindings: Record<string, unknown>,
): Logger {
  return getLogger().child(bindings);
}
