import "dotenv/config";
import app from "./src/app.js";
import { watchPlugins, loadAllPlugins } from "./src/function.js";

const PORT = Number(process.env.PORT) || 3000;

await loadAllPlugins();
if (process.env.NODE_ENV !== "test") watchPlugins();

const server = app.listen(PORT, () => {
  console.log(`VP API ready at http://localhost:${PORT}`);
});

const shutdown = (signal) => {
  console.log(`${signal} received; closing HTTP server.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
