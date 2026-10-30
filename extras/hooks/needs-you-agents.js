// SubagentStart / SubagentStop hook for the Needs You panel: appends one JSON
// line per event to <config dir>/needs-you/agents.jsonl (time, start or stop,
// agent type, project folder name, agent id), so the panel can show which
// sub-agents are running now. The config dir is CLAUDE_CONFIG_DIR, else
// ~/.claude; past about 1 MB the log keeps its last 2000 lines. Never blocks
// anything; any error is swallowed.

const fs = require("fs");
const os = require("os");
const path = require("path");

const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const LOG = path.join(CONFIG_DIR, "needs-you", "agents.jsonl");
const LOG_MAX_BYTES = 1000000;
const LOG_KEEP_LINES = 2000;
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
    // keep the log small: past about 1 MB, only its last 2000 lines stay
    if (fs.statSync(file).size > LOG_MAX_BYTES) {
      const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
      fs.writeFileSync(file, lines.slice(-LOG_KEEP_LINES).join("\n") + "\n");
    }
  } catch {}
}

if (require.main === module) {
  try { record(JSON.parse(fs.readFileSync(0, "utf8") || "{}")); } catch {}
}
module.exports = { record };
