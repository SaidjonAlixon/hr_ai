// pm2 start deploy/ecosystem.config.cjs
// Faqat BITTA nusxa: fon ishlari (eslatmalar, davomat, eskalatsiya) jarayon ichida setInterval bilan
// ishlaydi — 2+ nusxa bo‘lsa har bildirishnoma ikki marta ketadi. cluster / instances>1 qo‘ymang.
const path = require("node:path");

const root = path.resolve(__dirname, "..");

module.exports = {
  apps: [
    {
      name: "hr-api",
      cwd: path.join(root, "artifacts/api-server"),
      script: "dist/index.mjs",
      // Serverda IPv6 marshruti yo‘q: ipv4first + uzunroq kutish bo‘lmasa yuklama paytida Telegramga ulanish ETIMEDOUT bo‘ladi
      node_args:
        "--enable-source-maps --max-old-space-size=2048 --dns-result-order=ipv4first --network-family-autoselection-attempt-timeout=1000",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      min_uptime: "10s",
      restart_delay: 3000,
      max_memory_restart: "3200M",
      kill_timeout: 10000,
      time: true,
      env: {
        NODE_ENV: "production",
        PORT: "8080",
        TZ: "Asia/Tashkent",
      },
    },
  ],
};
