import type { OrchestratorSnapshot } from "../orchestrator/orchestrator.js";

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
  const trainingBar = training ? renderTrainingBar(training) : `<div class="training-bar"><span class="training-metric" style="color:#665c54;">Waiting for training data...</span></div>`;

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
          <div class="stat-label">Best val_bpb</div>
        </div>
      </div>

      <div class="training-row" id="training-bar">${trainingBar}</div>

      <div class="content-area">
        <!-- Top-left: Loss Curve -->
        <div class="panel">
          <div class="panel-header">
            <h2>Loss Curve</h2>
            <span class="badge" id="loss-count">0 pts</span>
          </div>
          <div class="panel-body padded">
            <div class="chart-container" id="chart-container">
              <canvas id="loss-chart"></canvas>
            </div>
          </div>
        </div>

        <!-- Top-right: Agent Trace (spans both rows) -->
        <div class="panel" style="grid-row: 1 / 3;">
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
        <div class="panel">
          <div class="panel-header">
            <h2>Experiment Results</h2>
            <span class="badge" id="results-count">0</span>
          </div>
          <div class="panel-body">
            <table id="results-table">
              <thead>
                <tr>
                  <th>Commit</th>
                  <th>val_bpb</th>
                  <th>VRAM</th>
                  <th>Status</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody id="results-body">
                <tr><td colspan="5" style="text-align:center;color:#665c54;padding:0.75rem;">Loading...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
}

