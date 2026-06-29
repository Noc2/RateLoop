// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { Test } from "forge-std/Test.sol";

import { LoopReputation } from "../contracts/LoopReputation.sol";
import { ContentRegistry } from "../contracts/ContentRegistry.sol";
import { ProtocolConfig } from "../contracts/ProtocolConfig.sol";
import { RoundLib } from "../contracts/libraries/RoundLib.sol";
import { MockCategoryRegistry } from "../contracts/mocks/MockCategoryRegistry.sol";
import { MockRaterIdentityRegistry } from "./mocks/MockRaterIdentityRegistry.sol";
import { ContentSubmissionTestBase, deployInitializedProtocolConfig } from "./helpers/VotingTestHelpers.sol";

contract MockInitialRoundVotingEngineForSubmitterIdentity {
    address public immutable registry;
    address public immutable lrepToken;
    address public immutable protocolConfig;

    mapping(uint256 => uint256) internal currentRoundByContent;

    constructor(address registry_, address lrepToken_, address protocolConfig_) {
        registry = registry_;
        lrepToken = lrepToken_;
        protocolConfig = protocolConfig_;
    }

    function rewardDistributorConfigShape() external view returns (address, address, address) {
        return (registry, lrepToken, protocolConfig);
    }

    function openInitialRoundFromRegistry(uint256 contentId, uint256 allocatedRoundId) external {
        require(msg.sender == registry);
        currentRoundByContent[contentId] = allocatedRoundId;
    }

    function hasCommits(uint256) external pure returns (bool) {
        return false;
    }

    function currentRoundId(uint256 contentId) external view returns (uint256) {
        return currentRoundByContent[contentId];
    }

    function nextRoundIdForContent(uint256 contentId) external view returns (uint256) {
        return currentRoundByContent[contentId] + 1;
    }

    function isDormancyBlocked(uint256) external pure returns (bool) {
        return false;
    }

    function roundCore(uint256 contentId, uint256)
        external
        view
        returns (uint48, RoundLib.RoundState, uint16, uint16, uint64, uint48, uint48, uint8)
    {
        RoundLib.RoundState state =
            currentRoundByContent[contentId] == 0 ? RoundLib.RoundState.Cancelled : RoundLib.RoundState.Open;
        return (0, state, 0, 0, 0, 0, 0, 0);
    }

    function roundRatingConfigPacked(uint256, uint256) external pure returns (uint256, uint256) {
        return (0, 0);
    }

    function ratingCommitStateCompact(uint256, uint256, bytes32) external pure returns (uint256, bytes32, address) {
        return (0, bytes32(0), address(0));
    }

    function roundLifecycleState(uint256, uint256) external pure returns (uint256, uint256, uint256, uint48) {
        return (0, 0, 0, 0);
    }

    function transferReward(address, uint256) external pure { }
}

