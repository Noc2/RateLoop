# `@rateloop/node-utils`

Minimal Node-only helper used by the tokenless keeper to load a Foundry V3 signer keystore.

```ts
import { getKeystoreAccountFromCredentials } from "@rateloop/node-utils/keystore";

const account = getKeystoreAccountFromCredentials(
  process.env.KEYSTORE_ACCOUNT ?? "",
  process.env.KEYSTORE_PASSWORD ?? "",
);
```

The helper accepts only flat, bounded account names under `~/.foundry/keystores`, scrypt with bounded cost parameters, AES-128-CTR, and an exactly 32-byte encrypted private key. It verifies the V3 MAC with a constant-time comparison before decrypting.

This package intentionally contains no protocol, moderation, identity, submission, scoring, voting, or payment helpers.

```bash
yarn build
yarn check-types
yarn test
```
