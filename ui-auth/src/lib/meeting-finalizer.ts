import { callService } from "@/lib/service-client";

const GEMINI_SERVICE_URL = process.env.GEMINI_SERVICE_URL ?? "http://localhost:3002";

export async function finalizeMeetingSummary(sessionId: string): Promise<void> {
  const response = await callService(
    GEMINI_SERVICE_URL,
    `/brain/sessions/${sessionId}/summary`,
    { method: "POST" }
  );

  if (!response.ok && response.status !== 404) {
    const body = await response.text();
    throw new Error(body || `Summary generation failed with ${response.status}`);
  }
}