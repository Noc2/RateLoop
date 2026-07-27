import { HOSTED_AUTH_ROLES, type HostedAuthConfig, type HostedAuthRole, readHostedAuthConfig } from "./config";
import { ResendReceivingInbox, redactHostedAuthSecrets } from "./inbox";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

type HarnessOptions = {
  environment?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  packageRoot?: string;
};

type CleanupOptions = {
  removeStorageStates?: boolean;
  signOut?: boolean;
};

type IdentityRuntime = {
  authenticated: boolean;
  context: BrowserContext;
};

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;
type HostedBrowserSession = {
  authenticated: true;
  principalId: string;
};

async function persistStorageState(statePath: string, state: StorageState) {
  const directory = path.dirname(statePath);
  await mkdir(directory, { mode: 0o700, recursive: true });
  await chmod(directory, 0o700);
  const temporaryPath = path.join(directory, `.${path.basename(statePath)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, statePath);
    await chmod(statePath, 0o600);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function assertAuthenticatedSession(page: Page) {
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) return { authenticated: false, status: response.status };
    const body = (await response.json()) as { authenticated?: unknown };
    return { authenticated: body.authenticated === true, status: response.status };
  });
  if (!result.authenticated) {
    throw new Error(`The hosted sign-in UI did not establish a RateLoop session (status ${result.status}).`);
  }
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
    const config = readHostedAuthConfig(options.environment, { packageRoot: options.packageRoot });
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
      HOSTED_AUTH_ROLES.map((role, index) => [role, { authenticated: false, context: created[index]! }]),
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
    const response = await this.runtimes[role].context.request.get("/api/auth/session", {
      failOnStatusCode: false,
      headers: { "Cache-Control": "no-store" },
    });
    if (!response.ok()) {
      throw new Error(`The ${role} RateLoop session returned status ${response.status()}.`);
    }
    const body = (await response.json()) as { authenticated?: unknown; principalId?: unknown };
    if (body.authenticated !== true || typeof body.principalId !== "string" || !body.principalId) {
      throw new Error(`The ${role} RateLoop session is not authenticated.`);
    }
    return { authenticated: true, principalId: body.principalId };
  }

  storageStatePath(role: HostedAuthRole) {
    return this.config.accounts[role].storageStatePath;
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
      await assertAuthenticatedSession(page);
      runtime.authenticated = true;
      await persistStorageState(account.storageStatePath, await runtime.context.storageState());
      return { role, storageStatePath: account.storageStatePath };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Hosted authentication failed.";
      throw new Error(redactHostedAuthSecrets(message, this.sensitiveValues()));
    } finally {
      await page.close();
    }
  }

  async signInAll() {
    const results: Array<{ role: HostedAuthRole; storageStatePath: string }> = [];
    for (const role of HOSTED_AUTH_ROLES) results.push(await this.signIn(role));
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
      await runtime.context.clearCookies();
    } finally {
      await page.close();
    }
  }

  async cleanup(options: CleanupOptions = {}) {
    const signOut = options.signOut ?? true;
    const removeStorageStates = options.removeStorageStates ?? true;
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
    if (removeStorageStates) {
      await Promise.allSettled(
        HOSTED_AUTH_ROLES.map(role => rm(this.config.accounts[role].storageStatePath, { force: true })),
      );
    }
    if (failures.length > 0) {
      throw new Error(redactHostedAuthSecrets(failures.join(" "), this.sensitiveValues()));
    }
  }
}
