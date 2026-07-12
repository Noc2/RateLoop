import { ponder } from "ponder:registry";
import { tokenlessIssuerEpoch } from "ponder:schema";
import { resolveTokenlessDeployment } from "./protocol-deployment";

const deployment = resolveTokenlessDeployment();

ponder.on("CredentialIssuer:SignerRotated", async ({ event, context }) => {
  const { previousEpoch, newEpoch, newSigner, emergency, previousEpochAcceptedUntil } = event.args;
  await context.db
    .insert(tokenlessIssuerEpoch)
    .values({
      id: `${deployment.deploymentKey}:${newEpoch}`,
      deploymentKey: deployment.deploymentKey,
      previousEpoch,
      epoch: newEpoch,
      signer: newSigner,
      emergency,
      previousEpochAcceptedUntil,
      rotatedAt: event.block.timestamp,
      txHash: event.transaction.hash,
    })
    .onConflictDoUpdate({
      signer: newSigner,
      emergency,
      previousEpochAcceptedUntil,
      rotatedAt: event.block.timestamp,
      txHash: event.transaction.hash,
    });
});
