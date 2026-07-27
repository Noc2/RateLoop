import { HOSTED_AUTH_ROLES, type HostedAuthConfig, type HostedAuthRole, readHostedAuthConfig } from "./config";
import { ResendReceivingInbox, redactHostedAuthSecrets } from "./inbox";
import type { Browser, BrowserContext, Page } from "@playwright/test";

type HarnessOptions = {
  environment?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
};

type CleanupOptions = {
  signOut?: boolean;
};

type IdentityRuntime = {
  authenticated: boolean;
  context: BrowserContext;
  session: HostedBrowserSession | null;
};

type HostedBrowserSession = {
  authenticated: true;
  authProvider: "better_auth:email-otp";
  principalId: string;
};

async function assertAuthenticatedSession(page: Page): Promise<HostedBrowserSession> {
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) return { authenticated: false, authProvider: null, principalId: null, status: response.status };
    const body = (await response.json()) as {
      authenticated?: unknown;
      authProvider?: unknown;
      principalId?: unknown;
    };
    return {
      authenticated: body.authenticated === true,
      authProvider: body.authProvider,
      principalId: body.principalId,
      status: response.status,
    };
  });
  if (
    !result.authenticated ||
    result.authProvider !== "better_auth:email-otp" ||
    typeof result.principalId !== "string" ||
    !result.principalId
  ) {
    throw new Error(`The hosted sign-in UI did not establish a RateLoop session (status ${result.status}).`);
  }
  return {
    authenticated: true,
    authProvider: "better_auth:email-otp",
    principalId: result.principalId,
  };
}

export class HostedAuthHarness {
  readonly runStartedAt: Date;
  private readonly inbox: ResendReceivingInbox;
  private readonly runtimes: Record<HostedAuthRole, IdentityRuntime>;

  private constructor(
    readonly config: HostedAuthConfig,
    runtimes: Record<HostedAuthRole, IdentityRuntime>,
    inbox: ResendReceivingInbox,
    runStartedAt: Date,
  ) {
    this.runtimes = runtimes;
    this.inbox = inbox;
    this.runStartedAt = runStartedAt;
  }

  static async create(browser: Browser, options: HarnessOptions = {}) {
    const config = readHostedAuthConfig(options.environment);
    const runStartedAt = new Date();
    const created: BrowserContext[] = [];
    try {
      for (const _role of HOSTED_AUTH_ROLES) {
        created.push(
          await browser.newContext({
            baseURL: config.baseUrl,
            colorScheme: "dark",
            viewport: { height: 900, width: 1440 },
          }),
        );
      }
    } catch (error) {
      await Promise.allSettled(created.map(context => context.close()));
      throw error;
    }
    const runtimes = Object.fromEntries(
      HOSTED_AUTH_ROLES.map((role, index) => [role, { authenticated: false, context: created[index]!, session: null }]),
    ) as Record<HostedAuthRole, IdentityRuntime>;
    const inbox = new ResendReceivingInbox(
      {
        apiKey: config.inbox.apiKey,
        expectedFrom: config.inbox.expectedFrom,
        pollIntervalMs: config.inbox.pollIntervalMs,
        pollTimeoutMs: config.inbox.pollTimeoutMs,
      },
      { fetchImpl: options.fetchImpl },
    );
    return new HostedAuthHarness(config, runtimes, inbox, runStartedAt);
  }

  context(role: HostedAuthRole) {
    return this.runtimes[role].context;
  }

  async session(role: HostedAuthRole): Promise<HostedBrowserSession> {
    const current = this.runtimes[role].session;
    if (current) return current;
    const response = await this.runtimes[role].context.request.get("/api/auth/session", {
      failOnStatusCode: false,
      headers: { "Cache-Control": "no-store" },
    });
    if (!response.ok()) {
      throw new Error(`The ${role} RateLoop session returned status ${response.status()}.`);
    }
    const body = (await response.json()) as {
      authenticated?: unknown;
      authProvider?: unknown;
      principalId?: unknown;
    };
    if (
      body.authenticated !== true ||
      body.authProvider !== "better_auth:email-otp" ||
      typeof body.principalId !== "string" ||
      !body.principalId
    ) {
      throw new Error(`The ${role} RateLoop session is not authenticated.`);
    }
    return { authenticated: true, authProvider: "better_auth:email-otp", principalId: body.principalId };
  }

