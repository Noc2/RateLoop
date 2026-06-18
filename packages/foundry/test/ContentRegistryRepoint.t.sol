// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { ContentRegistry } from "../contracts/ContentRegistry.sol";
import { ContentRegistryRatingSnapshotLib } from "../contracts/libraries/ContentRegistryRatingSnapshotLib.sol";
import { ClusterPayoutOracle } from "../contracts/ClusterPayoutOracle.sol";
import { IClusterPayoutOracle } from "../contracts/interfaces/IClusterPayoutOracle.sol";
import { ProtocolConfig } from "../contracts/ProtocolConfig.sol";
import { RoundVotingEngine } from "../contracts/RoundVotingEngine.sol";
import { LoopReputation } from "../contracts/LoopReputation.sol";
import { MockERC20 } from "../contracts/mocks/MockERC20.sol";
import { MockCategoryRegistry } from "../contracts/mocks/MockCategoryRegistry.sol";
import { RaterRegistry } from "../contracts/RaterRegistry.sol";
import { RoundRewardDistributor } from "../contracts/RoundRewardDistributor.sol";
import { VotingTestBase } from "./helpers/VotingTestHelpers.sol";

contract MockFrontendRegistryForRepoint {
    uint256 public constant STAKE_AMOUNT = 1_000e6;

    mapping(address => bool) internal eligible;
    mapping(address => address) internal snapshotFrontend;
    mapping(address => address) public snapshotProposerForFrontend;

    function setEligible(address frontend, bool value) external {
        eligible[frontend] = value;
    }

    function isEligible(address frontend) external view returns (bool) {
        return eligible[frontend];
    }

    function authorizedSnapshotFrontend(address proposer) external view returns (address frontend) {
        if (eligible[proposer]) return proposer;
        frontend = snapshotFrontend[proposer];
        if (!eligible[frontend]) return address(0);
    }

    function isAuthorizedSnapshotProposer(address frontend, address proposer) external view returns (bool) {
        if (!eligible[frontend] || proposer == address(0)) return false;
        if (frontend == proposer) return true;
        return snapshotFrontend[proposer] == frontend && snapshotProposerForFrontend[frontend] == proposer;
    }
}

