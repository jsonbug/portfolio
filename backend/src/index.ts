import "./env.js";
import { buildApp } from "./app.js";
import { env } from "./env.js";

const app = buildApp();

try {
  await app.listen({ port: env.port, host: env.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
