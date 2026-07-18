/** 解牛 品牌徽标（琥珀金牛头 · 近黑瓦片）+ 字标。全 App 统一，勿再用 emoji。 */
export function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      className={className}
      role="img"
      aria-label="解牛"
    >
      <rect width="512" height="512" rx="128" fill="#0b0d12" />
      <g
        fill="none"
        stroke="#f5a623"
        strokeWidth={46}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M210 214 C 158 208 126 182 128 142 C 129 126 134 112 144 104" />
        <path d="M302 214 C 354 208 386 182 384 142 C 383 126 378 112 368 104" />
      </g>
      <path
        fill="#f5a623"
        d="M190 212 C 218 202 294 202 322 212 C 330 262 324 324 305 360 C 291 388 276 404 256 404 C 236 404 221 388 207 360 C 188 324 182 262 190 212 Z"
      />
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <LogoMark className="h-7 w-7" />
      <span className="text-lg font-extrabold tracking-tight text-ink">
        解牛
      </span>
    </span>
  );
}
