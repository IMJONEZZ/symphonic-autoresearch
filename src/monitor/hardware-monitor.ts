import { execSync } from "node:child_process";
import fs from "node:fs";

export interface HardwareMetrics {
  gpu_utilization_pct: number | null;
  gpu_temperature_c: number | null;
  power_draw_w: number | null;
  mem_available_gb: number;
  mem_total_gb: number;
  updated_at: string;
}

export class HardwareMonitor {
  private interval: ReturnType<typeof setInterval> | null = null;
  private metrics: HardwareMetrics | null = null;

  start(intervalMs = 3000): void {
    if (this.interval) return;
    this.poll();
    this.interval = setInterval(() => this.poll(), intervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  getMetrics(): HardwareMetrics | null {
    return this.metrics;
  }

  private poll(): void {
    try {
      const gpuMetrics = this.pollGpu();
      const memMetrics = this.pollMemory();

      if (!gpuMetrics && !memMetrics && this.metrics) {
        return;
      }

      this.metrics = {
        gpu_utilization_pct: gpuMetrics?.utilization ?? null,
        gpu_temperature_c: gpuMetrics?.temperature ?? null,
        power_draw_w: gpuMetrics?.power ?? null,
        mem_available_gb: memMetrics?.available ?? 0,
        mem_total_gb: memMetrics?.total ?? 0,
        updated_at: new Date().toISOString(),
      };
    } catch {
      // On error, leave previous metrics unchanged
    }
  }

  private pollGpu(): { utilization: number; temperature: number; power: number } | null {
    try {
      const output = execSync(
        "nvidia-smi --query-gpu=utilization.gpu,temperature.gpu,power.draw --format=csv,noheader,nounits",
        { timeout: 2000, encoding: "utf-8" }
      ).trim();

      const parts = output.split(",").map((p) => p.trim());
      if (parts.length < 3) return null;

      const utilization = parseFloat(parts[0]);
      const temperature = parseFloat(parts[1]);
      const power = parseFloat(parts[2]);

      if (isNaN(utilization) || isNaN(temperature) || isNaN(power)) {
        return null;
      }

      return { utilization, temperature, power };
    } catch {
      return null;
    }
  }

  private pollMemory(): { total: number; available: number } | null {
    try {
      const content = fs.readFileSync("/proc/meminfo", "utf-8");
      let memTotalKb = 0;
      let memAvailableKb = 0;

      for (const line of content.split("\n")) {
        if (line.startsWith("MemTotal:")) {
          const match = line.match(/(\d+)/);
          if (match) memTotalKb = parseInt(match[1], 10);
        } else if (line.startsWith("MemAvailable:")) {
          const match = line.match(/(\d+)/);
          if (match) memAvailableKb = parseInt(match[1], 10);
        }
      }

      if (memTotalKb === 0) return null;

      return {
        total: memTotalKb / 1024 / 1024,
        available: memAvailableKb / 1024 / 1024,
      };
    } catch {
      return null;
    }
  }
}
