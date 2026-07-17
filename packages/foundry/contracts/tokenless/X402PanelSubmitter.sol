// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { TokenlessPanel } from "./TokenlessPanel.sol";
import { IERC3009 } from "./interfaces/IERC3009.sol";

/// @title X402PanelSubmitter
/// @notice Stateless EIP-3009 payment adapter for a TokenlessPanel.
/// @dev It has no owner, setters, sweep, retained balance, or lifecycle role. The user's
///      authorization pays the exact immutable round total and the panel records the user—not
///      this adapter—as funder, so every refund remains self-custodial.
contract X402PanelSubmitter is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ROUND_TERMS_TYPEHASH = keccak256(
        "RoundTerms(bytes32 contentId,bytes32 termsHash,bytes32 beaconNetworkHash,uint256 bountyAmount,uint256 feeAmount,uint256 attemptReserve,uint256 attemptCompensation,uint32 minimumReveals,uint32 maximumCommits,bytes32 admissionPolicyHash,uint64 commitDeadline,uint64 revealDeadline,uint64 beaconFailureDeadline,uint64 beaconRound,uint64 claimGracePeriod,address feeRecipient)"
    );
    bytes32 public constant ROUND_AUTHORIZATION_TYPEHASH = keccak256(
        "RoundAuthorization(address funder,address panel,bytes32 roundTermsDigest,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    struct Authorization {
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    IERC3009 public immutable authorizationToken;
    IERC20 public immutable usdc;
    TokenlessPanel public immutable panel;

    event RoundSubmitted(address indexed funder, uint256 indexed roundId, uint256 amount);

    error InvalidAddress();
    error InvalidSignature();
    error TransferAmountMismatch();

    constructor(address usdc_, address panel_) EIP712("RateLoop X402 Panel Submitter", "1") {
        if (usdc_ == address(0) || usdc_.code.length == 0 || panel_ == address(0) || panel_.code.length == 0) {
            revert InvalidAddress();
        }
        usdc = IERC20(usdc_);
        authorizationToken = IERC3009(usdc_);
        panel = TokenlessPanel(panel_);
    }

    function createRoundWithAuthorization(
        address funder,
        TokenlessPanel.RoundTerms calldata terms,
        Authorization calldata authorization,
        bytes calldata roundAuthorizationSignature
    ) external nonReentrant returns (uint256 roundId) {
        if (funder == address(0)) revert InvalidAddress();

        bytes32 digest = roundAuthorizationDigest(funder, terms, authorization);
        (address recovered, ECDSA.RecoverError signatureError,) =
            ECDSA.tryRecoverCalldata(digest, roundAuthorizationSignature);
        if (signatureError != ECDSA.RecoverError.NoError || recovered != funder) revert InvalidSignature();

        uint256 amount = terms.bountyAmount + terms.feeAmount + terms.attemptReserve;
        // Compare balance deltas, not totals, so a pre-existing unsolicited (donated) balance
        // cannot brick submissions. The authorization must increase the balance by exactly
        // `amount` (rejecting fee-on-transfer), and after the panel pulls the funds the balance
        // must return to its pre-call value, leaving any prior donated dust untouched.
        uint256 beforeBalance = usdc.balanceOf(address(this));
        authorizationToken.receiveWithAuthorization(
            funder,
            address(this),
            amount,
            authorization.validAfter,
            authorization.validBefore,
            authorization.nonce,
            authorization.v,
            authorization.r,
            authorization.s
        );
        if (usdc.balanceOf(address(this)) - beforeBalance != amount) revert TransferAmountMismatch();

        usdc.forceApprove(address(panel), amount);
        roundId = panel.createRoundFor(terms, funder);
        usdc.forceApprove(address(panel), 0);

        if (usdc.balanceOf(address(this)) != beforeBalance) revert TransferAmountMismatch();
        emit RoundSubmitted(funder, roundId, amount);
    }

    function roundTermsDigest(TokenlessPanel.RoundTerms calldata terms) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ROUND_TERMS_TYPEHASH,
                terms.contentId,
                terms.termsHash,
                terms.beaconNetworkHash,
                terms.bountyAmount,
                terms.feeAmount,
                terms.attemptReserve,
                terms.attemptCompensation,
                terms.minimumReveals,
                terms.maximumCommits,
                terms.admissionPolicyHash,
                terms.commitDeadline,
                terms.revealDeadline,
                terms.beaconFailureDeadline,
                terms.beaconRound,
                terms.claimGracePeriod,
                terms.feeRecipient
            )
        );
    }

    function roundAuthorizationDigest(
        address funder,
        TokenlessPanel.RoundTerms calldata terms,
        Authorization calldata authorization
    ) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    ROUND_AUTHORIZATION_TYPEHASH,
                    funder,
                    address(panel),
                    roundTermsDigest(terms),
                    authorization.validAfter,
                    authorization.validBefore,
                    authorization.nonce
                )
            )
        );
    }
}
