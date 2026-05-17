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
      out_file: "./logs/api-out.log",
      error_file: "./logs/api-error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      max_restarts: 10,
      restart_delay: 3000,
      watch: false,
      kill_timeout: 5000,
      listen_timeout: 10000,
    },
    {
      name: "miniagent-web",
      script: "npx",
      args: "vite preview --host 127.0.0.1 --port 4173",
      cwd: "/Users/zhiwei/Documents/MiniAgent",
      env: {
        NODE_ENV: "production",
      },
      out_file: "./logs/web-out.log",
      error_file: "./logs/web-error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      max_restarts: 10,
      restart_delay: 3000,
      watch: false,
      kill_timeout: 5000,
      listen_timeout: 10000,
    },
  ],
};
