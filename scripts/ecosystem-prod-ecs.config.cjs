const path = require("node:path");

module.exports = {
  apps: [{
    name: process.env.NAME || "jieniu-web",
    cwd: path.resolve(__dirname, ".."),
    script: path.join(__dirname, "run-prod-ecs.sh"),
    interpreter: "/bin/bash",
    exec_mode: "fork",
    instances: 1,
    autorestart: true,
    restart_delay: 1000,
    min_uptime: 30000,
    max_restarts: 10,
    kill_timeout: 10000,
    max_memory_restart: process.env.WEB_MAX_MEMORY || "1536M",
    out_file: process.env.LOG || "/home/ubuntu/jieniu-prod.log",
    error_file: process.env.LOG || "/home/ubuntu/jieniu-prod.log",
    merge_logs: true,
    env: { PORT: process.env.PORT || "3838", NODE_ENV: "production" },
  }],
};
