// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { ContentRegistry } from "../contracts/ContentRegistry.sol";
import { RoundVotingEngine } from "../contracts/RoundVotingEngine.sol";
import { ProtocolConfig } from "../contracts/ProtocolConfig.sol";
import { RoundRewardDistributor } from "../contracts/RoundRewardDistributor.sol";
import { LoopReputation } from "../contracts/LoopReputation.sol";
import { RoundLib } from "../contracts/libraries/RoundLib.sol";
import { RoundEngineReadHelpers } from "./helpers/RoundEngineReadHelpers.sol";
import { VotingHandler } from "./handlers/VotingHandler.sol";
import { MockCategoryRegistry } from "../contracts/mocks/MockCategoryRegistry.sol";
import { VotingTestBase } from "./helpers/VotingTestHelpers.sol";

/// @title InvariantRating
/// @notice Invariant: after settlement, content rating is always in [0,100].
///         UP-majority rounds produce rating >= 50.
contract InvariantRating is VotingTestBase {
    LoopReputation public lrepToken;
    ContentRegistry public registry;
    RoundVotingEngine public engine;
    RoundRewardDistributor public distributor;
    VotingHandler public handler;

    address public owner = address(1);
    address public submitter = address(2);
    address public treasury = address(100);

    uint256 public constant NUM_VOTERS = 5;
    uint256 public constant VOTER_FUND = 100_000e6;
    uint256 public constant EPOCH_DURATION = 10 minutes;

    address[] public voters;
    uint256[] public contentIds;

    function setUp() public {
        vm.warp(1000);
        vm.roll(100);

        vm.startPrank(owner);

        lrepToken = new LoopReputation(owner, owner);
        lrepToken.grantRole(lrepToken.MINTER_ROLE(), owner);

        ContentRegistry registryImpl = new ContentRegistry();
        RoundVotingEngine engineImpl = new RoundVotingEngine();
        RoundRewardDistributor distImpl = new RoundRewardDistributor();

        registry = ContentRegistry(
            address(
                new ERC1967Proxy(
                    address(registryImpl),
                    abi.encodeCall(ContentRegistry.initializeWithTreasury, (owner, owner, owner, address(lrepToken)))
                )
            )
        );

        engine = RoundVotingEngine(
            address(
                new ERC1967Proxy(
                    address(engineImpl),
                    abi.encodeCall(
                        RoundVotingEngine.initialize,
                        (owner, address(lrepToken), address(registry), address(_deployProtocolConfig(owner)))
                    )
                )
            )
        );

        distributor = RoundRewardDistributor(
            address(
                new ERC1967Proxy(
                    address(distImpl),
                    abi.encodeCall(
                        RoundRewardDistributor.initialize,
                        (owner, address(lrepToken), address(engine), address(registry))
                    )
                )
            )
        );

        registry.setVotingEngine(address(engine));
        MockCategoryRegistry mockCategoryRegistry = new MockCategoryRegistry();
        mockCategoryRegistry.seedDefaultTestCategories();
        registry.setCategoryRegistry(address(mockCategoryRegistry));
        ProtocolConfig(address(engine.protocolConfig())).setRewardDistributor(address(distributor));
        ProtocolConfig(address(engine.protocolConfig())).setCategoryRegistry(address(mockCategoryRegistry));
        ProtocolConfig(address(engine.protocolConfig())).setTreasury(treasury);
        _setTlockRoundConfig(ProtocolConfig(address(engine.protocolConfig())), EPOCH_DURATION, EPOCH_DURATION, 3, 100);

        // Create voters
        for (uint256 i = 0; i < NUM_VOTERS; i++) {
            address voter = address(uint160(10 + i));
            voters.push(voter);
            lrepToken.mint(voter, VOTER_FUND);
        }

        // Fund submitter and submit content
        lrepToken.mint(submitter, 100e6);
        vm.stopPrank();

        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 20e6);
        _submitContentWithReservation(registry, "https://example.com/rating1", "test", "test", "test", 0);
        _submitContentWithReservation(registry, "https://example.com/rating2", "test", "test", "test", 0);
        vm.stopPrank();

        contentIds.push(1);
        contentIds.push(2);

        // Create handler
        handler = new VotingHandler(
            address(engine), address(distributor), address(registry), address(lrepToken), voters, contentIds
        );

        targetContract(address(handler));
    }

    /// @notice After settlement, content rating is always in [0, 100].
    function invariant_RatingAlwaysBounded() public view {
        uint256 recordCount = handler.getRoundRecordCount();
        for (uint256 i = 0; i < recordCount; i++) {
            VotingHandler.RoundRecord memory rec = handler.getRoundRecord(i);
            if (!rec.settled) continue;

            (,,,,,,,, uint256 rating,) = registry.contents(rec.contentId);
            assertLe(rating, 100, "rating exceeds 100");
        }
    }

    /// @notice Weighted UP-majority rounds should produce rating >= 50.
    function invariant_UpMajorityRatingGe50() public view {
        uint256 recordCount = handler.getRoundRecordCount();
        for (uint256 i = 0; i < recordCount; i++) {
            VotingHandler.RoundRecord memory rec = handler.getRoundRecord(i);
            if (!rec.settled) continue;

            RoundLib.Round memory round = RoundEngineReadHelpers.round(engine, rec.contentId, rec.roundId);
            // Only check rounds where UP side had strictly more weighted stake
            if (round.weightedUpPool <= round.weightedDownPool) continue;

            (,,,,,,,, uint256 rating,) = registry.contents(rec.contentId);
            assertGe(rating, 50, "weighted UP-majority round produced rating < 50");
        }
    }
}
