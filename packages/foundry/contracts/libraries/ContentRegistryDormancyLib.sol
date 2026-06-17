// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ContentRegistryTypes } from "./ContentRegistryTypes.sol";

/// @title ContentRegistryDormancyLib
/// @notice Dormancy lifecycle helpers extracted from ContentRegistry for EIP-170 headroom.
library ContentRegistryDormancyLib {
    using SafeERC20 for IERC20;

    event ContentDormant(uint256 indexed contentId);
    event ContentRevived(uint256 indexed contentId, address indexed reviver);
    event DormantSubmissionKeyReleased(uint256 indexed contentId, bytes32 indexed submissionKey);

    function markDormant(
        ContentRegistryTypes.Content storage content,
        mapping(uint256 => uint256) storage dormancyAnchorAt,
        mapping(uint256 => bytes32) storage contentSubmissionKey,
        mapping(uint256 => uint256) storage dormantKeyReleasableAt,
        uint256 contentId,
        uint256 dormancyPeriod,
        uint256 dormantExclusiveRevivalPeriod,
        bool hasDormancyBlockingRound,
        bool isBundleMember
    ) external {
        require(content.id != 0);
        require(content.status == ContentRegistryTypes.ContentStatus.Active);
        require(block.timestamp > dormancyAnchorAt[contentId] + dormancyPeriod);
        require(!hasDormancyBlockingRound);
        require(!isBundleMember);

        content.status = ContentRegistryTypes.ContentStatus.Dormant;

        bytes32 submissionKey = contentSubmissionKey[contentId];
        if (submissionKey != bytes32(0)) {
            dormantKeyReleasableAt[contentId] = block.timestamp + dormantExclusiveRevivalPeriod;
        }

        emit ContentDormant(contentId);
    }

    function reviveContent(
        ContentRegistryTypes.Content storage content,
        mapping(uint256 => bytes32) storage contentSubmissionKey,
        mapping(bytes32 => bool) storage submissionKeyUsed,
        mapping(uint256 => uint256) storage dormancyAnchorAt,
        mapping(uint256 => uint256) storage dormantKeyReleasableAt,
        IERC20 lrepToken,
        address treasury,
        uint256 contentId,
        uint256 revivalStake,
        uint8 maxRevivals,
        bool isSubmitter
    ) external {
        require(content.status == ContentRegistryTypes.ContentStatus.Dormant);
        require(content.dormantCount < maxRevivals);

        bytes32 submissionKey = contentSubmissionKey[contentId];
        require(submissionKey != bytes32(0));
        require(submissionKeyUsed[submissionKey]);
        require(isSubmitter);
        require(block.timestamp <= dormantKeyReleasableAt[contentId]);

        require(treasury != address(0));
        address reviver = msg.sender;
        lrepToken.safeTransferFrom(reviver, treasury, revivalStake);

        content.status = ContentRegistryTypes.ContentStatus.Active;
        content.dormantCount++;
        content.lastActivityAt = uint48(block.timestamp);
        dormancyAnchorAt[contentId] = block.timestamp;
        delete dormantKeyReleasableAt[contentId];
        content.reviver = reviver;

        emit ContentRevived(contentId, reviver);
    }

    function releaseDormantSubmissionKey(
        ContentRegistryTypes.Content storage content,
        mapping(uint256 => bytes32) storage contentSubmissionKey,
        mapping(bytes32 => bool) storage submissionKeyUsed,
        mapping(uint256 => uint256) storage dormantKeyReleasableAt,
        uint256 contentId,
        bool isBundleMember
    ) external {
        require(content.id != 0);
        require(content.status == ContentRegistryTypes.ContentStatus.Dormant);
        require(!isBundleMember);

        bytes32 submissionKey = contentSubmissionKey[contentId];
        require(submissionKey != bytes32(0));
        require(block.timestamp > dormantKeyReleasableAt[contentId]);

        submissionKeyUsed[submissionKey] = false;
        delete contentSubmissionKey[contentId];
        delete dormantKeyReleasableAt[contentId];

        emit DormantSubmissionKeyReleased(contentId, submissionKey);
    }
}
