import { listKeystores } from "./listKeystores.js";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

async function revealPk() {
  try {
    console.log("👀 This will reveal your private key on the console.");

    const selectedKeystore = await listKeystores(
      "Select a keystore to reveal its private key (enter the number, e.g., 1): "
    );

    if (!selectedKeystore) {
      console.error("❌ No keystore selected");
      process.exit(1);
    }

    try {
      const revealPKResult = execFileSync(
        "cast",
        ["wallet", "decrypt-keystore", selectedKeystore],
        { encoding: "utf8" }
      ).trim();

      console.log(`\n🔑 ${revealPKResult}`);
    } catch (error) {
      console.error("\n❌ Failed to decrypt keystore. Wrong password?");
      process.exit(1);
    }
  } catch (error) {
    console.error("\n❌ Error revealing private key:");
    console.error(error.message);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  revealPk().catch((error) => {
    console.error("\n❌ Unexpected error:", error);
    process.exit(1);
  });
}

export { revealPk };
