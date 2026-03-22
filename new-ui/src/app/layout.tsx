import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MeetBot — AI Meeting Assistant",
  description: "AI-powered meeting assistant powered by Gemini and ElevenLabs",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen bg-[#080e1c] text-slate-100">
        {children}
      </body>
    </html>
  );
}