contract ContentRegistryRepointTest is VotingTestBase {
    LoopReputation internal lrepToken;
    ContentRegistry internal registry;
    RoundVotingEngine internal votingEngine;
    RoundRewardDistributor internal rewardDistributor;
    ProtocolConfig internal protocolConfig;
    address internal owner = address(1);
    address internal submitter = address(2);
    RaterRegistry internal raterRegistry;

    function setUp() public {
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
        votingEngine = RoundVotingEngine(
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

        rewardDistributor = RoundRewardDistributor(
            address(
                new ERC1967Proxy(
                    address(distImpl),
                    abi.encodeCall(
                        RoundRewardDistributor.initialize,
                        (owner, address(lrepToken), address(votingEngine), address(registry))
                    )
                )
            )
        );

        registry.setVotingEngine(address(votingEngine));
        registry.setTreasury(owner);
        protocolConfig = ProtocolConfig(address(votingEngine.protocolConfig()));
        protocolConfig.setRewardDistributor(address(rewardDistributor));
        protocolConfig.setTreasury(owner);
        registry.setProtocolConfig(address(protocolConfig));

        MockCategoryRegistry mockCategoryRegistry = new MockCategoryRegistry();
        mockCategoryRegistry.seedDefaultTestCategories();
        registry.setCategoryRegistry(address(mockCategoryRegistry));
        protocolConfig.setCategoryRegistry(address(mockCategoryRegistry));
        registry.setQuestionRewardPoolEscrow(address(_newMockQuestionRewardPoolEscrow(registry)));

        raterRegistry = _deployRaterRegistry(owner);
        protocolConfig.setRaterRegistry(address(raterRegistry));
        lrepToken.mint(submitter, 10_000e6);
        _seedRaterIdentity(raterRegistry, submitter, bytes32(uint256(uint160(submitter))));

        vm.stopPrank();
    }

    function _submitTestContent() internal returns (uint256 contentId) {
        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        _submitContentWithReservation(registry, "https://example.com/repoint-test", "goal", "goal", "tags", 0);
        vm.stopPrank();
        contentId = 1;
    }

    function _deployClusterPayoutOracle(address ratingConsumer) internal returns (ClusterPayoutOracle oracle) {
        MockERC20 usdc = new MockERC20("USD Coin", "USDC", 6);
        MockFrontendRegistryForRepoint frontend = new MockFrontendRegistryForRepoint();
        frontend.setEligible(owner, true);
        vm.startPrank(owner);
        oracle = new ClusterPayoutOracle(owner, address(frontend), address(usdc));
        oracle.setRoundPayoutSnapshotConsumer(oracle.PAYOUT_DOMAIN_PUBLIC_RATING(), ratingConsumer);
        oracle.setRoundPayoutSnapshotConsumer(
            oracle.PAYOUT_DOMAIN_QUESTION_REWARD(), registry.questionRewardPoolEscrow()
        );
        oracle.setRoundPayoutSnapshotConsumer(
            oracle.PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD(), registry.questionRewardPoolEscrow()
        );
        vm.stopPrank();
    }

    function _ratingEpochSources(uint256 contentId, uint256 roundId)
        internal
        pure
        returns (IClusterPayoutOracle.CorrelationEpochSourceRef[] memory sources)
    {
        sources = new IClusterPayoutOracle.CorrelationEpochSourceRef[](1);
        sources[0] = IClusterPayoutOracle.CorrelationEpochSourceRef({
            domain: 3, rewardPoolId: 0, contentId: contentId, roundId: roundId
        });
    }

    function _mockRatingSourceReady(uint256 contentId, uint256 roundId) internal {
        vm.mockCall(
            address(votingEngine),
            abi.encodeWithSelector(votingEngine.roundLifecycleState.selector, contentId, roundId),
            abi.encode(uint256(0), uint256(0), uint256(0), uint48(block.timestamp))
        );
    }

    function test_RepointPendingRatingClusterPayoutOracle_UpdatesPinnedOracle() public {
        uint256 contentId = _submitTestContent();
        uint256 roundId = 1;

        ClusterPayoutOracle originalOracle = _deployClusterPayoutOracle(address(registry));
        ClusterPayoutOracle replacementOracle = _deployClusterPayoutOracle(address(registry));

        vm.prank(owner);
        protocolConfig.setClusterPayoutOracle(address(originalOracle));

        vm.prank(address(votingEngine));
        registry.recordPendingRatingSettlement(contentId, roundId, 5000, 2, 1);

        vm.expectEmit(true, true, true, true, address(registry));
        emit ContentRegistryRatingSnapshotLib.PendingRatingClusterPayoutOracleRepointed(
            contentId, roundId, address(originalOracle), address(replacementOracle)
        );

        vm.prank(owner);
        registry.repointPendingRatingClusterPayoutOracle(contentId, roundId, address(replacementOracle));
    }

    function test_RepointPendingRatingClusterPayoutOracle_BlocksReplacementPreSquatUntilPinned() public {
        uint256 contentId = _submitTestContent();
        uint256 roundId = 1;

        ClusterPayoutOracle originalOracle = _deployClusterPayoutOracle(address(registry));
        ClusterPayoutOracle replacementOracle = _deployClusterPayoutOracle(address(registry));

        vm.prank(owner);
        protocolConfig.setClusterPayoutOracle(address(originalOracle));

        vm.prank(address(votingEngine));
        registry.recordPendingRatingSettlement(contentId, roundId, 5000, 2, 1);
        _mockRatingSourceReady(contentId, roundId);

        vm.prank(address(originalOracle));
        assertGt(registry.roundPayoutSnapshotSourceReadyAt(3, 0, contentId, roundId), 0);
        vm.prank(address(replacementOracle));
        assertEq(registry.roundPayoutSnapshotSourceReadyAt(3, 0, contentId, roundId), 0);

        vm.prank(owner);
        vm.expectRevert(ClusterPayoutOracle.SourceNotReady.selector);
        replacementOracle.proposeCorrelationEpoch(
            1,
            uint64(roundId),
            uint64(roundId),
            keccak256(abi.encode("public-rating-cluster-root", roundId)),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://rating-epoch",
            _ratingEpochSources(contentId, roundId)
        );

        vm.prank(owner);
        registry.repointPendingRatingClusterPayoutOracle(contentId, roundId, address(replacementOracle));

        vm.prank(address(originalOracle));
        assertEq(registry.roundPayoutSnapshotSourceReadyAt(3, 0, contentId, roundId), 0);
        vm.prank(address(replacementOracle));
        assertGt(registry.roundPayoutSnapshotSourceReadyAt(3, 0, contentId, roundId), 0);

        vm.prank(owner);
        replacementOracle.proposeCorrelationEpoch(
            1,
            uint64(roundId),
            uint64(roundId),
            keccak256(abi.encode("public-rating-cluster-root", roundId)),
            keccak256("params"),
            keccak256("epoch-artifact"),
            "ipfs://rating-epoch",
            _ratingEpochSources(contentId, roundId)
        );
        assertGt(replacementOracle.correlationEpochSnapshot(1).proposedAt, 0);

        vm.clearMockedCalls();
    }

    function test_RepointPendingRatingClusterPayoutOracle_RevertsWhenNewOracleEqualsOldOracle() public {
        uint256 contentId = _submitTestContent();
        uint256 roundId = 1;

        ClusterPayoutOracle originalOracle = _deployClusterPayoutOracle(address(registry));

        vm.prank(owner);
        protocolConfig.setClusterPayoutOracle(address(originalOracle));

        vm.prank(address(votingEngine));
        registry.recordPendingRatingSettlement(contentId, roundId, 5000, 2, 1);

        vm.prank(owner);
        vm.expectRevert(ContentRegistryRatingSnapshotLib.InvalidState.selector);
        registry.repointPendingRatingClusterPayoutOracle(contentId, roundId, address(originalOracle));
    }

    function test_RepointPendingRatingClusterPayoutOracle_RevertsWhenReplacementSnapshotExists() public {
        uint256 contentId = _submitTestContent();
        uint256 roundId = 1;

        ClusterPayoutOracle originalOracle = _deployClusterPayoutOracle(address(registry));
        ClusterPayoutOracle replacementOracle = _deployClusterPayoutOracle(address(registry));

        vm.prank(owner);
        protocolConfig.setClusterPayoutOracle(address(originalOracle));

        vm.prank(address(votingEngine));
        registry.recordPendingRatingSettlement(contentId, roundId, 5000, 2, 1);

        vm.mockCall(
            address(replacementOracle),
            abi.encodeWithSignature(
                "roundPayoutSnapshotProposedAt(uint8,uint256,uint256,uint256)", 3, 0, contentId, roundId
            ),
            abi.encode(uint64(1))
        );

        vm.prank(owner);
        vm.expectRevert(ContentRegistryRatingSnapshotLib.InvalidState.selector);
        registry.repointPendingRatingClusterPayoutOracle(contentId, roundId, address(replacementOracle));
        vm.clearMockedCalls();
    }

    function test_RepointPendingRatingClusterPayoutOracle_RevertsForNonConfigRole() public {
        uint256 contentId = _submitTestContent();
        uint256 roundId = 1;

        ClusterPayoutOracle originalOracle = _deployClusterPayoutOracle(address(registry));
        ClusterPayoutOracle replacementOracle = _deployClusterPayoutOracle(address(registry));

        vm.prank(owner);
        protocolConfig.setClusterPayoutOracle(address(originalOracle));

        vm.prank(address(votingEngine));
        registry.recordPendingRatingSettlement(contentId, roundId, 5000, 2, 1);

        vm.prank(address(0xBEEF));
        vm.expectRevert();
        registry.repointPendingRatingClusterPayoutOracle(contentId, roundId, address(replacementOracle));
    }

    function test_RepointPendingRatingClusterPayoutOracle_RevertsWhenNoPendingSettlement() public {
        uint256 contentId = _submitTestContent();

        ClusterPayoutOracle replacementOracle = _deployClusterPayoutOracle(address(registry));
        vm.prank(owner);
        vm.expectRevert(ContentRegistryRatingSnapshotLib.InvalidState.selector);
        registry.repointPendingRatingClusterPayoutOracle(contentId, 1, address(replacementOracle));
    }
}
