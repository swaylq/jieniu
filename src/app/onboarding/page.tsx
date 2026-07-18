import { redirect } from "next/navigation";

import { api } from "~/trpc/server";
import { auth } from "~/server/auth";
import { OnboardingFlow } from "../_components/onboarding-flow";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?returnTo=/onboarding");

  // 已有关注的老用户不必再走引导，直接回首页。
  const watched = await api.watchlist.list();
  if (watched.length > 0) redirect("/");

  return (
    <main className="mx-auto max-w-lg p-4 pt-8">
      <OnboardingFlow />
    </main>
  );
}
