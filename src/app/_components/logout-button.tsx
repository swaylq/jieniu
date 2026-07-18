"use client";

import { signOut } from "next-auth/react";

export function LogoutButton() {
  return (
    <button
      type="button"
      onClick={() => void signOut({ callbackUrl: "/" })}
      className="rounded-full border border-line px-4 py-1.5 text-sm text-muted transition-colors hover:border-red-400 hover:text-red-600"
    >
      登出
    </button>
  );
}
