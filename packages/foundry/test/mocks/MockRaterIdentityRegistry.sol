// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import { IRaterIdentityRegistry } from "../../contracts/interfaces/IRaterIdentityRegistry.sol";

contract MockRaterIdentityRegistry is IRaterIdentityRegistry {
    mapping(address => bool) public holders;
    mapping(address => uint256) public credentialIds;
    mapping(uint256 => address) public credentialHolders;
    mapping(uint256 => uint256) public credentialNullifiers;
    mapping(uint256 => uint256) public nullifierCredentialIds;
    mapping(bytes32 => address) public humanNullifierOwner;
    mapping(address => address) public delegateTo;
    mapping(address => address) public delegateOf;

    uint256 public nextCredentialId = 1;

    function setHolder(address holder) external {
        _mintOrAssign(holder, uint256(uint160(holder)));
    }

    function removeHolder(address holder) external {
        _revoke(holder);
    }

    function mint(address holder, uint256 nullifier) external returns (uint256 credentialId) {
        return _mintOrAssign(holder, nullifier);
    }

    function revokeHumanCredential(address holder) external {
        _revoke(holder);
    }

    function resetNullifier(uint256 nullifier) external {
        uint256 credentialId = nullifierCredentialIds[nullifier];
        if (credentialId != 0) {
            delete nullifierCredentialIds[nullifier];
            delete humanNullifierOwner[bytes32(nullifier)];
        }
    }

    function setDelegate(address delegate) external {
        address previous = delegateTo[msg.sender];
        if (previous != address(0)) {
            delete delegateOf[previous];
        }
        delegateTo[msg.sender] = delegate;
        delegateOf[delegate] = msg.sender;
    }

    function acceptDelegate() external { }

    function removeDelegate() external {
        address delegate = delegateTo[msg.sender];
        if (delegate != address(0)) {
            delete delegateOf[delegate];
            delete delegateTo[msg.sender];
            return;
        }
        address holder = delegateOf[msg.sender];
        if (holder != address(0)) {
            delete delegateOf[msg.sender];
            delete delegateTo[holder];
        }
    }

    function getCredentialId(address holder) external view returns (uint256) {
        address resolvedHolder = delegateOf[holder] == address(0) ? holder : delegateOf[holder];
        return credentialIds[resolvedHolder];
    }

    function getHolder(uint256 credentialId) external view returns (address) {
        return credentialHolders[credentialId];
    }

    function getCredentialNullifier(uint256 credentialId) external view returns (uint256) {
        return credentialNullifiers[credentialId];
    }

    function hasActiveHumanCredential(address holder) external view returns (bool) {
        address resolvedHolder = delegateOf[holder] == address(0) ? holder : delegateOf[holder];
        return holders[resolvedHolder];
    }

    function resolveRater(address actor) external view returns (ResolvedRater memory resolved) {
        address holder = delegateOf[actor] == address(0) ? actor : delegateOf[actor];
        uint256 credentialId = credentialIds[holder];
        bytes32 humanNullifier = credentialId == 0 ? bytes32(0) : bytes32(credentialNullifiers[credentialId]);
        resolved = ResolvedRater({
            holder: holder,
            identityKey: humanNullifier == bytes32(0) ? addressIdentityKey(holder) : humanNullifier,
            humanNullifier: humanNullifier,
            hasActiveHumanCredential: holders[holder],
            delegated: holder != actor
        });
    }

    function addressIdentityKey(address account) public pure returns (bytes32) {
        if (account == address(0)) return bytes32(0);
        return keccak256(abi.encodePacked("rateloop.address-identity-v1", account));
    }

    function _mintOrAssign(address holder, uint256 nullifier) private returns (uint256 credentialId) {
        credentialId = credentialIds[holder];
        if (credentialId == 0 || credentialNullifiers[credentialId] != nullifier) {
            credentialId = nextCredentialId++;
            credentialIds[holder] = credentialId;
        }
        holders[holder] = true;
        credentialHolders[credentialId] = holder;
        credentialNullifiers[credentialId] = nullifier;
        nullifierCredentialIds[nullifier] = credentialId;
        humanNullifierOwner[bytes32(nullifier)] = holder;
    }

    function _revoke(address holder) private {
        holders[holder] = false;
        address delegate = delegateTo[holder];
        if (delegate != address(0)) {
            delete delegateTo[holder];
            delete delegateOf[delegate];
        }
        uint256 credentialId = credentialIds[holder];
        if (credentialId != 0) {
            delete humanNullifierOwner[bytes32(credentialNullifiers[credentialId])];
        }
    }
}
