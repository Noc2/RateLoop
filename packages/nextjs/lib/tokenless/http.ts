export class HttpJsonError extends Error {
  code: string | null;
  status: number;

  constructor(message: string, { code = null, status }: { code?: string | null; status: number }) {
    super(message);
    this.name = "HttpJsonError";
    this.code = code;
    this.status = status;
  }
}

type ErrorField = "message" | "error";

export async function readJson<T = Record<string, unknown>>(
  response: Response,
  {
    errorFields = ["message", "error"],
    fallbackMessage = "Request failed.",
  }: { errorFields?: ErrorField[]; fallbackMessage?: string } = {},
): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (response.ok) return body as T;

  const details = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const message = errorFields.reduce<string | null>(
    (current, field) => current ?? (typeof details[field] === "string" ? details[field] : null),
    null,
  );
  throw new HttpJsonError(message ?? fallbackMessage, {
    code: typeof details.code === "string" ? details.code : null,
    status: response.status,
  });
}