  private sensitiveValues() {
    return [
      this.config.inbox.apiKey,
      this.config.accounts.owner.email,
      this.config.accounts.reviewerOne.email,
      this.config.accounts.reviewerTwo.email,
    ];
  }

  async signIn(role: HostedAuthRole) {
    const runtime = this.runtimes[role];
    if (runtime.authenticated) throw new Error(`The ${role} browser context is already authenticated.`);
    const account = this.config.accounts[role];
    const page = await runtime.context.newPage();
    try {
      await page.goto("/sign-in?returnTo=%2F", { waitUntil: "domcontentloaded" });
      const email = page.getByLabel("Work email");
      await email.waitFor({ state: "visible" });
      await email.fill(account.email);
      const requestedAt = new Date();
      await page.getByRole("button", { name: "Email me a code" }).click();
      const otpInput = page.getByLabel("Six-digit code");
      await otpInput.waitFor({ state: "visible" });
      const otp = await this.inbox.waitForOtp({
        recipient: account.email,
        requestedAt,
        runStartedAt: this.runStartedAt,
      });
      await otpInput.fill(otp);
      await page.getByRole("button", { name: "Verify code" }).click();
      const finish = page.getByRole("button", { name: "Finish sign-in" });
      await finish.waitFor({ state: "visible" });
      await finish.click();
      await page.waitForURL(url => url.origin === this.config.baseUrl && url.pathname !== "/sign-in");
      runtime.session = await assertAuthenticatedSession(page);
      runtime.authenticated = true;
      return { role };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Hosted authentication failed.";
      throw new Error(redactHostedAuthSecrets(message, this.sensitiveValues()));
    } finally {
      await page.close();
    }
  }

  async signInAll() {
    const results: Array<{ role: HostedAuthRole }> = [];
    for (const role of HOSTED_AUTH_ROLES) results.push(await this.signIn(role));
    const principals = await Promise.all(HOSTED_AUTH_ROLES.map(role => this.session(role)));
    if (new Set(principals.map(session => session.principalId)).size !== HOSTED_AUTH_ROLES.length) {
      throw new Error("Hosted authentication roles must resolve to three distinct RateLoop principals.");
    }
    return results;
  }

  async signOut(role: HostedAuthRole) {
    const runtime = this.runtimes[role];
    const page = await runtime.context.newPage();
    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      const result = await page.evaluate(async () => {
        const response = await fetch("/api/auth/logout", {
          cache: "no-store",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          method: "POST",
          body: "{}",
        });
        return { ok: response.ok, status: response.status };
      });
      if (!result.ok) throw new Error(`Hosted sign-out failed with status ${result.status}.`);
      runtime.authenticated = false;
      runtime.session = null;
      await runtime.context.clearCookies();
    } finally {
      await page.close();
    }
  }

  async cleanup(options: CleanupOptions = {}) {
    const signOut = options.signOut ?? true;
    const failures: string[] = [];
    if (signOut) {
      for (const role of HOSTED_AUTH_ROLES) {
        if (!this.runtimes[role].authenticated) continue;
        try {
          await this.signOut(role);
        } catch (error) {
          failures.push(error instanceof Error ? error.message : `Unable to sign out ${role}.`);
        }
      }
    }
    await Promise.allSettled(HOSTED_AUTH_ROLES.map(role => this.runtimes[role].context.close()));
    if (failures.length > 0) {
      throw new Error(redactHostedAuthSecrets(failures.join(" "), this.sensitiveValues()));
    }
  }
}
