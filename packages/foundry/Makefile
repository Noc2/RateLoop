.PHONY: build deploy deploy-and-generate-abis generate-abis get-address account chain compile compile-all flatten fork format lint test verify verify-blockscout slither aderyn certora certora-check certora-mutate coverage check-contract-sizes check-storage-layouts snapshot-storage-layouts

TEST_ARGS ?=
COVERAGE_ARGS ?=
RESUME_FLAG ?=
DEPLOY_FLOW_FLAGS ?=
DEPLOY_PROFILE ?= deploy
DEPLOY_SCRIPT_IGNORED_ERROR_CODE_FLAGS ?= --ignored-error-codes 2394 --ignored-error-codes 3860 --ignored-error-codes 5574 --ignored-error-codes 6335
LOCALHOST_EVM_SIZE_FLAGS ?=
LOCALHOST_DEPLOYER_PRIVATE_KEY ?= 0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6

# setup wallet for anvil
setup-anvil-wallet:
	shx rm ~/.foundry/keystores/scaffold-eth-default 2>/dev/null; 	shx rm -rf broadcast/Deploy.s.sol/31337
	cast wallet import --private-key 0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6 --unsafe-password 'localhost' scaffold-eth-default

# Start local chain
chain: setup-anvil-wallet
	anvil $(LOCALHOST_EVM_SIZE_FLAGS)

# Start a fork
fork: setup-anvil-wallet
	anvil --fork-url ${FORK_URL} --chain-id 31337 $(LOCALHOST_EVM_SIZE_FLAGS)

# Deploy the contracts
deploy:
	@if [ ! -f "script/Deploy.s.sol" ]; then \
		echo "Error: Deploy script 'script/Deploy.s.sol' not found"; \
		exit 1; \
	fi
	@if [ "$(RPC_URL)" = "localhost" ]; then \
		env -u ETH_KEYSTORE_ACCOUNT -u ETH_KEYSTORE -u ETH_PASSWORD \
			FOUNDRY_PROFILE=$(DEPLOY_PROFILE) forge script script/Deploy.s.sol --tc DeployScript --rpc-url localhost --private-key $(LOCALHOST_DEPLOYER_PRIVATE_KEY) --broadcast --ffi --slow --non-interactive $(LOCALHOST_EVM_SIZE_FLAGS) $(RESUME_FLAG); \
	else \
		FOUNDRY_PROFILE=$(DEPLOY_PROFILE) forge script script/Deploy.s.sol --tc DeployScript --rpc-url $(RPC_URL) --account $(ETH_KEYSTORE_ACCOUNT) --broadcast --ffi --gas-estimate-multiplier 200 $(DEPLOY_SCRIPT_IGNORED_ERROR_CODE_FLAGS) --non-interactive $(DEPLOY_FLOW_FLAGS) $(RESUME_FLAG) $(VERIFY_FLAGS); \
	fi

# Deploy and generate shared deployment artifacts.
#
# Keep this as an ordered recipe instead of independent prerequisites. If make
# is invoked with parallel jobs, `generate-abis` must still wait for the fresh
# broadcast/deployments JSON written by `deploy`.
deploy-and-generate-abis: check-contract-sizes
	$(MAKE) deploy
	node scripts-js/exportDeploymentFromBroadcast.js
	$(MAKE) generate-abis

# Generate TypeScript ABIs
generate-abis:
	node scripts-js/generateTsAbis.js

# List account
account:
	@node scripts-js/checkAccountBalance.js

# Get address of a keystore
get-address:
	@cast wallet address --account $(ACCOUNT_NAME)

# Compile contracts
compile:
	forge compile --skip test script

compile-all:
	forge compile

# Flatten contracts
flatten:
	forge flatten

# Format code
format:
	forge fmt && prettier --write ./scripts-js/**/*.js

# Lint code
lint:
	forge fmt --check && prettier --check ./scripts-js/**/*.js

# Run tests
test:
	forge test --offline $(TEST_ARGS)

# Verify contracts (Etherscan-compatible chains)
verify:
	FOUNDRY_PROFILE=$(DEPLOY_PROFILE) forge script script/VerifyAll.s.sol --ffi --rpc-url $(RPC_URL)

# Verify a single contract on Blockscout (World Chain networks)
# Usage: make verify-blockscout NETWORK=<worldchain|worldchainSepolia> CONTRACT_ADDRESS=0x... CONTRACT_NAME=MyContract
# Optional overrides: BLOCKSCOUT_URL=... BLOCKSCOUT_CHAIN_ID=...
verify-blockscout:
	@if [ -z "$(NETWORK)" ]; then \
		echo "Missing NETWORK. Use NETWORK=worldchain or NETWORK=worldchainSepolia."; \
		exit 1; \
	fi
	@if [ -z "$(CONTRACT_ADDRESS)" ] || [ -z "$(CONTRACT_NAME)" ]; then \
		echo "Usage: make verify-blockscout NETWORK=<worldchain|worldchainSepolia> CONTRACT_ADDRESS=0x... CONTRACT_NAME=MyContract"; \
		exit 1; \
	fi
	@case "$(NETWORK)" in \
		worldchain) \
			blockscout_url="https://worldchain.blockscout.com/api/"; \
			chain_id="480"; \
			;; \
		worldchainSepolia) \
			blockscout_url="https://worldchain-sepolia.blockscout.com/api/"; \
			chain_id="4801"; \
			;; \
		*) \
			echo "Unsupported NETWORK='$(NETWORK)'. Use worldchain or worldchainSepolia."; \
			exit 1; \
			;; \
	esac; \
	if [ -n "$(BLOCKSCOUT_URL)" ]; then blockscout_url="$(BLOCKSCOUT_URL)"; fi; \
	if [ -n "$(BLOCKSCOUT_CHAIN_ID)" ]; then chain_id="$(BLOCKSCOUT_CHAIN_ID)"; fi; \
	forge verify-contract $(CONTRACT_ADDRESS) $(CONTRACT_NAME) --verifier blockscout --verifier-url $$blockscout_url --chain $$chain_id

# Static analysis
slither:
	slither . --config-file slither.config.json

aderyn:
	aderyn .

# Formal verification (Certora). See certora/README.md and docs/testing/certora.md.
# The target conf inherits shared compiler/prover settings from base.conf via its
# "override_base_config" key; certoraRun takes a single conf file.
CERTORA_CONF ?= certora/confs/math.conf
CERTORA_ARGS ?=
# Gambit mutation-testing target (spec strength). See certora/mutation/README.md.
MUTATION_CONF ?= certora/mutation/frontend-registry.mutation.conf

certora:
	certoraRun $(CERTORA_CONF) $(CERTORA_ARGS)

certora-check:
	certoraRun $(CERTORA_CONF) --compilation_steps_only $(CERTORA_ARGS)

# Mutation testing: inject contract mutants and re-verify each against the spec.
# Needs CERTORAKEY (one prover job per mutant); run manually, not in CI.
certora-mutate:
	certoraMutate $(MUTATION_CONF) $(CERTORA_ARGS)

coverage:
	forge coverage --offline --ir-minimum $(COVERAGE_ARGS)

check-contract-sizes:
	FOUNDRY_PROFILE=$(DEPLOY_PROFILE) forge build --skip script --skip test
	bash scripts/check-contract-sizes.sh

# M-Crosscutting-1: snapshot-test the storage layout of every upgradeable contract.
check-storage-layouts:
	forge build --skip script --skip test
	bash scripts/check-storage-layouts.sh

snapshot-storage-layouts:
	forge build --skip script --skip test
	bash scripts/snapshot-storage-layouts.sh
