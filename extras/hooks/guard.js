// Example PreToolUse guard for Bash/PowerShell: turns common git and secrets
// rules into checks that run before a command executes.
// Asks you first (never blocks, so you can still approve): pushes or commits
// to main/master, merging pull requests, force pushes. Denies: staging or
// committing secrets/keys/personal settings files, and running a download
// straight in a shell. Every ask or deny is also written as one line to
// <config dir>/needs-you/guard.jsonl for the Needs You panel (the config dir is
// CLAUDE_CONFIG_DIR, else ~/.claude); past about 1 MB it keeps its last 2000 lines.
// Fails open (allows) on any internal error.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const PROTECTED = new Set(["main", "master"]);
const SECRET_FILE = /(^|[\/\\])(\.env(\.(?!example$|sample$|template$)[\w-]+)?|\.env\*|\.envrc|[\w.-]+\.(jks|keystore|p12|pfx|pem|key)|id_rsa|id_ed25519|\.claude\.json|credentials\.json|google-services\.json|GoogleService-Info\.plist|[\w.-]*(secret|keystore|signing)[\w.-]*\.properties)$/i;
const SHELLS = /^(sh|bash|zsh|dash|iex|invoke-expression|python3?|node|pwsh|powershell)$/i;
const DOWNLOADERS = /^(curl|wget|irm|iwr|invoke-webrequest|invoke-restmethod)$/i;

// Split a command line into simple commands. Each has its tokens (quotes
// removed, redirections dropped) and whether it pipes into the next one.
function parse(command) {
  const segs = [];
  let tokens = [], cur = "", quoted = false, i = 0;
  const pushTok = () => { if (cur !== "" || quoted) tokens.push(cur); cur = ""; quoted = false; };
  const endSeg = (pipe) => { pushTok(); if (tokens.length) segs.push({ tokens, pipe }); tokens = []; };
  while (i < command.length) {
    const ch = command[i], two = command.slice(i, i + 2);
    if (ch === '"' || ch === "'") {
      const end = command.indexOf(ch, i + 1);
      cur += command.slice(i + 1, end === -1 ? command.length : end);
      quoted = true;
      i = end === -1 ? command.length : end + 1;
      continue;
    }
    if (two === "&&" || two === "||") { endSeg(false); i += 2; continue; }
    if (ch === ";" || ch === "\n" || ch === "\r") { endSeg(false); i++; continue; }
    if (ch === "|") { endSeg(true); i++; continue; }
    if (/\s/.test(ch)) { pushTok(); i++; continue; }
    cur += ch; i++;
  }
  endSeg(false);
  for (const s of segs) {
    const out = [];
    for (let k = 0; k < s.tokens.length; k++) {
      const t = s.tokens[k];
      if (/^\d*(>>?|<)(&\d+)?$/.test(t)) { k++; continue; } // "> file", "2> file"
      if (/^\d*(>>?|<)/.test(t)) continue;                    // "2>&1", ">file"
      out.push(t);
    }
    while (out[0] && /^(sudo|command|exec)$/i.test(out[0])) out.shift();
    s.tokens = out;
  }
  return segs;
}

function gitBranch(dir) {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: dir, encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch { return null; }
}

function gitFiles(dir, args) {
  try {
    return execFileSync("git", args, {
      cwd: dir, encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"],
    }).split(/\r?\n/).filter(Boolean);
  } catch { return []; }
}

// logReason: what the decision log keeps instead of `reason` (no file names).
const deny = (reason, logReason) => ({ decision: "deny", reason, ...(logReason ? { logReason } : {}) });
const ask = (reason) => ({ decision: "ask", reason });