function renderTrainingBar(t: import("../orchestrator/orchestrator.js").TrainingMetrics): string {
  const pct = t.progress_pct ?? 0;
  const parts: string[] = [];
  if (t.step !== undefined) parts.push(`<span class="training-metric">Step <span>${t.step}</span></span>`);
  if (t.loss !== undefined) parts.push(`<span class="training-metric">Loss <span class="highlight">${t.loss.toFixed(4)}</span></span>`);
  if (t.tok_per_sec !== undefined) parts.push(`<span class="training-metric">Tok/s <span>${t.tok_per_sec.toLocaleString()}</span></span>`);
  if (t.mfu_pct !== undefined) parts.push(`<span class="training-metric">MFU <span>${t.mfu_pct.toFixed(1)}%</span></span>`);
  if (t.dt_ms !== undefined) parts.push(`<span class="training-metric">dt <span>${t.dt_ms}ms</span></span>`);
  if (t.remaining_sec !== undefined) parts.push(`<span class="training-metric">ETA <span>${t.remaining_sec}s</span></span>`);
  if (t.peak_vram_mb !== undefined) parts.push(`<span class="training-metric">VRAM <span>${(t.peak_vram_mb / 1024).toFixed(1)}GB</span></span>`);
  if (t.val_bpb !== undefined) parts.push(`<span class="training-metric">val_bpb <span class="highlight">${t.val_bpb.toFixed(6)}</span></span>`);

  return `<div class="training-bar">
    ${parts.join("")}
    <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
    <span class="training-metric"><span>${pct.toFixed(1)}%</span></span>
  </div>`;
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
  const lossHistoryJson = JSON.stringify(snapshot.loss_history ?? []);

  return `<script>
(function() {
  let autoScroll = true;
  let traceCount = ${snapshot.event_log.length};
  let lossData = ${lossHistoryJson};

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

  // --- Loss Chart ---
  const canvas = document.getElementById('loss-chart');
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

    if (lossData.length < 2) {
      ctx.fillStyle = '#665c54'; ctx.font = '12px monospace'; ctx.textAlign = 'center';
      ctx.fillText('Waiting for training data...', w/2, h/2);
      return;
    }

    const pad = {top:15, right:12, bottom:25, left:50};
    const cw = w - pad.left - pad.right;
    const ch = h - pad.top - pad.bottom;

    const steps = lossData.map(d=>d.step), losses = lossData.map(d=>d.loss);
    const minStep = Math.min(...steps), maxStep = Math.max(...steps);
    const minLoss = Math.min(...losses), maxLoss = Math.max(...losses);
    const lr = maxLoss - minLoss || 0.1, sr = maxStep - minStep || 1;

    // Grid
    ctx.strokeStyle = '#3c3836'; ctx.lineWidth = 0.5;
    for (let i=0;i<=4;i++){const y=pad.top+ch*i/4;ctx.beginPath();ctx.moveTo(pad.left,y);ctx.lineTo(w-pad.right,y);ctx.stroke();}

    // Y labels
    ctx.fillStyle = '#928374'; ctx.font = '9px monospace'; ctx.textAlign = 'right';
    for (let i=0;i<=4;i++){const v=maxLoss-lr*i/4;ctx.fillText(v.toFixed(3),pad.left-4,pad.top+ch*i/4+3);}

    // X labels
    ctx.textAlign = 'center';
    for (let i=0;i<=4;i++){const v=Math.round(minStep+sr*i/4);ctx.fillText(String(v),pad.left+cw*i/4,h-6);}

    // Loss line
    ctx.beginPath(); ctx.strokeStyle = '#fabd2f'; ctx.lineWidth = 1.5;
    for (let i=0;i<lossData.length;i++){
      const x=pad.left+((lossData[i].step-minStep)/sr)*cw;
      const y=pad.top+((maxLoss-lossData[i].loss)/lr)*ch;
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
    }
    ctx.stroke();

    // Moving avg
    if (lossData.length > 20) {
      ctx.beginPath(); ctx.strokeStyle = '#fb4934'; ctx.lineWidth = 2;
      const ws = Math.min(20, Math.floor(lossData.length/4));
      for (let i=ws;i<lossData.length;i++){
        let s=0;for(let j=i-ws;j<i;j++)s+=lossData[j].loss;
        const a=s/ws;
        const x=pad.left+((lossData[i].step-minStep)/sr)*cw;
        const y=pad.top+((maxLoss-a)/lr)*ch;
        i===ws?ctx.moveTo(x,y):ctx.lineTo(x,y);
      }
      ctx.stroke();
    }

    // Legend
    ctx.fillStyle='#fabd2f';ctx.fillRect(w-pad.right-90,pad.top,10,2);
    ctx.fillStyle='#928374';ctx.font='8px monospace';ctx.textAlign='left';ctx.fillText('loss',w-pad.right-76,pad.top+3);
    if(lossData.length>20){ctx.fillStyle='#fb4934';ctx.fillRect(w-pad.right-90,pad.top+8,10,2);ctx.fillStyle='#928374';ctx.fillText('avg',w-pad.right-76,pad.top+11);}

    document.getElementById('loss-count').textContent = lossData.length + ' pts';
  }

  drawChart();
  window.addEventListener('resize', drawChart);

  // --- Poll ---
  async function pollState() {
    try {
      const [stateRes, trainingRes, resultsRes] = await Promise.all([
        fetch('/api/v1/state'), fetch('/api/v1/training'), fetch('/api/v1/results')
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
        if (state.loss_history && state.loss_history.length > lossData.length) {
          lossData = state.loss_history;
          drawChart();
        }
        document.getElementById('updated-at').textContent = 'Updated ' + new Date(state.generated_at).toLocaleTimeString();
      }
      if (trainingRes.ok) {
        const t = await trainingRes.json();
        if (t && t.step !== undefined) updateTrainingBar(t);
      }
      if (resultsRes.ok) {
        const results = await resultsRes.json();
        if (Array.isArray(results)) updateResultsTable(results);
      }
    } catch {}
  }

  function updateTrainingBar(t) {
    const bar = document.getElementById('training-bar');
    const pct = t.progress_pct || 0;
    let p = [];
    if (t.step!==undefined) p.push('<span class="training-metric">Step <span>'+t.step+'</span></span>');
    if (t.loss!==undefined) p.push('<span class="training-metric">Loss <span class="highlight">'+t.loss.toFixed(4)+'</span></span>');
    if (t.tok_per_sec!==undefined) p.push('<span class="training-metric">Tok/s <span>'+t.tok_per_sec.toLocaleString()+'</span></span>');
    if (t.mfu_pct!==undefined) p.push('<span class="training-metric">MFU <span>'+t.mfu_pct.toFixed(1)+'%</span></span>');
    if (t.dt_ms!==undefined) p.push('<span class="training-metric">dt <span>'+t.dt_ms+'ms</span></span>');
    if (t.remaining_sec!==undefined) p.push('<span class="training-metric">ETA <span>'+t.remaining_sec+'s</span></span>');
    if (t.peak_vram_mb!==undefined) p.push('<span class="training-metric">VRAM <span>'+(t.peak_vram_mb/1024).toFixed(1)+'GB</span></span>');
    if (t.val_bpb!==undefined) p.push('<span class="training-metric">val_bpb <span class="highlight">'+t.val_bpb.toFixed(6)+'</span></span>');
    bar.innerHTML = '<div class="training-bar">'+p.join('')
      +'<div class="progress-bar"><div class="progress-fill" style="width:'+pct+'%"></div></div>'
      +'<span class="training-metric"><span>'+pct.toFixed(1)+'%</span></span></div>';
  }

  function updateResultsTable(results) {
    const body = document.getElementById('results-body');
    document.getElementById('results-count').textContent = results.length;
    document.getElementById('stat-experiments').textContent = results.length;
    let best = Infinity;
    for (const r of results) if (r.status==='keep'&&r.val_bpb>0&&r.val_bpb<best) best=r.val_bpb;
    if (best<Infinity) document.getElementById('stat-bestbpb').textContent = best.toFixed(4);
    if (!results.length) { body.innerHTML='<tr><td colspan="5" style="text-align:center;color:#665c54;padding:0.75rem;">No experiments yet</td></tr>'; return; }
    body.innerHTML = results.slice().reverse().map(r => {
      const sc='status-'+r.status, bc=(r.status==='keep'&&r.val_bpb===best)?'bpb-best':'bpb-val';
      return '<tr><td style="font-family:monospace;color:#83a598;">'+esc(r.commit)+'</td>'
        +'<td class="'+bc+'">'+(r.val_bpb>0?r.val_bpb.toFixed(6):'-')+'</td>'
        +'<td>'+(r.memory_gb>0?r.memory_gb.toFixed(1)+' GB':'-')+'</td>'
        +'<td class="'+sc+'">'+esc(r.status)+'</td>'
        +'<td style="color:#bdae93;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+esc(r.description)+'</td></tr>';
    }).join('');
  }

  function fmtDur(s) {
    if(s<60) return s+'s';
    if(s<3600) return Math.floor(s/60)+'m '+(s%60)+'s';
    return Math.floor(s/3600)+'h '+Math.floor((s%3600)/60)+'m';
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
