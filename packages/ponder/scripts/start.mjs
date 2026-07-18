import { spawn } from "node:child_process";
import {
  buildTokenlessDeploymentKey,
  resolveTokenlessDeployment,
} from "../src/protocol-deployment.ts";
import { validateRuntimeTokenlessDeployment } from "../src/runtime-deployment-health.ts";
import { resolvePonderDatabaseSchema } from "./databaseSchema.mjs";

const deployment = resolveTokenlessDeployment(process.env);
const deploymentKey = buildTokenlessDeploymentKey(deployment);
const env = {
  ...process.env,
  RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: deploymentKey,
};
const schema = resolvePonderDatabaseSchema(env);
await validateRuntimeTokenlessDeployment();
const child = spawn(
  "ponder",
  ["start", "--schema", schema, ...process.argv.slice(2)],
  {
    env,
    stdio: "inherit",
  },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}
child.once("error", (error) => {
  console.error(`[tokenless-ponder] failed to start: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
