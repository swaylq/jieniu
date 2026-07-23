import Link from "next/link";

/**
 * 服务端分页条（纯链接，无 JS）。个股页「资讯 / 公告」用。
 *
 * 只给上一页 / 下一页 + 页码位置，不铺一排页码：回填一年后动辄 9 页，
 * 铺出来是一行数字噪声，而真实用法就是往前翻几页或直接看「大事记」。
 */
export function Pager({
  basePath,
  params,
  page,
  pages,
  total,
  unit = "条",
}: {
  /** 不含 query 的路径，如 `/entity/xxx` */
  basePath: string;
  /** 需要保留的其它 query（如 tab） */
  params: Record<string, string>;
  page: number;
  pages: number;
  total: number;
  unit?: string;
}) {
  if (pages <= 1) return null;
  const href = (p: number) => {
    const q = new URLSearchParams({ ...params, page: String(p) });
    return `${basePath}?${q.toString()}`;
  };
  const linkCls =
    "rounded-lg border border-line px-3 py-1.5 text-sm text-muted transition-colors hover:border-brand hover:text-brand";
  const deadCls =
    "rounded-lg border border-line/60 px-3 py-1.5 text-sm text-faint";

  return (
    <nav
      className="mt-4 flex items-center justify-between gap-3"
      aria-label="分页"
    >
      {page > 1 ? (
        <Link href={href(page - 1)} className={linkCls} rel="prev">
          ← 上一页
        </Link>
      ) : (
        <span className={deadCls}>← 上一页</span>
      )}
      <span className="tabular text-xs text-muted">
        第 {page} / {pages} 页 · 共 {total} {unit}
      </span>
      {page < pages ? (
        <Link href={href(page + 1)} className={linkCls} rel="next">
          下一页 →
        </Link>
      ) : (
        <span className={deadCls}>下一页 →</span>
      )}
    </nav>
  );
}
