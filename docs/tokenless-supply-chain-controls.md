# Tokenless supply-chain controls

**Status:** Current CI and release-evidence controls.

The tokenless CI line now produces repeatable engineering evidence; it does not constitute a certification.

- CodeQL runs JavaScript/TypeScript `security-extended` queries for pushes and pull requests to `main` and `tokenless`,
  plus a weekly full scan.
- Yarn audits remain fail-closed for production and development dependencies.
- Dependabot checks Yarn, GitHub Actions, and both service Dockerfiles weekly.
- Keeper and Ponder images are built from their checked Dockerfiles, inventoried as CycloneDX JSON with digest-pinned
  Syft, and scanned for unfixed high/critical vulnerabilities with digest-pinned Trivy.
- Container findings are uploaded as SARIF. The scan still fails after SARIF upload when the severity gate is crossed.
- On pushes, each saved image receives GitHub/Sigstore SLSA build-provenance and SBOM attestations. The SBOM is also
  retained as a workflow artifact for 30 days.

GitHub repository administration must enable code scanning, dependency alerts, Dependabot security updates, artifact
attestations for the repository plan, protected required checks, secret scanning, and push protection. Those external
settings are release evidence and cannot be inferred from these workflow files.

Before promoting a release, review the CodeQL and container SARIF results, download both SBOM artifacts, verify the
attestation for the exact workflow artifact digest, and record any approved exception with owner and expiry. Never
market these checks as a penetration test, SOC 2, or independent certification.
