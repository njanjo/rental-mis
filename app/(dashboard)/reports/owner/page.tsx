import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function OwnerReportRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") qs.set(key, value);
  }
  const query = qs.toString();
  redirect(query ? `/analytics/owner?${query}` : "/analytics/owner");
}

