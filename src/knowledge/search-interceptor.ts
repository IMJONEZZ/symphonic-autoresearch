import type { AgentEvent } from "../types/agent.js";

export type SearchEventCallback = (content: string, source: string) => void;

const MAX_CONTENT_LENGTH = 2000;

interface ToolUse {
  tool: string;
  args: unknown;
}

export class SearchInterceptor {
  private lastToolUse: ToolUse | null = null;

  constructor(private onWebfetchResult: SearchEventCallback) {}

  processEvent(event: AgentEvent): void {
    try {
      const raw = event.raw as Record<string, unknown> | undefined;
      if (!raw) return;

      if (raw.type === "tool_use" && typeof raw.name === "string") {
        this.lastToolUse = {
          tool: raw.name,
          args: raw.input,
        };
        return;
      }

      if (raw.type === "tool_result" && this.lastToolUse?.tool === "webfetch") {
        const content = typeof raw.content === "string" 
          ? raw.content 
          : "";
        
        if (content) {
          const truncated = content.length > MAX_CONTENT_LENGTH
            ? content.slice(0, MAX_CONTENT_LENGTH)
            : content;

          const args = this.lastToolUse.args as Record<string, unknown> | undefined;
          const source = typeof args?.url === "string" 
            ? args.url 
            : "unknown";

          this.onWebfetchResult(truncated, source);
        }

        this.lastToolUse = null;
      }
    } catch {
      // Silently ignore parsing errors
    }
  }
}
