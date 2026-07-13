.PHONY: build compile test coverage format lint check-contract-sizes deploy deploy-tokenless deploy-tokenless-and-generate-artifacts generate-tokenless-artifacts generate-tokenless-source-abis

TEST_ARGS ?=
COVERAGE_ARGS ?=
RESUME_FLAG ?=
DEPLOY_FLOW_FLAGS ?=
DEPLOY_PROFILE ?= deploy
VERIFY_FLAGS ?=

build compile:
	forge build --offline

test:
	forge test --offline --ignored-error-codes 3860 --ignored-error-codes 6335 --deny warnings $(TEST_ARGS)

coverage:
	forge coverage --offline --ir-minimum $(COVERAGE_ARGS)

format:
	forge fmt

lint:
	forge fmt --check
	node --check scripts-js/account.js
	node --check scripts-js/foundryAccounts.js
	node --check scripts-js/parseArgs.js
	node --check scripts-js/tokenlessDeployArgs.js
	node --check scripts-js/tokenlessDeployment.js
	node --check scripts-js/checkTokenlessContractSizes.js
	node --check scripts-js/exportTokenlessDeploymentFromBroadcast.js
	node --check scripts-js/generateTokenlessArtifacts.js

check-contract-sizes:
	FOUNDRY_PROFILE=$(DEPLOY_PROFILE) forge build --offline --sizes --skip test --skip script --deny warnings
	node scripts-js/checkTokenlessContractSizes.js

deploy: deploy-tokenless-and-generate-artifacts

deploy-tokenless: check-contract-sizes
	@if [ "$$DEPLOY_TARGET_NETWORK" != "baseSepolia" ]; then \
		echo "Error: tokenless-v2 deploy requires DEPLOY_TARGET_NETWORK=baseSepolia"; \
		exit 1; \
	fi
	FOUNDRY_PROFILE=$(DEPLOY_PROFILE) forge script script/DeployTokenless.s.sol \
		--tc DeployTokenlessScript \
		--rpc-url "$(RPC_URL)" \
		--account "$(ETH_KEYSTORE_ACCOUNT)" \
		--broadcast --gas-estimate-multiplier 200 --non-interactive \
		--deny warnings \
		$(DEPLOY_FLOW_FLAGS) $(RESUME_FLAG) $(VERIFY_FLAGS)

generate-tokenless-artifacts:
	node scripts-js/exportTokenlessDeploymentFromBroadcast.js
	node scripts-js/generateTokenlessArtifacts.js

generate-tokenless-source-abis:
	node scripts-js/generateTokenlessArtifacts.js --source-abis-only

deploy-tokenless-and-generate-artifacts: deploy-tokenless generate-tokenless-artifacts
	cd ../.. && yarn workspace @rateloop/contracts build
