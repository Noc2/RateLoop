import { sql } from "ponder";
import { content, rewardClaim, vote } from "ponder:schema";
import { buildAllowedContentCondition } from "./moderation.js";

export function profileTotalVotesExpr(addressExpr: unknown) {
  return sql<number>`(
    select count(*)
    from ${vote}
    where ${vote.voter} = ${addressExpr}
      or ${vote.identityHolder} = ${addressExpr}
  )`;
}

export function profileTotalContentExpr(addressExpr: unknown) {
  return sql<number>`(
    select count(*)
    from ${content}
    where ${content.submitter} = ${addressExpr}
      and ${buildAllowedContentCondition({
        canonicalUrl: content.canonicalUrl,
        description: content.description,
        tags: content.tags,
        title: content.title,
        url: content.url,
        urlHost: content.urlHost,
      })}
  )`;
}

export function profileTotalRewardsClaimedExpr(addressExpr: unknown) {
  return sql<bigint>`coalesce((select sum(
    case when ${rewardClaim.voter} = ${addressExpr} then ${rewardClaim.lrepReward} else 0 end +
    case when ${rewardClaim.stakePayer} = ${addressExpr} then ${rewardClaim.stakeReturned} else 0 end
  ) from ${rewardClaim} where ${rewardClaim.voter} = ${addressExpr} or ${rewardClaim.stakePayer} = ${addressExpr}), 0)`;
}
