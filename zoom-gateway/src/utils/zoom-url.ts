export interface ParsedZoomUrl {
  meetingId: string;
  /** The `pwd` query-param hash from the URL (not the numeric passcode). */
  pwdHash?: string;
  /** Ready-to-navigate web-client join URL. */
  webClientUrl: string;
}

/**
 * Parses any standard Zoom meeting URL and returns the components needed to
 * join via the Zoom web client.
 *
 * Supported input formats:
 *   https://zoom.us/j/12345678901
 *   https://zoom.us/j/12345678901?pwd=abcXYZ
 *   https://us06web.zoom.us/j/12345678901?pwd=abcXYZ
 */
export function parseZoomUrl(meetingUrl: string): ParsedZoomUrl {
  let url: URL;
  try {
    url = new URL(meetingUrl);
  } catch {
    throw new Error(`Invalid meeting URL: "${meetingUrl}"`);
  }

  if (!url.hostname.endsWith('zoom.us')) {
    throw new Error(`Not a Zoom URL: "${meetingUrl}"`);
  }

  // Path is /j/<meetingId> or /s/<meetingId>
  const pathMatch = url.pathname.match(/\/[js]\/(\d+)/);
  if (!pathMatch) {
    throw new Error(`Could not extract meeting ID from URL: "${meetingUrl}"`);
  }

  const meetingId = pathMatch[1];
  const pwdHash = url.searchParams.get('pwd') ?? undefined;

  const params = new URLSearchParams({ prefer: '1' });
  if (pwdHash) params.set('pwd', pwdHash);

  return {
    meetingId,
    pwdHash,
    webClientUrl: `https://zoom.us/wc/${meetingId}/join?${params.toString()}`,
  };
}
