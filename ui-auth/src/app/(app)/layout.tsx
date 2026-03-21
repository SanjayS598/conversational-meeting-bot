import Sidebar from "@/components/Sidebar";

// All pages under (app) require auth — never statically prerender them.
export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-[#0a0f1e]">{children}</main>
    </div>
  );
}
