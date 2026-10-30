// Tests for needs-you-agents.js. Run: node extras/hooks/needs-you-agents.test.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { record } = require("./needs-you-agents.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ny-agents-"));
const file = path.join(tmp, "sub", "agents.jsonl");
const read = () => fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));

const cases = [
  ["a start writes time, event, agent type, project and agent id", () => {
    record({ hook_event_name: "SubagentStart", agent_type: "Explore", agent_id: "a1", cwd: "C:/code/my-app", session_id: "s", transcript_path: "t" }, file, 1000);
    const o = read()[0];
    return o.time === new Date(1000).toISOString() && o.event === "start" && o.agent_type === "Explore"
      && o.project === "my-app" && o.agent_id === "a1" && Object.keys(o).length === 5;
  }],
  ["a stop writes a stop line", () => {
    record({ hook_event_name: "SubagentStop", agent_type: "Explore", agent_id: "a1", cwd: "/home/u/my-app/", last_assistant_message: "secret text" }, file, 2000);
    const o = read()[1];
    return o.event === "stop" && o.project === "my-app" && !JSON.stringify(o).includes("secret");
  }],
  ["a missing agent id is left out", () => {
    record({ hook_event_name: "SubagentStart", agent_type: "Plan", cwd: "C:/a" }, file, 3000);
    return !("agent_id" in read()[2]);
  }],
  ["other events write nothing", () => {
    record({ hook_event_name: "Stop", cwd: "C:/a" }, file, 4000);
    return read().length === 3;
  }],
  ["an unwritable path fails silently", () => {
    try { record({ hook_event_name: "SubagentStart" }, path.join(file, "x", "y.jsonl"), 5000); return true; } catch { return false; }
  }],
];

let fail = 0;
for (const [name, check] of cases) {
  let ok = false;
  try { ok = check(); } catch {}
  if (!ok) { fail++; console.log(`FAIL  ${name}`); }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${cases.length - fail}/${cases.length} passed`);
process.exit(fail ? 1 : 0);
