import { Router, type Request, type Response } from "express";
import type { Orchestrator } from "../orchestrator/orchestrator.js";
import { renderDashboard } from "./dashboard.js";

export function createRoutes(orchestrator: Orchestrator): Router {
  const router = Router();

  // Human-readable dashboard
  router.get("/", (_req: Request, res: Response) => {
    try {
      const snapshot = orchestrator.getSnapshot();
      const html = renderDashboard(snapshot);
      res.type("html").send(html);
    } catch {
      res.status(500).json({ error: { code: "dashboard_error", message: "Failed to render dashboard" } });
    }
  });

  // SSE: real-time event stream
  router.get("/api/v1/events", (_req: Request, res: Response) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(":ok\n\n");
    orchestrator.addSSESubscriber(res);
  });

  // JSON API: training metrics
  router.get("/api/v1/training", (_req: Request, res: Response) => {
    try {
      const metrics = orchestrator.getTrainingMetrics();
      res.json(metrics ?? { status: "no_data" });
    } catch {
      res.status(500).json({ error: { code: "unavailable", message: "Failed to get training metrics" } });
    }
  });

  // JSON API: experiment results
  router.get("/api/v1/results", (_req: Request, res: Response) => {
    try {
      const results = orchestrator.getResults();
      res.json(results);
    } catch {
      res.status(500).json({ error: { code: "unavailable", message: "Failed to get results" } });
    }
  });

  // JSON API: system state
  router.get("/api/v1/state", (_req: Request, res: Response) => {
    try {
      const snapshot = orchestrator.getSnapshot();
      res.json(snapshot);
    } catch {
      res.status(500).json({ error: { code: "unavailable", message: "Failed to get state" } });
    }
  });

  // JSON API: trigger refresh
  router.post("/api/v1/refresh", (_req: Request, res: Response) => {
    const coalesced = !orchestrator.queueRefresh();
    res.status(202).json({
      queued: true,
      coalesced,
      requested_at: new Date().toISOString(),
      operations: ["poll", "reconcile"],
    });
  });

  // JSON API: issue-specific details
  router.get("/api/v1/:identifier", (req: Request, res: Response) => {
    const identifier = req.params.identifier as string;
    if (!identifier || identifier === "state" || identifier === "refresh" || identifier === "events" || identifier === "training" || identifier === "results") {
      res.status(404).json({
        error: { code: "issue_not_found", message: `Issue not found: ${identifier}` },
      });
      return;
    }

    const detail = orchestrator.getIssueDetails(identifier);
    if (!detail) {
      res.status(404).json({
        error: { code: "issue_not_found", message: `Issue not found: ${identifier}` },
      });
      return;
    }

    res.json(detail);
  });

  return router;
}
