/**
 * Shared server-side helper: make an authenticated call to an internal service.
 * The INTERNAL_SERVICE_TOKEN is never sent to the browser.
 */
export async function callService(
  baseUrl: string,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  const url = new URL(normalizedPath, normalizedBaseUrl).toString();
  const body = init?.body;
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;

  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.INTERNAL_SERVICE_TOKEN}`,
      "x-internal-token": process.env.INTERNAL_SERVICE_TOKEN ?? "",
      ...(!isFormData ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
}
