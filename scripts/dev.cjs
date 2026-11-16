// `npm start` (and `npm start dev`) launch the dashboard locally at http://localhost:3000.
// Extra words after `npm start` are ignored.
const { spawn } = require("node:child_process");
const path = require("node:path");

const nextBin = path.join(__dirname, "..", "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextBin, "dev"], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