function checkGit(t, dir, env) {
  // git [-C dir] [-c k=v] <sub> ...
  let k = 1;
  while (k < t.length && t[k].startsWith("-")) {
    if (t[k] === "-C" && t[k + 1]) { dir = path.resolve(dir, t[k + 1]); k += 2; continue; }
    if (t[k] === "-c" || t[k] === "--git-dir" || t[k] === "--work-tree") { k += 2; continue; }
    k++;
  }
  const sub = (t[k] || "").toLowerCase();
  const args = t.slice(k + 1);
  const onMain = () => PROTECTED.has(env.branch(dir) || "");

  if (sub === "push") {
    let force = false;
    const pos = [];
    for (let j = 0; j < args.length; j++) {
      const a = args[j];
      if (a === "--all" || a === "--mirror") return ask("This pushes every branch, including main. Approve only if you asked for it.");
      if (a === "-f" || a === "--force" || a.startsWith("--force-with-lease") || a === "--force-if-includes") { force = true; continue; }
      if (a === "-o" || a === "--push-option" || a === "--repo" || a === "--receive-pack" || a === "--exec") { j++; continue; }
      if (a.startsWith("-")) continue;
      pos.push(a);
    }
    const refspecs = pos.slice(1);
    const targets = refspecs.length ? refspecs : ["HEAD"];
    for (const r of targets) {
      if (r.startsWith("+")) force = true;
      let dst = r.replace(/^\+/, "");
      dst = dst.includes(":") ? dst.slice(dst.indexOf(":") + 1) : dst;
      dst = dst.replace(/^refs\/heads\//, "");
      if (PROTECTED.has(dst) || (dst === "HEAD" && onMain())) {
        return ask("This push goes to main. Approve only if you asked for it.");
      }
    }
    if (force) return { decision: "ask", reason: "Force push rewrites history on GitHub. Confirm this is intended." };
    return null;
  }

  if (sub === "add") {
    for (const a of args) {
      if (a.startsWith("-")) continue;
      if (SECRET_FILE.test(a.replace(/,$/, "")) || a.split(",").some((p) => SECRET_FILE.test(p))) {
        return deny(`"${a}" looks like a secret, key or personal settings file. Ask the person first.`, "Staging a file that looks like a secret or key was blocked.");
      }
    }
    return null;
  }

  if (sub === "commit") {
    if (onMain()) return ask("This commits directly to main. Approve only if you asked for it.");
    const all = args.some((a) => a === "-a" || a === "--all" || /^-[a-z]*a[a-z]*$/i.test(a) && !a.startsWith("--"));
    const files = env.staged(dir).concat(all ? env.modified(dir) : []);
    const bad = files.find((f) => SECRET_FILE.test(f));
    if (bad) return deny(`"${bad}" is about to be committed and looks like a secret, key or personal settings file. Unstage it (git restore --staged) or ask the person.`, "Committing a file that looks like a secret or key was blocked.");
    return null;
  }
  return null;
}

function checkGh(t) {
  const words = t.map((w) => w.toLowerCase());
  const pr = words.indexOf("pr");
  if (pr !== -1 && words[pr + 1] === "merge") return ask("This merges a pull request. Approve only if you asked for it.");
  if (words.includes("api") && words.some((w) => /pulls\/\d+\/merge/.test(w))) return ask("This merges a pull request. Approve only if you asked for it.");
  return null;
}

function decide(command, cwd, env) {
  env = env || { branch: gitBranch,
    staged: (d) => gitFiles(d, ["diff", "--cached", "--name-only"]),
    modified: (d) => gitFiles(d, ["diff", "--name-only"]) };
  let dir = cwd || process.cwd();
  // Running a download directly, in forms a pipe split can't see.
  const unquoted = command.replace(/"[^"]*"|'[^']*'/g, '""');
  if (/\biex\s*\(\s*(irm|iwr|invoke-restmethod|invoke-webrequest|\(?\s*new-object\b[^)]*\)\s*\.downloadstring)/i.test(unquoted) || /<\(\s*(curl|wget)\b/i.test(unquoted)) {
    return deny("Running a download straight in a shell runs unseen code. Download it, read it, then run it.");
  }
  const segs = parse(command);
  let ask = null;
  for (let s = 0; s < segs.length; s++) {
    const t = segs[s].tokens;
    if (!t.length) continue;
    const cmd = t[0].toLowerCase();
    if ((cmd === "cd" || cmd === "set-location" || cmd === "pushd") && t[1]) { dir = path.resolve(dir, t[1]); continue; }
    if (DOWNLOADERS.test(cmd) && segs[s].pipe && segs[s + 1] && SHELLS.test(segs[s + 1].tokens[0] || "")) {
      return deny("Piping a download straight into a shell runs unseen code. Download it, read it, then run it.");
    }
    let r = null;
    if (cmd === "git") r = checkGit(t, dir, env);
    else if (cmd === "gh") r = checkGh(t);
    if (r && r.decision === "deny") return r;
    if (r && !ask) ask = r;
  }
  return ask;
}

// One JSON line per ask or deny for the Needs You panel: time, decision,
// the reason's first sentence and the project folder's name. Never the
// command. Any error is swallowed so the guard still fails open.
const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(require("os").homedir(), ".claude");
const DECISION_LOG = path.join(CONFIG_DIR, "needs-you", "guard.jsonl");
const LOG_MAX_BYTES = 1000000;
const LOG_KEEP_LINES = 2000;
function logDecision(result, cwd, file = DECISION_LOG, now = Date.now()) {
  try {
    if (!result || (result.decision !== "ask" && result.decision !== "deny")) return;
    const reason = String(result.logReason || result.reason || "").split(/(?<=\.)\s/)[0].slice(0, 80);
    const project = path.basename(String(cwd || "").replace(/[\/\\]+$/, ""));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify({ time: new Date(now).toISOString(), decision: result.decision, reason, project }) + "\n");
    // keep the log small: past about 1 MB, only its last 2000 lines stay
    if (fs.statSync(file).size > LOG_MAX_BYTES) {
      const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
      fs.writeFileSync(file, lines.slice(-LOG_KEEP_LINES).join("\n") + "\n");
    }
  } catch {}
}

function main() {
  let data;
  try { data = JSON.parse(fs.readFileSync(0, "utf8")); } catch { return; }
  const command = (data.tool_input && data.tool_input.command) || "";
  if (!command) return;
  let result = null;
  try { result = decide(command, data.cwd); } catch { return; }
  if (!result) return;
  logDecision(result, data.cwd);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: result.decision,
      permissionDecisionReason: "guard: " + result.reason,
    },
  }));
}

if (require.main === module) main();
module.exports = { decide, parse, logDecision };
