import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { currentViewer, sessionToken } from "@/lib/session";

export const metadata: Metadata = { title: "Waiting list · Admin", robots: { index: false, follow: false } };

interface Entry { id: string; name: string; email: string; createdAt: string }

async function AdminContents({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const pageValue = (await searchParams).page;
  const page = pageValue && /^\d+$/.test(pageValue) ? Math.min(Number(pageValue), 100000) : 0;
  const viewer = await currentViewer();
  if (!viewer?.isAdmin) {
    return <div className="mx-auto max-w-md px-5 py-24 text-center">
      <h1 className="font-display text-5xl">Waiting list</h1>
      <p className="mt-4 text-content-muted">{viewer ? "This account does not have admin access." : "Sign in with an operator number to view subscribers."}</p>
      {!viewer && <Link className="mt-8 inline-block border-b border-content" href="/signin?next=/coming-soon/admin">Admin sign in</Link>}
    </div>;
  }

  let entries: Entry[] | null = null;
  let hasMore = false;
  try {
    const response = await fetch(`${process.env.API_URL?.replace(/\/+$/, "")}/admin/waitlist?page=${page}`, {
      headers: { authorization: `Bearer ${await sessionToken()}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) {
      const result = await response.json() as { entries: Entry[]; hasMore: boolean };
      entries = result.entries;
      hasMore = result.hasMore;
    }
  } catch { /* Show a retryable error instead of disclosing server details. */ }

  return <div className="mx-auto max-w-5xl px-5 py-16">
    <p className="text-xs uppercase tracking-[0.2em] text-accent-ink">Siumora admin</p>
    <h1 className="mt-3 font-display text-5xl">Waiting list</h1>
    <p className="mt-3 text-sm text-content-muted">{entries ? `Showing ${entries.length} subscribers on page ${page + 1}` : "Unable to load subscribers. Refresh to try again."}</p>
    {entries && <div className="mt-8 overflow-x-auto border border-[var(--color-rule)]">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="bg-ground-raised/40 text-xs uppercase tracking-widest"><tr><th className="p-4">Name</th><th className="p-4">Email</th><th className="p-4">Joined</th></tr></thead>
        <tbody>{entries.map((entry) => <tr key={entry.id} className="border-t border-[var(--color-rule)]">
          <td className="p-4">{entry.name}</td><td className="p-4">{entry.email}</td>
          <td className="p-4">{new Date(entry.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}</td>
        </tr>)}</tbody>
      </table>
      {entries.length === 0 && <p className="p-6 text-content-muted">No one has joined yet.</p>}
    </div>}
    {entries && <nav aria-label="Waiting list pages" className="mt-6 flex gap-6 text-sm">
      {page > 0 && <Link className="border-b border-content" href={`/coming-soon/admin?page=${page - 1}`}>Previous</Link>}
      {hasMore && <Link className="border-b border-content" href={`/coming-soon/admin?page=${page + 1}`}>Next</Link>}
    </nav>}
  </div>;
}

export default function WaitlistAdminPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  if (process.env.COMMERCE_BACKEND === "medusa") {
    const adminUrl = process.env.MEDUSA_ADMIN_URL ?? process.env.MEDUSA_URL;
    if (!adminUrl) throw new Error("MEDUSA_ADMIN_URL or MEDUSA_URL is required for the Medusa dashboard.");
    redirect(`${adminUrl.replace(/\/+$/, "")}/app/siumora/waitlist`);
  }
  return <Suspense fallback={<div className="mx-auto max-w-5xl px-5 py-16">Loading waiting list…</div>}><AdminContents searchParams={searchParams} /></Suspense>;
}
