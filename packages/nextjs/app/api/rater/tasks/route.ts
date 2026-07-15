import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { getWalletBindingAddresses } from "~~/lib/auth/walletBindings";
import { getPaidEligibility } from "~~/lib/tokenless/paidEligibility";
import { listPaidRaterTasks } from "~~/lib/tokenless/raterService";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const session = await requireBrowserSession(request);
    const params = request.nextUrl.searchParams;
    const scope = params.get("scope") ?? "all";
    const payoutAddress = (await getWalletBindingAddresses(session.principalId)).payout;
    if (scope !== "all" && scope !== "public") {
      return NextResponse.json(
        { tasks: [], query: params.get("q") ?? "", scope },
        { headers: { "Cache-Control": "private, no-store, max-age=0" } },
      );
    }
    const query = params.get("q") ?? "";
    const [tasks, eligibility] = await Promise.all([
      listPaidRaterTasks(payoutAddress, { query, scope }),
      payoutAddress ? getPaidEligibility(payoutAddress) : Promise.resolve({ status: "not_started" as const }),
    ]);
    return NextResponse.json(
      {
        tasks,
        query,
        scope,
        paidAccess: payoutAddress
          ? eligibility.status === "eligible"
            ? { state: "ready" }
            : { state: "eligibility_required", eligibilityStatus: eligibility.status }
          : { state: "payout_wallet_required" },
      },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, {
      status: response.status,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  }
}
