import Sidebar from "@/components/Sidebar";

// All pages under (app) require auth — never statically prerender them.
export const dynamic = "force-dynamic";

const dashboardParticles = Array.from({ length: 18 }, (_, index) => ({
  id: index,
  left: `${(index * 19) % 100}%`,
  top: `${(index * 23) % 100}%`,
  delay: `${(index % 6) * 1.1}s`,
  duration: `${16 + (index % 5) * 2.5}s`,
}));

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen overflow-hidden bg-[#080e1c]">
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
          {dashboardParticles.map((particle) => (
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

      <Sidebar />
      <main className="relative z-10 flex-1 overflow-auto bg-transparent">
        {children}
      </main>
    </div>
  );
}
