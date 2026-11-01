import * as helpers from "./function.js";
import { disabledWorkerPlugins } from "./plugins.js";
import { createApp } from "../app-core.js";

const app = createApp({
  ...helpers,
  disabledEndpoints: disabledWorkerPlugins,
  rateLimitMiddleware: null,
  getCorsOrigins: (req) => req.get("x-wolf-cors-origins") || "",
  getUptimeSeconds: () => null,
  getMetrics: () => ({
    uptime: "tidak tersedia; isolate Workers bersifat sementara",
    memory: "tidak diekspos oleh runtime Worker"
  }),
  isProduction: () => true,
  trustProxy: false
});

export default app;
