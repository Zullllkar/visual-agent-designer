const fs = require("node:fs");
const path = require("node:path");

function createLogger(logsDir) {
  fs.mkdirSync(logsDir, { recursive: true });
  const file = path.join(logsDir, "desktop.log");

  function write(level, message) {
    const line = `[${new Date().toISOString()}] [${level}] ${message}`;
    fs.appendFileSync(file, `${line}\n`, "utf8");
    if (level === "error") console.error(line);
    else console.log(line);
  }

  return {
    file,
    info: (message) => write("info", message),
    error: (message) => write("error", message),
  };
}

module.exports = { createLogger };
