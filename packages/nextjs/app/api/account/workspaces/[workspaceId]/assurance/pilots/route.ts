import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { requestProjectDeletion, storeEncryptedArtifact } from "~~/lib/tokenless/artifactPrivacy";
import {
  addAssuranceCase,
  createAssuranceProject,
  createAssuranceSuite,
  freezeAssuranceSuite,
  markAssuranceCaseReady,
  scopeAssuranceSessionToWorkspace,
} from "~~/lib/tokenless/humanAssurance";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string }> };

function text(value: unknown, name: string, min: number, max: number) {
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max) {
    throw new TokenlessServiceError(`${name} must be ${min}-${max} characters.`, 400, "invalid_pilot");
  }
  return value.trim();
}

export async function POST(request: NextRequest, context: Context) {
  let cleanup: { accountAddress: string; projectId: string; workspaceId: string } | null = null;
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId } = await context.params;
    const principal = await scopeAssuranceSessionToWorkspace({ accountAddress: session.address, workspaceId });
    const body = (await request.json()) as Record<string, unknown>;
    if (body.confirmedRedacted !== true) {
      throw new TokenlessServiceError(
        "Confirm that the case contains no secrets or regulated personal data.",
        400,
        "redaction_confirmation_required",
      );
    }
    const projectName = text(body.projectName, "projectName", 2, 160);
    const caseTitle = text(body.caseTitle, "caseTitle", 2, 200);
    const baseline = text(body.baseline, "baseline", 2, 25_000);
    const candidate = text(body.candidate, "candidate", 2, 25_000);
    const criterion = text(body.criterion, "criterion", 10, 500);
    if (baseline === candidate) {
      throw new TokenlessServiceError("Baseline and candidate must differ.", 400, "identical_pilot_variants");
    }
    const project = await createAssuranceProject({
      principal,
      name: projectName,
      description: "One-case human-assurance pilot created from the buyer workspace.",
      dataClassification: body.dataClassification === "confidential" ? "confidential" : "internal",
      retentionDays: typeof body.retentionDays === "number" ? body.retentionDays : 30,
    });
    cleanup = { accountAddress: session.address, projectId: project.projectId, workspaceId };
    const [baselineArtifact, candidateArtifact] = await Promise.all([
      storeEncryptedArtifact({
        accountAddress: session.address,
        bytes: new TextEncoder().encode(baseline),
        contentType: "text/plain",
        label: "Baseline",
        projectId: project.projectId,
        redactionStatus: "approved",
        rendererPolicy: "plain_text",
        role: "baseline",
        workspaceId,
      }),
      storeEncryptedArtifact({
        accountAddress: session.address,
        bytes: new TextEncoder().encode(candidate),
        contentType: "text/plain",
        label: "Candidate",
        projectId: project.projectId,
        redactionStatus: "approved",
        rendererPolicy: "plain_text",
        role: "candidate",
        workspaceId,
      }),
    ]);
    const suite = await createAssuranceSuite({
      principal,
      projectId: project.projectId,
      name: `${projectName} release gate`,
      rubric: {
        prompt: criterion,
        failureTags: [
          { key: "incorrect", label: "Incorrect" },
          { key: "unclear", label: "Unclear" },
          { key: "unsafe", label: "Unsafe or inappropriate" },
          { key: "off_policy", label: "Does not follow the declared policy" },
        ],
        rationale: { mode: "required", minLength: 10, maxLength: 1_000 },
        passRule: {
          metric: "candidate_preference_share_bps",
          operator: "gte",
          thresholdBps: 6_000,
          minimumValidResponses: 3,
        },
      },
    });
    const assuranceCase = await addAssuranceCase({
      principal,
      suiteId: suite.suiteId,
      suiteVersion: suite.version,
      title: caseTitle,
      instructions: "Compare the two blinded variants using the frozen rubric. Select a preference and explain why.",
      baselineArtifactId: baselineArtifact.artifactId,
      candidateArtifactId: candidateArtifact.artifactId,
    });
    await markAssuranceCaseReady({ principal, caseId: assuranceCase.caseId });
    const frozen = await freezeAssuranceSuite({ principal, suiteId: suite.suiteId, suiteVersion: suite.version });
    cleanup = null;
    return NextResponse.json(
      {
        projectId: project.projectId,
        suiteId: suite.suiteId,
        suiteVersion: suite.version,
        caseId: assuranceCase.caseId,
        manifestHash: frozen.manifestHash,
        nextStep: "Configure a reviewer cohort and approve the run manifest.",
      },
      { status: 201 },
    );
  } catch (error) {
    if (cleanup) {
      await requestProjectDeletion({ ...cleanup, reason: "failed_pilot_setup" }).catch(() => undefined);
    }
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
