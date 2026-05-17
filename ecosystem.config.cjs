module.exports = {
  apps: [
    {
      name: "miniagent-api",
      script: "npx",
      args: "tsx src/server/http/server.ts",
      cwd: "/Users/zhiwei/Documents/MiniAgent",
      env: {
        NODE_ENV: "production",
        MINIAGENT_API_PORT: 7273,
      },
      // logs
      out_file: "./logs/api-out.log",
      error_file: "./logs/api-error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      // auto-restart
      max_restarts: 10,
      restart_delay: 3000,
      watch: false,
      // tsx needs a bit more time for TypeScript compilation
      kill_timeout: 5000,
      listen_timeout: 10000,
    },
  ],
};
