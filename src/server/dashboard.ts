import type { OrchestratorSnapshot, TrainingMetrics, ExperimentResult } from "../orchestrator/orchestrator.js";
import type { HardwareMetrics } from "../monitor/hardware-monitor.js";
import type {
  MetricsConfig,
  ResultsSchema,
  SummaryMetricField,
  ProgressMetricField,
} from "../types/workflow.js";

/**
 * Format a number according to a printf-style format string. Only supports
 * %f/%d/%s with optional precision (e.g. "%.6f", "%d"). Falls back to
 * String(v) if the format can't be parsed.
 */
function formatMetric(v: number, fmt: string): string {
  const m = fmt.match(/^%(?:\.(\d+))?([fdes])$/);
  if (!m) return String(v);
  const precision = m[1] ? parseInt(m[1], 10) : undefined;
  const kind = m[2];
  if (kind === "d") return String(Math.round(v));
  if (kind === "e") return v.toExponential(precision ?? 6);
  return precision !== undefined ? v.toFixed(precision) : String(v);
}

/**
 * Generate an HTML dashboard from orchestrator snapshot.
 * Renders differently based on mode (autoresearch vs linear).
 */
export function renderDashboard(snapshot: OrchestratorSnapshot): string {
  const isAutoresearch = snapshot.mode === "autoresearch";
  const body = isAutoresearch
    ? renderAutoresearchBody(snapshot)
    : renderLinearBody(snapshot);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Symphony${isAutoresearch ? " Autoresearch" : ""}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace; background: #1d2021; color: #ebdbb2; overflow: hidden; height: 100vh; }

    /* Layout: header/stats/training are auto, then chart row + trace row split remaining space */
    .dashboard { display: flex; flex-direction: column; height: 100vh; padding: 0.75rem; gap: 0.6rem; }
    .header-row { display: flex; align-items: center; gap: 0.75rem; flex-shrink: 0; }
    .stats-row { display: flex; gap: 0.5rem; flex-wrap: wrap; flex-shrink: 0; }
    .training-row { flex-shrink: 0; }
    .content-area { flex: 1; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 0.6rem; min-height: 0; }

    /* Mobile: single column, scrollable, reordered panels */
    @media (max-width: 768px) {
      body { overflow: auto; height: auto; min-height: 100vh; }
      .dashboard { height: auto; min-height: 100vh; }
      .content-area { display: flex; flex-direction: column; gap: 0.6rem; }
      .content-area .panel { min-height: 280px; }
      .panel-chart { order: 1; }
      .panel-results { order: 2; }
      .panel-trace { order: 3; }
      .content-area .instruction-row { order: 4; }
      .panel-trace { grid-row: unset !important; }
      .header-row { flex-wrap: wrap; }
      .stat { min-width: 70px; }
      .stat-value { font-size: 1rem; }
    }

    /* Header */
    h1 { color: #fbf1c7; font-size: 1.3rem; }
    .mode-badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.65rem; font-weight: bold; text-transform: uppercase; letter-spacing: 0.05em; }
    .mode-autoresearch { background: #3c3836; color: #b8bb26; border: 1px solid #b8bb26; }
    .mode-linear { background: #3c3836; color: #83a598; border: 1px solid #83a598; }
    .status-running { color: #b8bb26; font-weight: bold; font-size: 0.8rem; }
    .status-stopped { color: #fb4934; font-weight: bold; font-size: 0.8rem; }
    .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 3px; animation: pulse 2s infinite; }
    .status-dot.active { background: #b8bb26; }
    .status-dot.inactive { background: #fb4934; animation: none; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    .timestamp { color: #928374; font-size: 0.65rem; margin-left: auto; }
    .connection-badge { font-size: 0.6rem; padding: 0.1rem 0.4rem; border-radius: 3px; }
    .connection-live { background: #3c3836; color: #b8bb26; border: 1px solid #504945; }
    .connection-dead { background: #3c3836; color: #fb4934; border: 1px solid #504945; }

    /* Stat cards */
    .stat { padding: 0.4rem 0.6rem; background: #282828; border-radius: 5px; border: 1px solid #3c3836; min-width: 85px; }
    .stat-value { font-size: 1.2rem; font-weight: bold; color: #fabd2f; }
    .stat-label { font-size: 0.6rem; color: #a89984; }
    .stat-green .stat-value { color: #b8bb26; }
    .stat-red .stat-value { color: #fb4934; }
    .stat-blue .stat-value { color: #83a598; }
    .stat-orange .stat-value { color: #fe8019; }
    .stat-purple .stat-value { color: #d3869b; }

    /* Panels */
    .panel { background: #282828; border: 1px solid #3c3836; border-radius: 5px; display: flex; flex-direction: column; overflow: hidden; min-height: 0; }
    .panel-header { padding: 0.35rem 0.6rem; border-bottom: 1px solid #3c3836; display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0; }
    .panel-header h2 { font-size: 0.8rem; color: #d5c4a1; font-weight: 600; }
    .panel-header .badge { font-size: 0.6rem; padding: 0.1rem 0.35rem; background: #3c3836; border-radius: 3px; color: #a89984; cursor: default; }
    .panel-header .badge-btn { cursor: pointer; }
    .panel-header .badge-btn:hover { background: #504945; }
    .panel-body { flex: 1; overflow: auto; min-height: 0; }
    .panel-body.padded { padding: 0.5rem; }

    /* Chart */
    .chart-container { position: relative; width: 100%; height: 100%; min-height: 80px; }
    .chart-container canvas { display: block; }

    /* Training bar */
    .training-bar { display: flex; gap: 0.6rem; align-items: center; background: #282828; border: 1px solid #3c3836; border-radius: 5px; padding: 0.35rem 0.6rem; flex-wrap: wrap; }
    .training-metric { font-size: 0.7rem; color: #a89984; white-space: nowrap; }
    .training-metric span { color: #ebdbb2; font-weight: bold; }
    .training-metric .highlight { color: #fabd2f; }
    .progress-bar { flex: 1; height: 5px; background: #3c3836; border-radius: 3px; overflow: hidden; max-width: 180px; min-width: 60px; }
    .progress-fill { height: 100%; background: linear-gradient(90deg, #b8bb26, #fabd2f); border-radius: 3px; transition: width 0.5s ease; }

    /* Hardware bar */
    .hardware-row { flex-shrink: 0; }
    .hardware-bar { display: flex; gap: 0.6rem; align-items: center; background: #282828; border: 1px solid #3c3836; border-radius: 5px; padding: 0.35rem 0.6rem; flex-wrap: wrap; }
    .hw-metric { font-size: 0.7rem; color: #a89984; white-space: nowrap; }
    .hw-metric span { color: #ebdbb2; font-weight: bold; }
    .hw-green { color: #b8bb26 !important; }
    .hw-yellow { color: #fabd2f !important; }
    .hw-red { color: #fb4934 !important; }

    /* Traces / Event log */
    .trace-list { font-size: 0.72rem; }
    .trace-entry { border-bottom: 1px solid #2a2a2a; cursor: pointer; }
    .trace-entry:hover { background: #32302f; }
    .trace-summary { padding: 0.25rem 0.6rem; display: flex; gap: 0.4rem; align-items: baseline; }
    .trace-time { color: #665c54; white-space: nowrap; flex-shrink: 0; min-width: 58px; font-size: 0.68rem; }
    .trace-type { font-weight: bold; white-space: nowrap; flex-shrink: 0; min-width: 80px; font-size: 0.68rem; }
    .trace-msg { color: #bdae93; word-break: break-word; flex: 1; font-size: 0.68rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .trace-expand-icon { color: #504945; flex-shrink: 0; font-size: 0.6rem; width: 12px; text-align: center; transition: transform 0.15s; }
    .trace-entry.expanded .trace-expand-icon { transform: rotate(90deg); }
    .trace-entry.expanded .trace-msg { white-space: normal; }
    .trace-detail { display: none; padding: 0.3rem 0.6rem 0.4rem 80px; border-top: 1px solid #2a2a2a; }
    .trace-entry.expanded .trace-detail { display: block; }
    .trace-raw { font-size: 0.65rem; color: #928374; white-space: pre-wrap; word-break: break-all; max-height: 200px; overflow: auto; background: #1d2021; border-radius: 3px; padding: 0.3rem 0.5rem; line-height: 1.4; }
    .trace-raw .key { color: #83a598; }
    .trace-raw .str { color: #b8bb26; }
    .trace-raw .num { color: #d3869b; }
    .trace-raw .bool { color: #fe8019; }
    .type-text { color: #ebdbb2; }
    .type-tool_use { color: #83a598; }
    .type-tool_result { color: #d3869b; }
    .type-step_start { color: #b8bb26; }
    .type-step_finish { color: #fabd2f; }
    .type-session_started { color: #b8bb26; }
    .type-run_crashed { color: #fb4934; }
    .type-run_completed { color: #b8bb26; }
    .type-run_failed { color: #fb4934; }
    .type-notification { color: #fe8019; }

    /* Results table */
    table { width: 100%; border-collapse: collapse; font-size: 0.7rem; }
    th, td { padding: 0.3rem 0.5rem; text-align: left; border-bottom: 1px solid #2a2a2a; }
    th { color: #a89984; font-weight: 600; position: sticky; top: 0; background: #282828; z-index: 1; }
    td { color: #ebdbb2; }
    tr:hover td { background: #32302f; }
    .status-keep { color: #b8bb26; }
    .status-discard { color: #928374; }
    .status-crash { color: #fb4934; }
    .bpb-best { color: #b8bb26; font-weight: bold; }
    .bpb-val { color: #fabd2f; }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 5px; height: 5px; }
    ::-webkit-scrollbar-track { background: #282828; }
    ::-webkit-scrollbar-thumb { background: #504945; border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: #665c54; }

    /* Linear mode */
    a { color: #83a598; }
    .message-cell { max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #bdae93; }

    /* Instruction input */
    .instruction-row { flex-shrink: 0; }
    .instruction-bar { display: flex; gap: 0.5rem; align-items: flex-start; background: #282828; border: 1px solid #3c3836; border-radius: 5px; padding: 0.4rem 0.6rem; }
    #instruction-input { flex: 1; background: #1d2021; color: #ebdbb2; border: 1px solid #504945; border-radius: 3px; padding: 0.3rem 0.5rem; font-family: inherit; font-size: 0.72rem; resize: vertical; min-height: 28px; max-height: 80px; }
    #instruction-input:focus { outline: none; border-color: #83a598; }
    .instruction-controls { display: flex; flex-direction: column; gap: 0.3rem; align-items: center; }
    .instruction-btn { background: #3c3836; color: #b8bb26; border: 1px solid #504945; border-radius: 3px; padding: 0.25rem 0.75rem; font-family: inherit; font-size: 0.7rem; cursor: pointer; white-space: nowrap; }
    .instruction-btn:hover { background: #504945; }
    .instruction-btn:disabled { color: #665c54; cursor: not-allowed; }
    .instruction-status { font-size: 0.6rem; color: #928374; white-space: nowrap; }
    .instruction-status.queued { color: #fabd2f; }
    .instruction-status.delivered { color: #b8bb26; }
  </style>
</head>
<body>
  ${body}
  ${isAutoresearch ? autoresearchScript(snapshot) : ""}
</body>
</html>`;
}

function renderAutoresearchBody(snapshot: OrchestratorSnapshot): string {
  const ar = snapshot.autoresearch;
  if (!ar) {
    return `
      <div class="dashboard">
        <div class="header-row">
          <h1>Symphony</h1>
          <span class="mode-badge mode-autoresearch">autoresearch</span>
        </div>
        <p style="color:#928374;margin-top:1rem;">Autoresearch has not started yet.</p>
      </div>`;
  }

  const statusClass = ar.active ? "status-running" : "status-stopped";
  const statusText = ar.active ? "RUNNING" : "STOPPED";
  const dotClass = ar.active ? "active" : "inactive";
  const uptime = formatDuration(ar.uptime_seconds);
  const training = snapshot.training;
  const metricsConfig = snapshot.autoresearch_metrics;
  const schema = snapshot.autoresearch_schema;
  const primaryLabel = metricsConfig?.primary.label ?? "metric";
  const trainingBar = training && metricsConfig
    ? renderTrainingBar(training, metricsConfig)
    : `<div class="training-bar"><span class="training-metric" style="color:#665c54;">Waiting for training data...</span></div>`;
  const hardwareBar = renderHardwareBar(snapshot.hardware);
  const tableHeaderCells = schema
    ? schema.columns.map((c) => `<th>${esc(c === schema.metric_column ? primaryLabel : c)}</th>`).join("")
    : `<th>Commit</th><th>${esc(primaryLabel)}</th><th>Status</th><th>Description</th>`;
  const tableColspan = schema ? schema.columns.length : 4;

  return `
    <div class="dashboard">
      <div class="header-row">
        <h1>Symphony</h1>
        <span class="mode-badge mode-autoresearch">autoresearch</span>
        <span class="status-dot ${dotClass}"></span>
        <span class="${statusClass}">${statusText}</span>
        <span id="connection-badge" class="connection-badge connection-dead">CONNECTING</span>
        <span class="timestamp" id="updated-at">Updated ${esc(snapshot.generated_at)}</span>
      </div>

      <div class="stats-row">
        <div class="stat stat-green">
          <div class="stat-value" id="stat-uptime">${uptime}</div>
          <div class="stat-label">Uptime</div>
        </div>
        <div class="stat">
          <div class="stat-value" id="stat-steps">${ar.step_count}</div>
          <div class="stat-label">Agent Steps</div>
        </div>
        <div class="stat stat-blue">
          <div class="stat-value" id="stat-tools">${ar.tool_calls}</div>
          <div class="stat-label">Tool Calls</div>
        </div>
        <div class="stat${ar.crash_count > 0 ? " stat-red" : ""}">
          <div class="stat-value" id="stat-crashes">${ar.crash_count}</div>
          <div class="stat-label">Crashes</div>
        </div>
        <div class="stat stat-orange">
          <div class="stat-value" id="stat-experiments">-</div>
          <div class="stat-label">Experiments</div>
        </div>
        <div class="stat stat-purple">
          <div class="stat-value" id="stat-bestbpb">-</div>
          <div class="stat-label">Best ${esc(primaryLabel)}</div>
        </div>
      </div>

      <div class="hardware-row" id="hardware-bar">${hardwareBar}</div>

      <div class="training-row" id="training-bar">${trainingBar}</div>

      <div class="content-area">
        <!-- Top-left: Experiment Progress -->
        <div class="panel panel-chart">
          <div class="panel-header">
            <h2>Experiment Progress</h2>
            <span class="badge" id="exp-count">0 experiments</span>
          </div>
          <div class="panel-body padded">
            <div class="chart-container" id="chart-container">
              <canvas id="exp-chart"></canvas>
            </div>
          </div>
        </div>

        <!-- Top-right: Agent Trace (spans both rows on desktop) -->
        <div class="panel panel-trace" style="grid-row: 1 / 3;">
          <div class="panel-header">
            <h2>Agent Trace</h2>
            <span class="badge" id="trace-count">${snapshot.event_log.length}</span>
            <span class="badge badge-btn" style="margin-left:auto;" id="trace-autoscroll">Auto-scroll: ON</span>
          </div>
          <div class="panel-body" id="trace-container">
            <div class="trace-list" id="trace-list">
              ${renderEventLog(snapshot.event_log)}
            </div>
          </div>
        </div>

        <!-- Bottom-left: Experiment Results -->
        <div class="panel panel-results">
          <div class="panel-header">
            <h2>Experiment Results</h2>
            <span class="badge" id="results-count">0</span>
          </div>
          <div class="panel-body">
            <table id="results-table">
             <thead>
                 <tr>${tableHeaderCells}</tr>
               </thead>
               <tbody id="results-body">
                 <tr><td colspan="${tableColspan}" style="text-align:center;color:#665c54;padding:0.75rem;">Loading...</td></tr>
               </tbody>
            </table>
          </div>
        </div>

        <div class="instruction-row">
          <div class="instruction-bar">
            <textarea id="instruction-input" placeholder="Give instructions to the agent (delivered between experiments)..." rows="2"></textarea>
            <div class="instruction-controls">
              <button id="instruction-send" class="instruction-btn">Send</button>
              <span id="instruction-status" class="instruction-status"></span>
            </div>
          </div>
        </div>
      </div>`;
}

function renderTrainingBar(t: TrainingMetrics, metricsConfig: MetricsConfig): string {
  const f = t.fields;
  const pct = f["progress_pct"] ?? 0;
  const parts: string[] = [];

  // Progress-line fields: render any that have a label and a current value.
  for (const pl of metricsConfig.progress_line) {
    if (!pl.label) continue;
    const v = f[pl.name];
    if (v === undefined) continue;
    parts.push(renderChip(pl.label, v, pl.name));
  }

  // Summary fields: render any that have a label and a current value.
  for (const sf of metricsConfig.summary_fields) {
    if (!sf.label) continue;
    const v = f[sf.name];
    if (v === undefined) continue;
    parts.push(renderChip(sf.label, v, sf.name));
  }

  // Primary metric: always highlighted when present.
  const primaryVal = f[metricsConfig.primary.name];
  if (primaryVal !== undefined) {
    parts.push(
      `<span class="training-metric">${esc(metricsConfig.primary.label)} ` +
      `<span class="highlight">${formatMetric(primaryVal, metricsConfig.primary.format)}</span></span>`,
    );
  }

  return `<div class="training-bar">
    ${parts.join("")}
    <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
    <span class="training-metric"><span>${pct.toFixed(1)}%</span></span>
  </div>`;
}

/** Render a single chip. A few names get domain-friendly display. */
function renderChip(label: string, value: number, fieldName: string): string {
  let display: string;
  if (fieldName === "tok_per_sec") display = value.toLocaleString();
  else if (fieldName === "peak_vram_mb") display = (value / 1024).toFixed(1) + "GB";
  else if (fieldName === "dt_ms") display = value + "ms";
  else if (fieldName === "remaining_sec") display = value + "s";
  else if (fieldName === "mfu_pct" || fieldName === "mfu_percent") display = value.toFixed(1) + "%";
  else if (Number.isInteger(value)) display = String(value);
  else display = value.toFixed(4);
  return `<span class="training-metric">${esc(label)} <span>${display}</span></span>`;
}

function renderHardwareBar(hw: HardwareMetrics | null): string {
  if (!hw) {
    return `<div class="hardware-bar"><span class="hw-metric" style="color:#665c54;">Hardware monitoring unavailable</span></div>`;
  }

  const parts: string[] = [];

  // GPU utilization with color coding
  if (hw.gpu_utilization_pct !== null) {
    const utilClass = hw.gpu_utilization_pct >= 95 ? "hw-red" : hw.gpu_utilization_pct >= 80 ? "hw-yellow" : "hw-green";
    parts.push(`<span class="hw-metric">GPU <span class="${utilClass}">${hw.gpu_utilization_pct.toFixed(0)}%</span></span>`);
  }

  // GPU temperature with color coding
  if (hw.gpu_temperature_c !== null) {
    const tempClass = hw.gpu_temperature_c >= 85 ? "hw-red" : hw.gpu_temperature_c >= 75 ? "hw-yellow" : "hw-green";
    parts.push(`<span class="hw-metric">Temp <span class="${tempClass}">${hw.gpu_temperature_c.toFixed(0)}°C</span></span>`);
  }

  // Power draw
  if (hw.power_draw_w !== null) {
    parts.push(`<span class="hw-metric">Power <span>${hw.power_draw_w.toFixed(0)}W</span></span>`);
  }

  // Memory available/total
  parts.push(`<span class="hw-metric">RAM <span>${hw.mem_available_gb.toFixed(1)}/${hw.mem_total_gb.toFixed(1)}GB</span></span>`);

  return `<div class="hardware-bar">${parts.join("")}</div>`;
}

function renderEventLog(events: Array<{ timestamp: string; type: string; message: string; raw?: unknown }>): string {
  return events.map((e) => {
    const time = new Date(e.timestamp).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const typeClass = classifyTraceType(e.message);
    const displayType = extractDisplayType(e.type, e.message);
    const displayMsg = extractDisplayMsg(e.message);
    const hasRaw = e.raw !== undefined && e.raw !== null;
    const rawJson = hasRaw ? esc(JSON.stringify(e.raw, null, 2)) : "";
    return `<div class="trace-entry${hasRaw ? "" : " no-raw"}" ${hasRaw ? `data-raw="${rawJson}"` : ""}>
      <div class="trace-summary">
        ${hasRaw ? '<span class="trace-expand-icon">&#9654;</span>' : '<span class="trace-expand-icon" style="visibility:hidden">&#9654;</span>'}
        <span class="trace-time">${time}</span>
        <span class="trace-type ${typeClass}">${esc(displayType)}</span>
        <span class="trace-msg">${esc(displayMsg)}</span>
      </div>
      ${hasRaw ? '<div class="trace-detail"><pre class="trace-raw"></pre></div>' : ""}
    </div>`;
  }).join("");
}

function classifyTraceType(message: string): string {
  if (message.startsWith("[tool_use]")) return "type-tool_use";
  if (message.startsWith("[tool_result]")) return "type-tool_result";
  if (message.startsWith("[text]")) return "type-text";
  if (message.startsWith("[step_start]")) return "type-step_start";
  if (message.startsWith("[step_finish]")) return "type-step_finish";
  return "type-notification";
}

function extractDisplayType(type: string, message: string): string {
  const m = message.match(/^\[([^\]]+)\]/);
  if (m) return m[1];
  return type;
}

function extractDisplayMsg(message: string): string {
  const m = message.match(/^\[[^\]]+\]\s*(.*)/);
  if (m) return m[1];
  return message;
}

function autoresearchScript(snapshot: OrchestratorSnapshot): string {
  const metricsJson = JSON.stringify(snapshot.autoresearch_metrics ?? null);
  const schemaJson = JSON.stringify(snapshot.autoresearch_schema ?? null);
  return `<script>
(function() {
  let autoScroll = true;
  let traceCount = ${snapshot.event_log.length};
  let expResults = [];
  const METRICS = ${metricsJson};
  const SCHEMA = ${schemaJson};
  const PRIMARY = METRICS ? METRICS.primary : { name: 'val_bpb', direction: 'minimize', label: 'val_bpb', format: '%.6f' };
  const MINIMIZE = PRIMARY.direction !== 'maximize';

  function fmtMetric(v, fmt) {
    if (v === undefined || v === null || isNaN(v)) return '-';
    const m = String(fmt || '').match(/^%(?:\\.(\\d+))?([fdes])$/);
    if (!m) return String(v);
    const p = m[1] ? parseInt(m[1],10) : undefined;
    const k = m[2];
    if (k === 'd') return String(Math.round(v));
    if (k === 'e') return v.toExponential(p !== undefined ? p : 6);
    return p !== undefined ? v.toFixed(p) : String(v);
  }

  function chipDisplay(value, fieldName) {
    if (fieldName === 'tok_per_sec') return value.toLocaleString();
    if (fieldName === 'peak_vram_mb') return (value/1024).toFixed(1) + 'GB';
    if (fieldName === 'dt_ms') return value + 'ms';
    if (fieldName === 'remaining_sec') return value + 's';
    if (fieldName === 'mfu_pct' || fieldName === 'mfu_percent') return value.toFixed(1) + '%';
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(4);
  }

  // --- SSE ---
  function connectSSE() {
    const es = new EventSource('/api/v1/events');
    const badge = document.getElementById('connection-badge');
    es.onopen = () => { badge.textContent = 'LIVE'; badge.className = 'connection-badge connection-live'; };
    es.onerror = () => { badge.textContent = 'RECONNECTING'; badge.className = 'connection-badge connection-dead'; };
    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data);
        addTraceEntry(evt);
        traceCount++;
        document.getElementById('trace-count').textContent = traceCount;
      } catch {}
    };
  }
  connectSSE();

  // --- Trace click-to-expand ---
  document.getElementById('trace-list').addEventListener('click', (e) => {
    const entry = e.target.closest('.trace-entry');
    if (!entry || entry.classList.contains('no-raw')) return;

    entry.classList.toggle('expanded');
    const detail = entry.querySelector('.trace-detail');
    if (detail && entry.classList.contains('expanded')) {
      const pre = detail.querySelector('.trace-raw');
      if (pre && !pre.dataset.loaded) {
        const rawAttr = entry.getAttribute('data-raw');
        if (rawAttr) {
          pre.innerHTML = syntaxHighlight(rawAttr);
          pre.dataset.loaded = '1';
        }
      }
    }
  });

  function syntaxHighlight(jsonStr) {
    return jsonStr
      .replace(/("(?:\\\\.|[^"\\\\])*")\\s*:/g, '<span class="key">$1</span>:')
      .replace(/:\\s*("(?:\\\\.|[^"\\\\])*")/g, ': <span class="str">$1</span>')
      .replace(/:\\s*(\\d+\\.?\\d*)/g, ': <span class="num">$1</span>')
      .replace(/:\\s*(true|false|null)/g, ': <span class="bool">$1</span>');
  }

  // --- Add trace entries from SSE ---
  function addTraceEntry(evt) {
    const list = document.getElementById('trace-list');
    const container = document.getElementById('trace-container');
    const d = document.createElement('div');
    const hasRaw = evt.raw !== undefined && evt.raw !== null;
    d.className = 'trace-entry' + (hasRaw ? '' : ' no-raw');
    if (hasRaw) {
      d.setAttribute('data-raw', esc(JSON.stringify(evt.raw, null, 2)));
    }

    const time = new Date(evt.timestamp).toLocaleTimeString('en-US', {hour12:false, hour:'2-digit', minute:'2-digit', second:'2-digit'});
    const typeClass = classifyType(evt.message || '');
    const displayType = extractType(evt.type, evt.message || '');
    const displayMsg = extractMsg(evt.message || '');

    let html = '<div class="trace-summary">';
    html += hasRaw
      ? '<span class="trace-expand-icon">&#9654;</span>'
      : '<span class="trace-expand-icon" style="visibility:hidden">&#9654;</span>';
    html += '<span class="trace-time">' + esc(time) + '</span>';
    html += '<span class="trace-type ' + typeClass + '">' + esc(displayType) + '</span>';
    html += '<span class="trace-msg">' + esc(displayMsg) + '</span>';
    html += '</div>';
    if (hasRaw) {
      html += '<div class="trace-detail"><pre class="trace-raw"></pre></div>';
    }
    d.innerHTML = html;
    list.appendChild(d);

    while (list.children.length > 500) list.removeChild(list.firstChild);
    if (autoScroll) container.scrollTop = container.scrollHeight;
  }

  function classifyType(msg) {
    if (msg.startsWith('[tool_use]')) return 'type-tool_use';
    if (msg.startsWith('[tool_result]')) return 'type-tool_result';
    if (msg.startsWith('[text]')) return 'type-text';
    if (msg.startsWith('[step_start]')) return 'type-step_start';
    if (msg.startsWith('[step_finish]')) return 'type-step_finish';
    return 'type-notification';
  }

  function extractType(type, msg) {
    const m = msg.match(/^\\[([^\\]]+)\\]/);
    return m ? m[1] : type;
  }

  function extractMsg(msg) {
    const m = msg.match(/^\\[[^\\]]+\\]\\s*(.*)/);
    return m ? m[1] : msg;
  }

  function esc(s) {
    const d = document.createElement('span');
    d.textContent = s;
    return d.innerHTML;
  }

  // --- Auto-scroll toggle ---
  document.getElementById('trace-autoscroll').addEventListener('click', () => {
    autoScroll = !autoScroll;
    document.getElementById('trace-autoscroll').textContent = 'Auto-scroll: ' + (autoScroll ? 'ON' : 'OFF');
  });
  const tc = document.getElementById('trace-container');
  tc.scrollTop = tc.scrollHeight;

  // --- Experiment Progress Chart ---
  const canvas = document.getElementById('exp-chart');
  const ctx = canvas.getContext('2d');

  function drawChart() {
    const box = document.getElementById('chart-container');
    const w = box.clientWidth;
    const h = box.clientHeight;
    if (w < 10 || h < 10) return;
    canvas.width = w * devicePixelRatio;
    canvas.height = h * devicePixelRatio;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.clearRect(0, 0, w, h);

    // Filter to experiments with a finite primary metric value.
    const valid = expResults.filter(r => Number.isFinite(r.metric));
    if (valid.length < 1) {
      ctx.fillStyle = '#665c54'; ctx.font = '12px monospace'; ctx.textAlign = 'center';
      ctx.fillText('Waiting for experiment results...', w/2, h/2);
      return;
    }

    const pad = {top:20, right:15, bottom:28, left:55};
    const cw = w - pad.left - pad.right;
    const ch = h - pad.top - pad.bottom;

    // Axis ranges on the primary metric
    const metrics = valid.map(r => r.metric);
    const maxM = Math.max(...metrics);
    const minM = Math.min(...metrics);
    const mMargin = (maxM - minM) * 0.08 || 0.005;
    const yMax = maxM + mMargin;
    const yMin = minM - mMargin;
    const yr = yMax - yMin;
    const xMax = expResults.length;
    const xr = xMax || 1;

    // Grid
    ctx.strokeStyle = '#3c3836'; ctx.lineWidth = 0.5;
    for (let i=0;i<=4;i++){const y=pad.top+ch*i/4;ctx.beginPath();ctx.moveTo(pad.left,y);ctx.lineTo(w-pad.right,y);ctx.stroke();}

    // Y labels (primary metric)
    ctx.fillStyle = '#928374'; ctx.font = '9px monospace'; ctx.textAlign = 'right';
    for (let i=0;i<=4;i++){const v=yMax-yr*i/4;ctx.fillText(v.toFixed(4),pad.left-4,pad.top+ch*i/4+3);}
    ctx.save(); ctx.translate(10, pad.top+ch/2); ctx.rotate(-Math.PI/2);
    ctx.fillStyle = '#665c54'; ctx.font = '8px monospace'; ctx.textAlign = 'center';
    ctx.fillText(PRIMARY.label, 0, 0);
    ctx.restore();

    // X labels (experiment #)
    ctx.textAlign = 'center';
    const xTicks = Math.min(xMax, 5);
    for (let i=0;i<=xTicks;i++){const v=Math.round(xMax*i/xTicks);ctx.fillText(String(v),pad.left+cw*(v/xr),h-8);}

    // X axis label
    ctx.fillStyle = '#665c54'; ctx.font = '8px monospace'; ctx.textAlign = 'center';
    ctx.fillText('experiment #', pad.left + cw/2, h - 1);

    // Running best line (only from kept experiments; direction-aware)
    const keepStatus = SCHEMA ? SCHEMA.keep_status : 'keep';
    let runBest = MINIMIZE ? Infinity : -Infinity;
    const bestLine = [];
    for (let i = 0; i < expResults.length; i++) {
      const r = expResults[i];
      if (r.status === keepStatus && Number.isFinite(r.metric)) {
        const better = MINIMIZE ? r.metric < runBest : r.metric > runBest;
        if (better) runBest = r.metric;
      }
      if (Number.isFinite(runBest)) bestLine.push({x: i, y: runBest});
    }
    if (bestLine.length > 0) {
      ctx.beginPath(); ctx.strokeStyle = '#fabd2f'; ctx.lineWidth = 2.5;
      for (let i = 0; i < bestLine.length; i++) {
        const x = pad.left + ((bestLine[i].x + 0.5) / xr) * cw;
        const y = pad.top + ((yMax - bestLine[i].y) / yr) * ch;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Scatter dots (color by status: keep / crash / other=discard)
    const crashSet = new Set(SCHEMA ? (SCHEMA.discard_statuses || []).filter(s => s === 'crash') : ['crash']);
    for (let i = 0; i < expResults.length; i++) {
      const r = expResults[i];
      if (!Number.isFinite(r.metric)) continue;
      const x = pad.left + ((i + 0.5) / xr) * cw;
      const y = pad.top + ((yMax - r.metric) / yr) * ch;
      let color = '#928374', radius = 3;
      if (r.status === keepStatus) { color = '#b8bb26'; radius = 4; }
      else if (crashSet.has(r.status)) { color = '#fb4934'; radius = 3.5; }
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
      if (r.status === keepStatus) {
        ctx.strokeStyle = '#b8bb26'; ctx.lineWidth = 1; ctx.stroke();
      }
    }

    // Crash markers (X at top of chart) for rows whose metric couldn't be parsed
    for (let i = 0; i < expResults.length; i++) {
      const r = expResults[i];
      if (!crashSet.has(r.status) || Number.isFinite(r.metric)) continue;
      const x = pad.left + ((i + 0.5) / xr) * cw;
      const y = pad.top + 8;
      ctx.strokeStyle = '#fb4934'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x-3, y-3); ctx.lineTo(x+3, y+3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x+3, y-3); ctx.lineTo(x-3, y+3); ctx.stroke();
    }

    // Legend
    const lx = w - pad.right - 105;
    const items = [
      {color:'#b8bb26', label:'kept', shape:'circle'},
      {color:'#928374', label:'discarded', shape:'circle'},
      {color:'#fb4934', label:'crash', shape:'x'},
      {color:'#fabd2f', label:'running best', shape:'line'},
    ];
    ctx.font = '8px monospace'; ctx.textAlign = 'left';
    for (let i = 0; i < items.length; i++) {
      const ly = pad.top + i * 11;
      if (items[i].shape === 'circle') {
        ctx.beginPath(); ctx.arc(lx + 4, ly, 3, 0, Math.PI * 2);
        ctx.fillStyle = items[i].color; ctx.fill();
      } else if (items[i].shape === 'x') {
        ctx.strokeStyle = items[i].color; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(lx+1, ly-3); ctx.lineTo(lx+7, ly+3); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(lx+7, ly-3); ctx.lineTo(lx+1, ly+3); ctx.stroke();
      } else {
        ctx.fillStyle = items[i].color; ctx.fillRect(lx, ly - 1, 10, 2);
      }
      ctx.fillStyle = '#928374';
      ctx.fillText(items[i].label, lx + 14, ly + 3);
    }

    document.getElementById('exp-count').textContent = expResults.length + ' experiments';
  }

  drawChart();
  window.addEventListener('resize', drawChart);

  // --- Poll ---
  async function pollState() {
    try {
      const [stateRes, trainingRes, resultsRes, hardwareRes] = await Promise.all([
        fetch('/api/v1/state'), fetch('/api/v1/training'), fetch('/api/v1/results'), fetch('/api/v1/hardware')
      ]);
      if (stateRes.ok) {
        const state = await stateRes.json();
        const ar = state.autoresearch;
        if (ar) {
          document.getElementById('stat-uptime').textContent = fmtDur(ar.uptime_seconds);
          document.getElementById('stat-steps').textContent = ar.step_count;
          document.getElementById('stat-tools').textContent = ar.tool_calls;
          document.getElementById('stat-crashes').textContent = ar.crash_count;
        }
        document.getElementById('updated-at').textContent = 'Updated ' + new Date(state.generated_at).toLocaleTimeString();
      }
      if (trainingRes.ok) {
        const t = await trainingRes.json();
        if (t && t.fields) updateTrainingBar(t);
      }
      if (resultsRes.ok) {
        const results = await resultsRes.json();
        if (Array.isArray(results)) {
          updateResultsTable(results);
          if (results.length !== expResults.length) {
            expResults = results;
            drawChart();
          }
        }
      }
      if (hardwareRes.ok) {
        const hw = await hardwareRes.json();
        if (hw && hw.gpu_utilization_pct !== undefined) updateHardwareBar(hw);
      }
      const instrRes = await fetch('/api/v1/instruction');
      if (instrRes.ok) {
        const instrStatus = await instrRes.json();
        updateInstructionStatus(instrStatus);
      }
    } catch {}
  }

  function updateTrainingBar(t) {
    const bar = document.getElementById('training-bar');
    const f = t.fields || {};
    const pct = f.progress_pct || 0;
    const p = [];
    if (METRICS) {
      for (const pl of METRICS.progress_line) {
        if (!pl.label) continue;
        const v = f[pl.name];
        if (v === undefined) continue;
        p.push('<span class="training-metric">'+esc(pl.label)+' <span>'+chipDisplay(v, pl.name)+'</span></span>');
      }
      for (const sf of METRICS.summary_fields) {
        if (!sf.label) continue;
        const v = f[sf.name];
        if (v === undefined) continue;
        p.push('<span class="training-metric">'+esc(sf.label)+' <span>'+chipDisplay(v, sf.name)+'</span></span>');
      }
      const pv = f[PRIMARY.name];
      if (pv !== undefined) {
        p.push('<span class="training-metric">'+esc(PRIMARY.label)+' <span class="highlight">'+fmtMetric(pv, PRIMARY.format)+'</span></span>');
      }
    }
    bar.innerHTML = '<div class="training-bar">'+p.join('')
      +'<div class="progress-bar"><div class="progress-fill" style="width:'+pct+'%"></div></div>'
      +'<span class="training-metric"><span>'+pct.toFixed(1)+'%</span></span></div>';
  }

  function updateHardwareBar(hw) {
    const bar = document.getElementById('hardware-bar');
    if (!hw || hw.status === 'unavailable') {
      bar.innerHTML = '<div class="hardware-bar"><span class="hw-metric" style="color:#665c54;">Hardware monitoring unavailable</span></div>';
      return;
    }
    let p = [];
    if (hw.gpu_utilization_pct !== null) {
      const u = hw.gpu_utilization_pct;
      const cls = u >= 95 ? 'hw-red' : u >= 80 ? 'hw-yellow' : 'hw-green';
      p.push('<span class="hw-metric">GPU <span class="'+cls+'">'+Math.round(u)+'%</span></span>');
    }
    if (hw.gpu_temperature_c !== null) {
      const t = hw.gpu_temperature_c;
      const cls = t >= 85 ? 'hw-red' : t >= 75 ? 'hw-yellow' : 'hw-green';
      p.push('<span class="hw-metric">Temp <span class="'+cls+'">'+Math.round(t)+'°C</span></span>');
    }
    if (hw.power_draw_w !== null) {
      p.push('<span class="hw-metric">Power <span>'+Math.round(hw.power_draw_w)+'W</span></span>');
    }
    p.push('<span class="hw-metric">RAM <span>'+(hw.mem_available_gb||0).toFixed(1)+'/'+(hw.mem_total_gb||0).toFixed(1)+'GB</span></span>');
    bar.innerHTML = '<div class="hardware-bar">'+p.join('')+'</div>';
  }

  function updateResultsTable(results) {
    const body = document.getElementById('results-body');
    document.getElementById('results-count').textContent = results.length;
    document.getElementById('stat-experiments').textContent = results.length;
    const keepStatus = SCHEMA ? SCHEMA.keep_status : 'keep';
    const columns = SCHEMA ? SCHEMA.columns : ['commit','val_bpb','status','description'];
    const metricCol = SCHEMA ? SCHEMA.metric_column : 'val_bpb';
    const statusCol = SCHEMA ? SCHEMA.status_column : 'status';

    let best = MINIMIZE ? Infinity : -Infinity;
    for (const r of results) {
      if (r.status !== keepStatus || !Number.isFinite(r.metric)) continue;
      if (MINIMIZE ? r.metric < best : r.metric > best) best = r.metric;
    }
    if (Number.isFinite(best)) document.getElementById('stat-bestbpb').textContent = fmtMetric(best, PRIMARY.format);

    if (!results.length) {
      body.innerHTML='<tr><td colspan="'+columns.length+'" style="text-align:center;color:#665c54;padding:0.75rem;">No experiments yet</td></tr>';
      return;
    }
    body.innerHTML = results.slice().reverse().map(r => {
      const row = r.row || {};
      const isBestRow = r.status === keepStatus && Number.isFinite(r.metric) && r.metric === best;
      const cells = columns.map(col => {
        const raw = row[col] ?? '';
        if (col === 'commit') {
          return '<td style="font-family:monospace;color:#83a598;">'+esc(raw)+'</td>';
        }
        if (col === metricCol) {
          const cls = isBestRow ? 'bpb-best' : 'bpb-val';
          const v = parseFloat(raw);
          const disp = Number.isFinite(v) ? fmtMetric(v, PRIMARY.format) : '-';
          return '<td class="'+cls+'">'+disp+'</td>';
        }
        if (col === statusCol) {
          return '<td class="status-'+esc(raw)+'">'+esc(raw)+'</td>';
        }
        return '<td style="color:#bdae93;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+esc(raw)+'</td>';
      }).join('');
      return '<tr>'+cells+'</tr>';
    }).join('');
  }

  function fmtDur(s) {
    if(s<60) return s+'s';
    if(s<3600) return Math.floor(s/60)+'m '+(s%60)+'s';
    return Math.floor(s/3600)+'h '+Math.floor((s%3600)/60)+'m';
  }

  // --- User Instructions ---
  document.getElementById('instruction-send').addEventListener('click', async () => {
    const input = document.getElementById('instruction-input');
    const msg = input.value.trim();
    if (!msg) return;
    const btn = document.getElementById('instruction-send');
    btn.disabled = true;
    try {
      const res = await fetch('/api/v1/instruction', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ message: msg })
      });
      if (res.ok) {
        input.value = '';
        updateInstructionStatus({ status: 'queued' });
      }
    } catch {}
    btn.disabled = false;
  });

  document.getElementById('instruction-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      document.getElementById('instruction-send').click();
    }
  });

  function updateInstructionStatus(s) {
    const el = document.getElementById('instruction-status');
    if (s.status === 'queued') {
      el.textContent = 'Queued — will deliver after next agent step';
      el.className = 'instruction-status queued';
    } else if (s.status === 'delivered') {
      el.textContent = 'Delivered ' + new Date(s.delivered_at).toLocaleTimeString();
      el.className = 'instruction-status delivered';
    } else {
      el.textContent = '';
      el.className = 'instruction-status';
    }
  }

  setInterval(pollState, 5000);
  pollState();
})();
</script>`;
}

function renderLinearBody(snapshot: OrchestratorSnapshot): string {
  const runningRows = snapshot.running
    .map(
      (r) => `
      <tr>
        <td>${esc(r.issue_identifier)}</td>
        <td>${esc(r.state)}</td>
        <td>${r.turn_count}</td>
        <td>${esc(r.last_event ?? "-")}</td>
        <td class="message-cell">${esc(r.last_message || "-")}</td>
        <td>${esc(r.started_at)}</td>
      </tr>`,
    )
    .join("\n");

  const retryRows = snapshot.retrying
    .map(
      (r) => `
      <tr>
        <td>${esc(r.issue_identifier)}</td>
        <td>${r.attempt}</td>
        <td>${esc(r.due_at)}</td>
        <td class="message-cell">${esc(r.error ?? "-")}</td>
      </tr>`,
    )
    .join("\n");

  return `
    <div style="padding:2rem;">
      <div class="header-row">
        <h1>Symphony</h1>
        <span class="mode-badge mode-linear">linear</span>
      </div>
      <p class="timestamp" style="margin:0.5rem 0;">Updated ${esc(snapshot.generated_at)}</p>
      <div class="stats-row" style="margin:1rem 0;">
        <div class="stat stat-green"><div class="stat-value">${snapshot.counts.running}</div><div class="stat-label">Running</div></div>
        <div class="stat stat-orange"><div class="stat-value">${snapshot.counts.retrying}</div><div class="stat-label">Retrying</div></div>
        <div class="stat"><div class="stat-value">${snapshot.agent_totals.experiments_run}</div><div class="stat-label">Experiments</div></div>
        <div class="stat stat-blue"><div class="stat-value">${formatDuration(snapshot.agent_totals.seconds_running)}</div><div class="stat-label">Runtime</div></div>
        <div class="stat${snapshot.agent_totals.crash_restarts > 0 ? " stat-red" : ""}"><div class="stat-value">${snapshot.agent_totals.crash_restarts}</div><div class="stat-label">Crashes</div></div>
      </div>
      <h2 style="color:#a89984;margin:1.5rem 0 0.5rem;font-size:1rem;">Running (${snapshot.counts.running})</h2>
      <table><thead><tr><th>Issue</th><th>State</th><th>Turns</th><th>Last Event</th><th>Last Message</th><th>Started</th></tr></thead>
      <tbody>${runningRows || '<tr><td colspan="6" style="text-align:center;color:#928374;">No running sessions</td></tr>'}</tbody></table>
      <h2 style="color:#a89984;margin:1.5rem 0 0.5rem;font-size:1rem;">Retry Queue (${snapshot.counts.retrying})</h2>
      <table><thead><tr><th>Issue</th><th>Attempt</th><th>Due At</th><th>Error</th></tr></thead>
      <tbody>${retryRows || '<tr><td colspan="4" style="text-align:center;color:#928374;">No retries queued</td></tr>'}</tbody></table>
    </div>`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
