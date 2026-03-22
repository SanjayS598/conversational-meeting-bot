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
  return fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.INTERNAL_SERVICE_TOKEN}`,
      "x-internal-token": process.env.INTERNAL_SERVICE_TOKEN ?? "",
      ...(init?.headers ?? {}),
    },
  });
}
