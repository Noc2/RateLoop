// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { Test } from "forge-std/Test.sol";
import { FeedbackRegistry } from "../contracts/FeedbackRegistry.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract FeedbackRegistryVotingEngineStub {
    fallback() external payable { }
}

contract FeedbackRegistryTest is Test {
    FeedbackRegistry internal feedbackRegistry;

    function setUp() public {
        address votingEngine = address(new FeedbackRegistryVotingEngineStub());
        FeedbackRegistry impl = new FeedbackRegistry();
        feedbackRegistry = FeedbackRegistry(
            address(
                new ERC1967Proxy(
                    address(impl), abi.encodeCall(FeedbackRegistry.initialize, (address(this), address(this), votingEngine))
                )
            )
        );
    }

    function testContentFeedbackHashDomainMatchesCanonicalPreimage() public view {
        assertEq(
            feedbackRegistry.CONTENT_FEEDBACK_HASH_DOMAIN(),
            keccak256("rateloop.content-feedback.v1")
        );
    }

    function testBuildContentFeedbackHashUsesCanonicalStringDomain() public view {
        bytes32 expected = keccak256(
            abi.encode(
                "rateloop.content-feedback.v1",
                block.chainid,
                uint256(7),
                uint256(3),
                address(0xBEEF),
                "evidence",
                keccak256(bytes("Helpful feedback")),
                keccak256(bytes("https://example.com/source")),
                bytes32(uint256(42))
            )
        );

        assertEq(
            feedbackRegistry.buildContentFeedbackHash(
                7,
                3,
                address(0xBEEF),
                "evidence",
                "Helpful feedback",
                "https://example.com/source",
                bytes32(uint256(42))
            ),
            expected
        );
    }
}
