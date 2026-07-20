# Randamu bls-solidity provenance

`BLS2.sol` and `Precompiles.sol` are the minimal source subset required by RateLoop's quicknet-t verifier. They were
vendored from Randamu's MIT-licensed `bls-solidity` repository at commit
`11af179a8287d978659aae07adb66aa60f64b8a6`.

The vendored code is experimental and unaudited. Inclusion in this repository is not an audit or an endorsement for
real-money use. RateLoop's production-readiness gate continues to require an independent review of the verifier and
the exact compiled runtime bytecode.

Local changes pin the Solidity pragma/import style, remove library functions that the quicknet-t verifier does not
call, add an explicit affine G1 curve-membership check before malformed points reach the pairing precompile, and cap
the pairing subcall at 500,000 gas so a non-subgroup input returns false without consuming all caller gas. The retained
upstream implementations and constants are otherwise unchanged.
