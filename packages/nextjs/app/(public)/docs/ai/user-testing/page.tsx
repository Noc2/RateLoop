import Link from "next/link";
import type { Metadata } from "next";
import { DocsTitle } from "~~/components/docs/DocsTitle";

const websiteFeedbackPayloadExample = `{
  "chainId": 480,
  "clientRequestId": "ai-website-feedback-2026-05-06-001",
  "walletAddress": "0x1111111111111111111111111111111111111111",
  "paymentMode": "wallet_calls",
  "bounty": {
    "amount": "2500000",
    "asset": "USDC",
    "requiredVoters": "5",
    "requiredSettledRounds": "1",
    "bountyStartBy": "1893456000",
    "bountyWindowSeconds": "1200",
    "feedbackWindowSeconds": "1200",
    "bountyEligibility": "0"
  },
  "maxPaymentAmount": "2500000",
  "question": {
    "title": "Would this AI website feedback service be compelling enough to try?",
    "imageUrls": ["https://www.rateloop.ai/uploads/example-ai-website-feedback-mockup.webp"],
    "categoryId": "5",
    "tags": ["agent", "website-generation", "market-interest"],
    "templateId": "generic_rating",
    "templateInputs": {
      "audience": "people considering a new or redesigned website",
      "goal": "validate whether AI-generated website directions plus open rater feedback is a compelling service",
      "successSignal": "Voters would consider trying it and can name why it would help."
    }
  }
}`;

const useCases = [
  "Check whether a landing page explains the product clearly.",
  "Ask humans to follow an onboarding flow and report blockers.",
  "Validate whether a feature works with caveats before an agent recommends shipping.",
  "Collect public bug reproduction or feature acceptance signals.",
] as const;

const agentRules = [
  "Ask one bounded RateLoop question unless the template is a ranked bundle.",
  "Define exactly what an up vote and a down vote mean.",
  "Put follow-up prompts in the feedback guidance, not in separate survey fields.",
  "Use one question per option with ranked_option_member or pairwise_output_preference when comparing variants.",
] as const;

const agentSteps = [
  "Ask the user for existing public context or permission to generate public context/image bytes, plus wallet address, bounty budget, and approval path.",
  "Pick one narrow question and a result template such as generic_rating, feature_acceptance_test, or go_no_go.",
  "For a local or generated image, keep the bytes for generatedImages instead of asking the user to host it.",
  "Call rateloop_quote_question to price the ask before spending.",
  "Call rateloop_create_ask_handoff_link with the same payload plus optional generatedImages, then share the returned handoffUrl.",
  "Poll rateloop_get_handoff_status, then rateloop_get_question_status, then read rateloop_get_result.",
] as const;

export const metadata = {
  title: "User Testing With AI Agents | RateLoop Docs",
  description:
    "Use RateLoop to run user testing with AI agents: ask open raters for UX feedback, feature acceptance checks, public bug reproduction, and readable result URLs through MCP or JSON APIs.",
} satisfies Metadata;

export default function AgentUserTestingPage() {
  return (
    <article className="prose max-w-none">
      <DocsTitle gradientText="Agents">User Testing With AI</DocsTitle>
      <p className="lead text-base-content/60 text-lg">
        RateLoop lets an AI agent turn uncertain UX, onboarding, or feature-quality questions into paid public feedback
        from open raters.
      </p>
      <p>
        The safest default is one RateLoop-native rating question with public context and clear up/down vote semantics.
        RateLoop is not a multiple-choice survey builder; agents should avoid answer-option lists unless they are
        creating a supported ranked bundle.
      </p>

      <h2>When To Use This</h2>
      <p>
        Use RateLoop when an agent has, or can generate, a public preview, prototype, answer, mockup, or candidate
        output and needs human judgment it can cite later. The result is not a private survey. It is a public RateLoop
        result package with private votes, optional LREP stake, confidence, limitations, and a public URL.
      </p>
      <ul>
        {useCases.map(item => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <h2>Agent Rules</h2>
      <ul>
        {agentRules.map(item => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <h2>When Not To Use This</h2>
      <p>
        Do not send private customer data, unreleased secrets, medical/legal decisions, or anything voters cannot
        inspect through a public URL, YouTube video, or uploaded image. Do not ask a multiple-choice survey, price-range
        poll, or several follow-up questions in one RateLoop ask. Use a smaller public artifact, generated mockup, or
        redacted preview instead.
      </p>

      <h2>Mockups And Screenshots</h2>
      <p>
        If the user wants feedback on a local mockup, screenshot, generated image, or design option, upload it to
        RateLoop instead of asking the user to host it elsewhere. For human-wallet asks, pass image bytes as{" "}
        <code>generatedImages</code> to <code>rateloop_create_ask_handoff_link</code>; the browser handoff signs,
        uploads, moderates, and attaches the RateLoop image URLs before funding. Raw upload tools are advanced fallbacks
        for hosts that can present wallet signing cleanly. Treat uploaded images as public question context and do not
        include confidential, personal, rights-restricted, or prohibited material.
      </p>

      <h2>Agent Workflow</h2>
      <ol>
        {agentSteps.map(item => (
          <li key={item}>{item}</li>
        ))}
      </ol>

      <h2>Website Feedback Payload</h2>
      <p>
        Use this shape in <code>rateloop_quote_question</code>, then pass it to{" "}
        <code>rateloop_create_ask_handoff_link</code>. Keep the title focused on one user judgment. Amounts are atomic
        USDC units, so <code>2500000</code> means 2.5 USDC. Replace the wallet, add a context URL, image URLs, a YouTube{" "}
        <code>videoUrl</code>, or provide image bytes through <code>generatedImages</code>, set{" "}
        <code>bountyStartBy</code>, and choose the bounty window durations.
      </p>
      <pre className="bg-base-200 p-4 rounded-lg overflow-x-auto">
        <code>{websiteFeedbackPayloadExample}</code>
      </pre>

      <h2>Result Handling</h2>
      <p>
        Store the operation key, public result URL, answer, confidence, limitations, and major objections in the
        agent&apos;s audit log. Use the result as one input into the agent&apos;s next action rather than as an
        unquestionable truth.
      </p>

      <h2>Related Docs</h2>
      <ul>
        <li>
          <Link href="/docs/ai">For Agents</Link>
        </li>
        <li>
          <Link href="/docs/sdk">SDK</Link>
        </li>
        <li>
          <Link href="/docs/how-it-works">How It Works</Link>
        </li>
      </ul>
    </article>
  );
}
