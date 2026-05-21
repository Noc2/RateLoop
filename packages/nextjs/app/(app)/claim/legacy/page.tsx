import type { Metadata, NextPage } from "next";
import { LegacyClaimPage } from "~~/components/claim/LegacyClaimPage";
import { getMetadata } from "~~/utils/scaffold-eth/getMetadata";

export const metadata: Metadata = {
  ...getMetadata({
    title: "Legacy LREP Claim",
    description: "Hidden claim page for eligible legacy RateLoop contributors.",
  }),
  robots: {
    index: false,
    follow: false,
  },
};

const LegacyClaimRoute: NextPage = () => {
  return <LegacyClaimPage />;
};

export default LegacyClaimRoute;
