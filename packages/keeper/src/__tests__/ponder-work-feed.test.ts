import { describe, expect, it } from "vitest";
import {
  createPonderWorkFeed,
  prioritizedKeeperWorkRoundIds,
} from "../ponder-work-feed.js";

const PANEL = "0x0000000000000000000000000000000000000011";

describe("Ponder keeper work feed", () => {
  it("uses bearer authentication and validates the frozen deployment identity", async () => {
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      requestedInit = init;
      return new Response(
        JSON.stringify({
          deploymentKey: "deployment-key",
          chainId: 84_532,
          panelAddress: PANEL,
          now: "300",
          work: [
            { action: "finalize_scoring_seed", roundId: "7", cursor: null },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const feed = createPonderWorkFeed({
      baseUrl: "https://ponder.example/prefix/",
      token: "keeper-secret",
      fetchImpl: fetchImpl as typeof fetch,
    });
    const response = await feed({ now: 300n, limit: 500 });
    expect(requestedUrl).toBe(
      "https://ponder.example/prefix/keeper/work?now=300&direction=desc&limit=500",
    );
    expect(requestedInit?.headers).toMatchObject({
      authorization: "Bearer keeper-secret",
    });
    expect(
      prioritizedKeeperWorkRoundIds(response, {
        deploymentKey: "deployment-key",
        chainId: 84_532,
        panelAddress: PANEL,
        now: 300n,
      }),
    ).toEqual([7n]);
  });
});
