import Link from "next/link";
import {
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  Copy,
  FileText,
  Layers3,
  MessagesSquare,
  Sparkles,
  Waves,
} from "lucide-react";

const highlights = [
  "Clone your voice, tone, and decision context",
  "Deploy multiple versions of yourself into parallel meetings",
  "Get live notes, action items, and escalations back in one stream",
];

const features = [
  {
    icon: Copy,
    title: "A clone of you",
    description:
      "Clairo learns how you speak, what matters to you, and how you want conversations handled so it can represent you naturally.",
  },
  {
    icon: Layers3,
    title: "Parallel meetings",
    description:
      "Send multiple Clairos into different meetings at the same time and keep your presence active across the whole day.",
  },
  {
    icon: FileText,
    title: "Everything comes back organized",
    description:
      "Every session returns transcripts, summaries, decisions, and next steps so you stay informed without attending every call.",
  },
];

const particles = Array.from({ length: 24 }, (_, index) => ({
  id: index,
  left: `${(index * 17) % 100}%`,
  top: `${(index * 29) % 100}%`,
  delay: `${(index % 8) * 0.8}s`,
  duration: `${12 + (index % 7) * 2}s`,
}));

interface LandingPageProps {
  isAuthenticated?: boolean;
}

export default function LandingPage({
  isAuthenticated = false,
}: LandingPageProps) {
  const primaryHref = isAuthenticated ? "/dashboard" : "/login";

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#080e1c] text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(109,216,240,0.13),transparent_24%),radial-gradient(circle_at_80%_16%,rgba(155,127,212,0.16),transparent_24%),radial-gradient(circle_at_50%_50%,rgba(59,130,246,0.08),transparent_40%),linear-gradient(180deg,rgba(8,14,28,0.42)_0%,rgba(8,14,28,0.86)_58%,#080e1c_100%)]" />
        <div className="absolute left-1/2 top-24 h-[42rem] w-[42rem] -translate-x-1/2 rounded-full bg-[#7442C8]/18 blur-3xl orb-float" />
        <div className="absolute left-[8%] top-[18%] h-72 w-72 rounded-full bg-[#6DD8F0]/12 blur-3xl mesh-drift" />
        <div className="absolute right-[6%] top-[24%] h-80 w-80 rounded-full bg-[#3B82F6]/10 blur-3xl mesh-drift-reverse" />
        <div className="absolute left-[16%] bottom-[14%] h-48 w-48 rounded-full border border-white/6 bg-white/[0.03] blur-2xl slow-spin" />
        <div className="absolute right-[14%] bottom-[10%] h-56 w-56 rounded-full border border-[#6DD8F0]/10 bg-[#6DD8F0]/6 blur-2xl reverse-spin" />
        <div className="absolute inset-0 opacity-[0.14] [background-image:linear-gradient(rgba(109,216,240,0.18)_1px,transparent_1px),linear-gradient(90deg,rgba(109,216,240,0.12)_1px,transparent_1px)] [background-size:84px_84px]" />
        <div className="absolute inset-0 opacity-[0.24] [mask-image:radial-gradient(circle_at_center,black,transparent_72%)] bg-[linear-gradient(135deg,rgba(255,255,255,0.08),transparent_30%,transparent_70%,rgba(255,255,255,0.06))]" />

        <div className="absolute inset-0">
          {particles.map((particle) => (
            <span
              key={particle.id}
              className="particle-dot absolute h-1.5 w-1.5 rounded-full bg-[#aeefff]/70 shadow-[0_0_14px_rgba(109,216,240,0.5)]"
              style={{
                left: particle.left,
                top: particle.top,
                animationDelay: particle.delay,
                animationDuration: particle.duration,
              }}
            />
          ))}
        </div>
      </div>

      <section className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 pb-16 pt-6 sm:px-8 lg:px-10">
        <header className="reveal flex items-center justify-between rounded-full border border-white/10 bg-white/[0.05] px-4 py-3 shadow-[0_10px_40px_rgba(0,0,0,0.22)] backdrop-blur-xl sm:px-6">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-white/90">
              Clairo
            </p>
            <p className="text-xs text-slate-400">
              Clairo is there for you, when you&apos;re not
            </p>
          </div>

          <Link
            href={primaryHref}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#3B82F6] via-[#7442C8] to-[#6DD8F0] px-4 py-2 text-sm font-semibold text-white shadow-[0_14px_40px_rgba(59,130,246,0.34)] transition duration-300 hover:scale-[1.02] hover:shadow-[0_18px_48px_rgba(109,216,240,0.28)]"
          >
            Get started with Clairo
            <ArrowRight className="h-4 w-4" />
          </Link>
        </header>

        <div className="grid flex-1 items-center gap-16 py-12 lg:grid-cols-[0.94fr_1.06fr] lg:py-18">
          <div className="relative space-y-10">
            <div className="space-y-7">

              <div className="space-y-6">
                <h1 className="reveal max-w-4xl text-5xl font-semibold leading-[0.96] tracking-[-0.06em] text-white sm:text-6xl lg:text-[6.3rem]">
                  A living AI
                  <span className="block bg-gradient-to-r from-white via-[#B8F3FF] to-[#CAB8F5] bg-clip-text text-transparent">
                    clone of you.
                  </span>
                </h1>
                <p className="reveal max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl">
                  Clairo studies your voice, your goals, your documents, and your meeting style so it can join calls as you, respond with your context, and keep your presence moving even when your calendar is overloaded.
                </p>
              </div>
            </div>

            <div className="reveal flex flex-col gap-4 sm:flex-row">
              <Link
                href={primaryHref}
                className="inline-flex items-center justify-center gap-2 rounded-[1.35rem] bg-gradient-to-r from-[#3B82F6] via-[#7442C8] to-[#6DD8F0] px-7 py-4 text-base font-semibold text-white shadow-[0_24px_60px_rgba(59,130,246,0.3)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_30px_70px_rgba(109,216,240,0.3)]"
              >
                Get started with Clairo
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {highlights.map((item, index) => (
                <div
                  key={item}
                  className="reveal rounded-[1.5rem] border border-white/10 bg-white/[0.045] px-4 py-5 backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:border-[#6DD8F0]/25"
                  style={{ animationDelay: `${index * 120}ms` }}
                >
                  <CheckCircle2 className="mb-3 h-5 w-5 text-[#6DD8F0]" />
                  <p className="text-sm leading-6 text-slate-200">{item}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="reveal relative min-h-[46rem] xl:min-h-[48rem]">
            <div className="absolute inset-x-0 bottom-0 top-8 rounded-[2.2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(13,22,40,0.92),rgba(8,14,28,0.98))] p-6 xl:p-7 shadow-[0_30px_90px_rgba(0,0,0,0.46)] backdrop-blur-2xl">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#6DD8F0]/60 to-transparent" />

              <div className="grid gap-5 xl:gap-6 lg:grid-cols-[1.04fr_0.96fr]">
                <div className="rounded-[1.6rem] border border-white/8 bg-[#0d1628]/88 p-4 xl:p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <p className="text-sm font-semibold text-white">Live clone transcript</p>
                    <span className="text-xs text-slate-500">Speaking with your context</span>
                  </div>

                  <div className="space-y-3">
                    {[
                      {
                        speaker: "Client",
                        text: "Can you confirm the launch constraints and explain how your team wants to phase the rollout?",
                      },
                      {
                        speaker: "Clairo",
                        text: "Yes. We want a phased launch with the voice workflow first, live summaries second, and broader multi-meeting deployment after stakeholder review.",
                      },
                      {
                        speaker: "Clairo",
                        text: "I’ve already flagged two decisions for follow-up and pushed them into your action queue so nothing gets lost after the call.",
                      },
                    ].map((item, index) => (
                      <div
                        key={`${item.speaker}-${index}`}
                        className="panel-rise rounded-[1.35rem] border border-white/8 bg-white/[0.035] px-4 py-3"
                        style={{ animationDelay: `${160 + index * 130}ms` }}
                      >
                        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#A4F2FF]">
                          {item.speaker}
                        </p>
                        <p className="text-sm leading-6 text-slate-300">{item.text}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-4 xl:space-y-5">
                  <div className="rounded-[1.6rem] border border-white/8 bg-white/[0.04] p-4 xl:p-5 shimmer-panel">
                    <div className="mb-3 flex items-center gap-2">
                      <BrainCircuit className="h-4 w-4 text-[#6DD8F0]" />
                      <p className="text-sm font-semibold text-white">Identity model</p>
                    </div>
                    <p className="text-sm leading-6 text-slate-300">
                      Your clone profile combines voice, documents, preferences, objectives, and response style into one deployable identity.
                    </p>
                  </div>

                  <div className="rounded-[1.6rem] border border-white/8 bg-white/[0.04] p-4 xl:p-5 shimmer-panel">
                    <div className="mb-3 flex items-center gap-2">
                      <MessagesSquare className="h-4 w-4 text-[#C8B6F7]" />
                      <p className="text-sm font-semibold text-white">Parallel presence</p>
                    </div>
                    <p className="text-sm leading-6 text-slate-300">
                      Multiple Clairos can speak for you across different meetings while keeping the same tone, priorities, and boundaries.
                    </p>
                  </div>

                  <div className="rounded-[1.6rem] border border-white/8 bg-white/[0.04] p-4 xl:p-5 shimmer-panel">
                    <div className="mb-3 flex items-center gap-2">
                      <Waves className="h-4 w-4 text-[#6DD8F0]" />
                      <p className="text-sm font-semibold text-white">What returns to you</p>
                    </div>
                    <p className="text-sm leading-6 text-slate-300">
                      Every Clairo sends back notes, summaries, decisions, and action items so your day compresses into one clear stream.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <section className="grid gap-5 md:grid-cols-3">
          {features.map(({ icon: Icon, title, description }, index) => (
            <article
              key={title}
              className="reveal rounded-[1.8rem] border border-white/10 bg-white/[0.05] p-6 shadow-[0_18px_40px_rgba(0,0,0,0.16)] backdrop-blur-xl transition duration-300 hover:-translate-y-1.5 hover:border-[#6DD8F0]/26 hover:bg-white/[0.07]"
              style={{ animationDelay: `${index * 120}ms` }}
            >
              <div className="mb-4 inline-flex rounded-[1.1rem] border border-white/10 bg-gradient-to-br from-[#6DD8F0]/14 to-[#7442C8]/16 p-3">
                <Icon className="h-5 w-5 text-[#B8F3FF]" />
              </div>
              <h2 className="mb-3 text-xl font-semibold text-white">{title}</h2>
              <p className="text-sm leading-7 text-slate-300">{description}</p>
            </article>
          ))}
        </section>
      </section>
    </main>
  );
}
