import { buildApp } from "./app.js";

const { app, start } = await buildApp();

start().catch((error) => {
  app.log.error({ err: error }, "Failed to start server");
  process.exit(1);
});
