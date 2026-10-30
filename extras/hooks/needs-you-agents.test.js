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
  ["a log over 1 MB keeps only its last 2000 lines", () => {
    const big = path.join(tmp, "big.jsonl");
    fs.writeFileSync(big, Array.from({ length: 3000 }, (_, i) => JSON.stringify({ n: i, pad: "x".repeat(400) })).join("\n") + "\n");
    record({ hook_event_name: "SubagentStop", agent_type: "Plan", cwd: "C:/a" }, big, 6000);
    const lines = fs.readFileSync(big, "utf8").trim().split("\n");
    return lines.length <= 2001 && lines.length >= 1999 && JSON.parse(lines[lines.length - 1]).event === "stop";
  }],
  ["the log goes under CLAUDE_CONFIG_DIR when it is set", () => {
    const dir = path.join(tmp, "config");
    require("child_process").execFileSync(process.execPath, [path.join(__dirname, "needs-you-agents.js")], {
      input: JSON.stringify({ hook_event_name: "SubagentStart", agent_type: "Explore", cwd: "C:/code/app" }),
      env: { ...process.env, CLAUDE_CONFIG_DIR: dir },
    });
    return JSON.parse(fs.readFileSync(path.join(dir, "needs-you", "agents.jsonl"), "utf8")).project === "app";
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
