"use client";

import { useEffect, useState } from "react";

import { EyeIcon } from "./icons";

/** 色盲友好开关：切换 <html>.cb，把红涨绿跌重映射为橙涨蓝跌（localStorage 持久化）。 */
export function ColorblindToggle() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    setOn(document.documentElement.classList.contains("cb"));
  }, []);

  function toggle() {
    const next = !on;
    setOn(next);
    document.documentElement.classList.toggle("cb", next);
    try {
      localStorage.setItem("cb", next ? "1" : "0");
    } catch {
      // localStorage 不可用时忽略
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="色盲友好配色（橙涨蓝跌）"
      aria-pressed={on}
      className={`flex rounded-md p-2 transition-colors hover:text-brand ${
        on ? "text-brand" : "text-muted"
      }`}
    >
      <EyeIcon className="h-5 w-5" />
    </button>
  );
}
