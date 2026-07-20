// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

// Vendored from Randamu bls-solidity commit 11af179a8287d978659aae07adb66aa60f64b8a6.
// See LICENSE and PROVENANCE.md in this directory.

// @notice address of the EIP-198 modular exponentiation precompile
uint256 constant MODEXP_ADDRESS = 5;

// @notice address of the EIP-2537 BLS12-381 point addition precompile
uint256 constant BLS12_G1ADD = 0x0b;

// @notice address of the EIP-2537 BLS12-381 pairing check precompile
uint256 constant BLS12_PAIRING_CHECK = 0x0f;

// @notice address of the EIP-2537 BLS12-381 base field element to point precompile
// @dev it uses the Simplified Shallue-van de Woestijne-Ulas mapping (SSWU)
uint256 constant BLS12_MAP_FP_TO_G1 = 0x10;
