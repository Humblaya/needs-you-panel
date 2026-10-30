// SubagentStart / SubagentStop hook for the Needs You panel: appends one JSON
// line per event to ~/.claude/needs-you/agents.jsonl (time, start or stop,
// agent type, project folder name, agent id), so the panel can show which
// sub-agents are running now. Never blocks anything; any error is swallowed.

const fs = require("fs");
const os = require("os");
const path = require("path");

const LOG = path.join(os.homedir(), ".claude", "needs-you", "agents.jsonl");
const EVENTS = { SubagentStart: "start", SubagentStop: "stop" };

function record(data, file = LOG, now = Date.now()) {
  try {
    const event = EVENTS[data.hook_event_name];
    if (!event) return;
    const line = {
      time: new Date(now).toISOString(),
      event,
      agent_type: String(data.agent_type || ""),
      project: path.basename(String(data.cwd || "").replace(/[\/\\]+$/, "")),
    };
    if (data.agent_id) line.agent_id = String(data.agent_id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(line) + "\n");
  } catch {}
}

if (require.main === module) {
  try { record(JSON.parse(fs.readFileSync(0, "utf8") || "{}")); } catch {}
}
module.exports = { record };
