import assert from "node:assert/strict";
import test from "node:test";
import {
  QUESTION_REWARD_PARTICIPANT_FLOORS,
  SCORE_SPREAD_POLICY,
  USDC_BY_CHAIN_ID,
  WORLD_CHAIN_USDC_BY_CHAIN_ID,
  WORLD_ID_V3_ROUTER_BY_CHAIN_ID,
  getUsdcEip712DomainName,
  requiredQuestionRewardParticipants,
} from "./protocol";

test("score-spread policy exposes low-turnout forfeiture guardrails", () => {
  assert.equal(SCORE_SPREAD_POLICY.forfeitMinReveals, 8);
  assert.equal(SCORE_SPREAD_POLICY.maxForfeitBps, 5_000);
});

test("USDC defaults include Base, Base Sepolia, and the legacy World Chain alias", () => {
  assert.equal(USDC_BY_CHAIN_ID[8453], "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  assert.equal(USDC_BY_CHAIN_ID[84532], "0x036CbD53842c5426634e7929541eC2318f3dCF7e");
  assert.equal(WORLD_CHAIN_USDC_BY_CHAIN_ID, USDC_BY_CHAIN_ID);
});

test("USDC EIP-712 domain names match live and local token deployments", () => {
  assert.equal(getUsdcEip712DomainName(31337), "USD Coin");
  assert.equal(getUsdcEip712DomainName(8453), "USD Coin");
  assert.equal(getUsdcEip712DomainName(84532), "USDC");
});

test("World ID v3 router defaults include Base networks", () => {
  assert.equal(WORLD_ID_V3_ROUTER_BY_CHAIN_ID[8453], "0xBCC7e5910178AFFEEeBA573ba6903E9869594163");
  assert.equal(WORLD_ID_V3_ROUTER_BY_CHAIN_ID[84532], "0x42FF98C4E85212a5D31358ACbFe76a621b50fC02");
});

test("requiredQuestionRewardParticipants maps reward amount tiers", () => {
  assert.equal(requiredQuestionRewardParticipants(999_999_999), 3);
  assert.equal(
    requiredQuestionRewardParticipants(QUESTION_REWARD_PARTICIPANT_FLOORS.highValueAmount),
    5,
  );
  assert.equal(
    requiredQuestionRewardParticipants(BigInt(QUESTION_REWARD_PARTICIPANT_FLOORS.veryHighValueAmount)),
    8,
  );
});
