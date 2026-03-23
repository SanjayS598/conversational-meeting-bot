/**
 * Shared server-side helper: make an authenticated call to an internal service.
 * The INTERNAL_SERVICE_TOKEN is never sent to the browser.
 */
export async function callService(
  baseUrl: string,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const url = `${baseUrl}${path}`;
  const headers = new Headers(init?.headers ?? {});

  if (!headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${process.env.INTERNAL_SERVICE_TOKEN}`);
  }
  if (!headers.has("x-internal-token")) {
    headers.set("x-internal-token", process.env.INTERNAL_SERVICE_TOKEN ?? "");
  }

  const body = init?.body;
  if (!(body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(url, {
    ...init,
    headers,
  });
}
