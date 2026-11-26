import { execFileSync } from "node:child_process";
const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).split("\0").filter(Boolean);
const forbidden = tracked.filter(path => /^(?:\.cache\/|\.local\/state\/|node_modules\/|dist\/|coverage\/|playwright-report\/|test-results\/)/.test(path) || /(?:^|\/)\.env(?:\.|$)/.test(path) && !path.endsWith(".env.example") || /\.(?:pem|key|log)$/.test(path));
if (forbidden.length) {
  console.error("Forbidden tracked artifacts:", forbidden.length);
  process.exitCode = 1;
} else console.log("Repository hygiene passed:", tracked.length, "tracked files");