contract SubmitterIdentityReservationTest is Test, ContentSubmissionTestBase {
    ContentRegistry public registry;
    LoopReputation public lrepToken;
    ProtocolConfig public protocolConfig;
    MockInitialRoundVotingEngineForSubmitterIdentity public votingEngine;
    MockCategoryRegistry public mockCategoryRegistry;
    MockRaterIdentityRegistry public mockRaterIdentityRegistry;

    address public owner = address(1);
    address public submitter = address(2);
    address public delegate = address(3);

    function setUp() public {
        vm.warp(1000);

        vm.startPrank(owner);

        lrepToken = new LoopReputation(owner, owner);
        lrepToken.grantRole(lrepToken.MINTER_ROLE(), owner);

        ContentRegistry registryImpl = new ContentRegistry();
        registry = ContentRegistry(
            address(
                new ERC1967Proxy(
                    address(registryImpl),
                    abi.encodeCall(ContentRegistry.initializeWithTreasury, (owner, owner, owner, address(lrepToken)))
                )
            )
        );

        mockCategoryRegistry = new MockCategoryRegistry();
        mockCategoryRegistry.seedDefaultTestCategories();
        registry.setCategoryRegistry(address(mockCategoryRegistry));

        protocolConfig = deployInitializedProtocolConfig(owner);
        mockRaterIdentityRegistry = new MockRaterIdentityRegistry();
        protocolConfig.setRaterRegistry(address(mockRaterIdentityRegistry));
        registry.setProtocolConfig(address(protocolConfig));
        votingEngine = new MockInitialRoundVotingEngineForSubmitterIdentity(
            address(registry), address(lrepToken), address(protocolConfig)
        );
        registry.setVotingEngine(address(votingEngine));

        lrepToken.mint(submitter, 100e6);
        lrepToken.mint(delegate, 100e6);

        vm.stopPrank();
    }

    function test_NormalReveal_WithUnchangedIdentity_Succeeds() public {
        vm.prank(owner);
        mockRaterIdentityRegistry.setHolder(submitter);

        vm.startPrank(submitter);
        lrepToken.approve(address(registry), 10e6);
        uint256 contentId = _submitContentWithReservation(
            registry, "https://example.com/unchanged-identity", "goal", "goal", "tags", 0
        );
        vm.stopPrank();

        assertEq(registry.getSubmitterIdentity(contentId), submitter);
    }

    function test_DirectReveal_KeepsReservationSnapshotAfterIdentityChange() public {
        string memory url = "https://example.com/direct-identity-change";
        string memory title = "goal";
        string memory tags = "tags";
        bytes32 salt = keccak256("direct-identity-change-salt");
        string[] memory imageUrls = _singleImageUrls(_submissionImageUrl(url));

        vm.startPrank(submitter);
        _reserveQuestionMediaSubmission(registry, url, imageUrls, "", title, tags, 1, salt, submitter);
        vm.stopPrank();

        vm.prank(owner);
        mockRaterIdentityRegistry.setHolder(submitter);

        vm.warp(block.timestamp + 1);

        vm.startPrank(submitter);
        uint256 contentId = registry.submitQuestion(
            url, imageUrls, "", title, tags, 1, _emptySubmissionDetails(), salt, _defaultQuestionSpec()
        );
        vm.stopPrank();

        assertEq(registry.getSubmitterIdentity(contentId), submitter);
        assertEq(
            registry.contentSubmitterIdentityKey(contentId), mockRaterIdentityRegistry.addressIdentityKey(submitter)
        );
    }

    function test_SubmitQuestion_BanAfterReservationBlocksReveal() public {
        vm.prank(owner);
        mockRaterIdentityRegistry.setHolder(submitter);

        string memory url = "https://example.com/ban-after-reservation";
        string memory title = "goal";
        string memory tags = "tags";
        bytes32 salt = keccak256("ban-after-reservation-salt");
        string[] memory imageUrls = _singleImageUrls(_submissionImageUrl(url));

        vm.startPrank(submitter);
        _reserveQuestionMediaSubmission(registry, url, imageUrls, "", title, tags, 1, salt, submitter);
        vm.stopPrank();

        vm.prank(owner);
        mockRaterIdentityRegistry.setBanned(bytes32(uint256(uint160(submitter))), true);

        vm.warp(block.timestamp + 1);

        vm.startPrank(submitter);
        vm.expectRevert();
        registry.submitQuestion(
            url, imageUrls, "", title, tags, 1, _emptySubmissionDetails(), salt, _defaultQuestionSpec()
        );
        vm.stopPrank();
    }

    function test_SubmitContent_UsesReservationRaterIdentity() public {
        vm.prank(owner);
        mockRaterIdentityRegistry.setHolder(submitter);

        vm.prank(submitter);
        mockRaterIdentityRegistry.setDelegate(delegate);

        string memory url = "https://example.com/delegate-content";
        string memory title = "goal";
        string memory tags = "tags";
        bytes32 salt = keccak256("delegate-content-salt");
        string memory contextUrl = "https://example.com/context";
        string memory imageUrl = _submissionImageUrl(url);
        string[] memory imageUrls = _singleImageUrls(imageUrl);

        vm.startPrank(delegate);
        _reserveQuestionMediaSubmission(registry, contextUrl, imageUrls, "", title, tags, 1, salt, delegate);
        vm.stopPrank();

        vm.warp(block.timestamp + 1);

        vm.startPrank(delegate);
        uint256 contentId = registry.submitQuestion(
            contextUrl, imageUrls, "", title, tags, 1, _emptySubmissionDetails(), salt, _defaultQuestionSpec()
        );
        vm.stopPrank();

        assertEq(registry.getSubmitterIdentity(contentId), submitter);
        assertEq(registry.contentSubmitterIdentityKey(contentId), bytes32(uint256(uint160(submitter))));
    }

    function test_SubmitQuestion_RevokedDelegateCannotRevealReservation() public {
        vm.prank(owner);
        mockRaterIdentityRegistry.setHolder(submitter);

        vm.prank(submitter);
        mockRaterIdentityRegistry.setDelegate(delegate);

        string memory title = "Is this supported?";
        string memory tags = "identity";
        string memory url = _submissionImageUrl("identity-check");
        bytes32 salt = keccak256("delegate-question-salt");
        string[] memory imageUrls = _singleImageUrls(url);

        vm.startPrank(delegate);
        lrepToken.approve(address(registry), 10e6);
        _reserveQuestionMediaSubmission(registry, url, imageUrls, "", title, tags, 1, salt, delegate);
        vm.stopPrank();

        vm.prank(submitter);
        mockRaterIdentityRegistry.removeDelegate();

        vm.prank(delegate);
        mockRaterIdentityRegistry.setHolder(delegate);

        vm.warp(block.timestamp + 1);

        vm.startPrank(delegate);
        vm.expectRevert();
        registry.submitQuestion(
            url, imageUrls, "", title, tags, 1, _emptySubmissionDetails(), salt, _defaultQuestionSpec()
        );
        vm.stopPrank();
    }
}
