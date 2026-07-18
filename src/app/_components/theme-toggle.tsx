"use client";

import { useEffect, useState } from "react";

import { MoonIcon, SunIcon } from "./icons";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // localStorage 不可用时忽略
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="切换深色 / 浅色"
      className="flex rounded-md p-2 text-muted transition-colors hover:text-brand"
    >
      {dark ? <SunIcon className="h-5 w-5" /> : <MoonIcon className="h-5 w-5" />}
    </button>
  );
}
