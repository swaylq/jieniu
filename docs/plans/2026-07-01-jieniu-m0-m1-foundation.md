# 解牛 地基（M0+M1）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭起 T3 项目、连上 Postgres、建立实体图谱数据模型并 seed 半导体种子数据，做出可浏览的实体页，部署到 `jieniu.swaylab.ai`。

**Architecture:** create-t3-app（Next.js App Router + TS + Tailwind + tRPC + Prisma + NextAuth）单体应用；实体图谱用 `Entity` + `EntityRelation` 两张表建模，关系分组逻辑抽成纯函数便于测试；实体页是 RSC，通过 tRPC server caller 取数；用 Vitest 做单元/路由测试。

**Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind, tRPC v11, Prisma, PostgreSQL, NextAuth, Vitest, PWA。

**前置条件（执行前确认）:**
- Node ≥ 20（`node -v`）
- Docker 已装并在运行（本地 Postgres 用；`docker ps`）
- 工作目录：`/Users/mac/claudeclaw/finance-agent/projects/jieniu`（已有 `.git` 和 `docs/`）
- 相关 skill：`web-scaffold`（脚手架）、`installable-pwa`（PWA）、`expose-tunnel`（部署）
- 参考：`docs/specs/2026-07-01-jieniu-mvp-design.md`、`docs/reference/data-sources.md`

**不在本计划内（后续计划）:** 数据抓取、账号登录、关注/feed、AI 解读。本计划的 Prisma schema 只建 `Entity`/`EntityRelation`，其余表在对应里程碑再加 migration。

---

## File Structure

- `projects/jieniu/` — T3 app 根目录（与既有 `docs/` 并存）
- `prisma/schema.prisma` — 数据模型（本计划只含 Entity/EntityRelation）
- `prisma/seed.ts` — 半导体种子数据
- `src/lib/format.ts` — 实体类型中文标签（纯函数）
- `src/lib/entity-graph.ts` — 关系分组逻辑（纯函数，可测）
- `src/server/api/routers/entity.ts` — 实体 tRPC 路由
- `src/server/api/root.ts` — 注册路由（修改）
- `src/app/page.tsx` — 首页（列板块）
- `src/app/entity/[id]/page.tsx` — 实体页
- `public/manifest.webmanifest` — PWA manifest
- `vitest.config.ts` — 测试配置
- 测试与实现同目录：`src/lib/*.test.ts`、`src/server/api/routers/entity.test.ts`

---

## Task 1: 脚手架 T3 应用

**Files:**
- Create: 整个 T3 项目落到 `projects/jieniu/`

- [ ] **Step 1: 在临时目录生成 T3 项目**（避免 `create-t3-app` 拒绝非空目录）

Run（在 `projects/` 下）:
```bash
cd /Users/mac/claudeclaw/finance-agent/projects
npm create t3-app@latest jieniu-scaffold -- \
  --CI --appRouter --trpc --tailwind --prisma --nextAuth --dbProvider postgres
```
交互式版本则选择：TypeScript、Tailwind、tRPC、Prisma、NextAuth、App Router、PostgreSQL、包管理器 npm。
Expected: `jieniu-scaffold/` 生成，含 `src/`、`prisma/`、`package.json`。

- [ ] **Step 2: 把脚手架内容并入既有 jieniu 仓库（保留 docs 和 git 历史）**

Run:
```bash
rsync -a --exclude '.git' /Users/mac/claudeclaw/finance-agent/projects/jieniu-scaffold/ \
  /Users/mac/claudeclaw/finance-agent/projects/jieniu/
rm -rf /Users/mac/claudeclaw/finance-agent/projects/jieniu-scaffold
cd /Users/mac/claudeclaw/finance-agent/projects/jieniu
```
Expected: `projects/jieniu/` 同时有 `src/`、`prisma/`、`docs/`、`.git`。

- [ ] **Step 3: 安装依赖并验证能起**

Run:
```bash
npm install
npm run dev
```
Expected: dev server 起在 `http://localhost:3000`（Ctrl-C 停掉再继续）。

- [ ] **Step 4: 提交脚手架**

```bash
git add -A
git commit -m "feat: scaffold T3 app (Next.js + tRPC + Prisma + NextAuth)"
```

---

## Task 2: 本地 Postgres 与数据库连接

**Files:**
- Modify: `.env`

- [ ] **Step 1: 起本地 Postgres**

T3 生成了 `start-database.sh`（Docker）。Run:
```bash
./start-database.sh
```
若脚本提示生成随机密码，允许它改写 `.env` 的 `DATABASE_URL`。
Expected: 一个名为 `jieniu-postgres`（或类似）的容器在跑（`docker ps` 可见）。

- [ ] **Step 2: 确认 `.env` 的 DATABASE_URL 指向本地库**

`.env` 中应有形如：
```
DATABASE_URL="postgresql://postgres:PASSWORD@localhost:5432/jieniu"
```
Expected: 端口 5432、库名 `jieniu`。

- [ ] **Step 3: 验证连接**

Run:
```bash
npx prisma db push --skip-generate
```
Expected: `The database is already in sync` 或成功创建（此时 schema 还是 T3 默认，下一步替换）。若报连接错误，回到 Step 1 检查容器。

- [ ] **Step 4: 提交**

```bash
git add .env.example
git commit -m "chore: local postgres via docker"
```
（注意：`.env` 已在 `.gitignore`，不提交真实连接串。）

---

## Task 3: 实体图谱数据模型

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: 用实体图谱模型替换默认 schema 的 model 部分**

保留文件顶部的 `generator client` 和 `datasource db` 块，把示例 model（如 `Post`）替换为：
```prisma
model Entity {
  id        String   @id @default(cuid())
  type      EntityType
  name      String
  shortName String?
  aliases   String[]
  ticker    String?
  exchange  String?
  meta      Json?
  createdAt DateTime @default(now())
  relFrom   EntityRelation[] @relation("from")
  relTo     EntityRelation[] @relation("to")

  @@index([type])
}

model EntityRelation {
  id     String       @id @default(cuid())
  fromId String
  toId   String
  type   RelationType
  from   Entity       @relation("from", fields: [fromId], references: [id], onDelete: Cascade)
  to     Entity       @relation("to",   fields: [toId],   references: [id], onDelete: Cascade)

  @@unique([fromId, toId, type])
  @@index([toId])
}

enum EntityType   { SECTOR COMPANY STOCK PERSON }
enum RelationType { BELONGS_TO ISSUES WORKS_AT RELATED }
```
若 NextAuth 生成了 `User`/`Account`/`Session`/`VerificationToken` model，**保留它们**（登录里程碑要用）。

- [ ] **Step 2: 生成 migration 并应用**

Run:
```bash
npx prisma migrate dev --name entity-graph
```
Expected: 新建 `prisma/migrations/*_entity-graph/`，输出 `Your database is now in sync`，并自动 `prisma generate`。

- [ ] **Step 3: 验证 client 类型已生成**

Run:
```bash
node -e "const{EntityType}=require('@prisma/client');console.log(Object.keys(EntityType))"
```
Expected: 打印 `[ 'SECTOR', 'COMPANY', 'STOCK', 'PERSON' ]`。

- [ ] **Step 4: 提交**

```bash
git add prisma/
git commit -m "feat: entity graph schema (Entity + EntityRelation)"
```

---

## Task 4: 测试脚手架与实体类型标签

**Files:**
- Create: `vitest.config.ts`
- Create: `src/lib/format.ts`
- Test: `src/lib/format.test.ts`

- [ ] **Step 1: 安装 Vitest 并加脚本**

Run:
```bash
npm install -D vitest @vitejs/plugin-react vite-tsconfig-paths
```
在 `package.json` 的 `scripts` 加：
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 2: 写 vitest 配置**

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
```

- [ ] **Step 3: 写失败测试**

`src/lib/format.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { entityTypeLabel } from "./format";

describe("entityTypeLabel", () => {
  it("maps entity types to Chinese labels", () => {
    expect(entityTypeLabel("SECTOR")).toBe("板块");
    expect(entityTypeLabel("COMPANY")).toBe("公司");
    expect(entityTypeLabel("STOCK")).toBe("股票");
    expect(entityTypeLabel("PERSON")).toBe("人物");
  });
});
```

- [ ] **Step 4: 跑测试确认失败**

Run: `npm test`
Expected: FAIL —— `Cannot find module './format'`。

- [ ] **Step 5: 实现**

`src/lib/format.ts`:
```ts
import type { EntityType } from "@prisma/client";

export const ENTITY_TYPE_LABEL: Record<EntityType, string> = {
  SECTOR: "板块",
  COMPANY: "公司",
  STOCK: "股票",
  PERSON: "人物",
};

export function entityTypeLabel(type: EntityType): string {
  return ENTITY_TYPE_LABEL[type];
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npm test`
Expected: PASS（1 passed）。

- [ ] **Step 7: 提交**

```bash
git add vitest.config.ts src/lib/format.ts src/lib/format.test.ts package.json package-lock.json
git commit -m "test: vitest harness + entityTypeLabel"
```

---

## Task 5: 关系分组逻辑（纯函数）

**Files:**
- Create: `src/lib/entity-graph.ts`
- Test: `src/lib/entity-graph.test.ts`

- [ ] **Step 1: 写失败测试**

`src/lib/entity-graph.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { bucketOf, groupRelations, type GraphRelation } from "./entity-graph";

describe("bucketOf", () => {
  it("maps type+direction to a bucket", () => {
    expect(bucketOf("BELONGS_TO", "out")).toBe("sector");
    expect(bucketOf("BELONGS_TO", "in")).toBe("members");
    expect(bucketOf("ISSUES", "out")).toBe("stocks");
    expect(bucketOf("ISSUES", "in")).toBe("issuer");
    expect(bucketOf("WORKS_AT", "out")).toBe("worksAt");
    expect(bucketOf("WORKS_AT", "in")).toBe("people");
    expect(bucketOf("RELATED", "out")).toBe("related");
  });
});

describe("groupRelations", () => {
  it("buckets each relation and keeps empty buckets as []", () => {
    const rels: GraphRelation[] = [
      { type: "BELONGS_TO", direction: "out", entity: { id: "s1", name: "半导体", type: "SECTOR" } },
      { type: "ISSUES", direction: "out", entity: { id: "k1", name: "中芯国际(688981)", type: "STOCK" } },
    ];
    const g = groupRelations(rels);
    expect(g.sector).toEqual([{ id: "s1", name: "半导体", type: "SECTOR" }]);
    expect(g.stocks.map((e) => e.id)).toEqual(["k1"]);
    expect(g.people).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test src/lib/entity-graph.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

`src/lib/entity-graph.ts`:
```ts
import type { EntityType, RelationType } from "@prisma/client";

export type RelatedEntity = { id: string; name: string; type: EntityType };
export type Direction = "out" | "in";
export type GraphRelation = { type: RelationType; direction: Direction; entity: RelatedEntity };

export type RelationBucket =
  | "sector" | "members" | "stocks" | "issuer" | "worksAt" | "people" | "related";

export const BUCKET_LABEL: Record<RelationBucket, string> = {
  sector: "所属板块",
  members: "板块成分",
  stocks: "股票",
  issuer: "发行公司",
  worksAt: "任职于",
  people: "相关人物",
  related: "相关",
};

export function bucketOf(type: RelationType, dir: Direction): RelationBucket {
  switch (type) {
    case "BELONGS_TO": return dir === "out" ? "sector" : "members";
    case "ISSUES":     return dir === "out" ? "stocks" : "issuer";
    case "WORKS_AT":   return dir === "out" ? "worksAt" : "people";
    case "RELATED":    return "related";
  }
}

export function groupRelations(rels: GraphRelation[]): Record<RelationBucket, RelatedEntity[]> {
  const groups: Record<RelationBucket, RelatedEntity[]> = {
    sector: [], members: [], stocks: [], issuer: [], worksAt: [], people: [], related: [],
  };
  for (const r of rels) groups[bucketOf(r.type, r.direction)].push(r.entity);
  return groups;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test src/lib/entity-graph.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/lib/entity-graph.ts src/lib/entity-graph.test.ts
git commit -m "feat: entity relation grouping logic"
```

---

## Task 6: 实体 tRPC 路由

**Files:**
- Create: `src/server/api/routers/entity.ts`
- Modify: `src/server/api/root.ts`
- Test: `src/server/api/routers/entity.test.ts`

- [ ] **Step 1: 写失败测试（mock 掉 db，不依赖真实数据库）**

`src/server/api/routers/entity.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { entityRouter } from "./entity";

function caller(db: unknown) {
  return entityRouter.createCaller({ db, session: null, headers: new Headers() } as never);
}

describe("entityRouter.getById", () => {
  it("returns null when not found", async () => {
    const db = { entity: { findUnique: vi.fn().mockResolvedValue(null) } };
    expect(await caller(db).getById({ id: "nope" })).toBeNull();
  });

  it("groups relations by direction and type", async () => {
    const db = {
      entity: {
        findUnique: vi.fn().mockResolvedValue({
          id: "c1", name: "中芯国际", type: "COMPANY", ticker: null, exchange: null,
          relFrom: [{ type: "BELONGS_TO", to: { id: "s1", name: "半导体", type: "SECTOR" } }],
          relTo: [{ type: "WORKS_AT", from: { id: "p1", name: "赵海军", type: "PERSON" } }],
        }),
      },
    };
    const res = await caller(db).getById({ id: "c1" });
    expect(res?.groups.sector).toEqual([{ id: "s1", name: "半导体", type: "SECTOR" }]);
    expect(res?.groups.people).toEqual([{ id: "p1", name: "赵海军", type: "PERSON" }]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test src/server/api/routers/entity.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现路由**

`src/server/api/routers/entity.ts`:
```ts
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { groupRelations, type GraphRelation } from "~/lib/entity-graph";

export const entityRouter = createTRPCRouter({
  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const entity = await ctx.db.entity.findUnique({
        where: { id: input.id },
        include: {
          relFrom: { include: { to: true } },
          relTo: { include: { from: true } },
        },
      });
      if (!entity) return null;

      const rels: GraphRelation[] = [
        ...entity.relFrom.map((r) => ({
          type: r.type, direction: "out" as const,
          entity: { id: r.to.id, name: r.to.name, type: r.to.type },
        })),
        ...entity.relTo.map((r) => ({
          type: r.type, direction: "in" as const,
          entity: { id: r.from.id, name: r.from.name, type: r.from.type },
        })),
      ];
      return { entity, groups: groupRelations(rels) };
    }),

  listByType: publicProcedure
    .input(z.object({ type: z.enum(["SECTOR", "COMPANY", "STOCK", "PERSON"]) }))
    .query(({ ctx, input }) =>
      ctx.db.entity.findMany({ where: { type: input.type }, orderBy: { name: "asc" } }),
    ),
});
```

- [ ] **Step 4: 注册到根路由**

`src/server/api/root.ts` —— import 并加进 `createTRPCRouter({ ... })`：
```ts
import { entityRouter } from "~/server/api/routers/entity";
// ...
export const appRouter = createTRPCRouter({
  entity: entityRouter,
  // ...保留脚手架已有的其它路由
});
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm test src/server/api/routers/entity.test.ts`
Expected: PASS（2 passed）。

- [ ] **Step 6: 提交**

```bash
git add src/server/api/routers/entity.ts src/server/api/root.ts src/server/api/routers/entity.test.ts
git commit -m "feat: entity tRPC router (getById + listByType)"
```

---

## Task 7: Seed 半导体种子数据

**Files:**
- Create: `prisma/seed.ts`
- Modify: `package.json`（prisma.seed 配置）

- [ ] **Step 1: 装 tsx（跑 TS seed 用）**

Run: `npm install -D tsx`

- [ ] **Step 2: 加 prisma seed 配置**

`package.json` 顶层加：
```json
"prisma": { "seed": "tsx prisma/seed.ts" }
```

- [ ] **Step 3: 写 seed 脚本**

`prisma/seed.ts`:
```ts
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const COMPANIES = [
  { name: "中芯国际", ticker: "688981", exchange: "SH" },
  { name: "韦尔股份", ticker: "603501", exchange: "SH" },
  { name: "北方华创", ticker: "002371", exchange: "SZ" },
  { name: "中微公司", ticker: "688012", exchange: "SH" },
  { name: "澜起科技", ticker: "688008", exchange: "SH" },
  { name: "兆易创新", ticker: "603986", exchange: "SH" },
  { name: "卓胜微", ticker: "300782", exchange: "SZ" },
  { name: "沪硅产业", ticker: "688126", exchange: "SH" },
];

async function main() {
  // 幂等：清空后重建（cascade 会带走关系）
  await db.entityRelation.deleteMany();
  await db.entity.deleteMany();

  const sector = await db.entity.create({
    data: { type: "SECTOR", name: "半导体", shortName: "半导体", aliases: ["芯片", "集成电路", "IC"] },
  });

  const companyByName: Record<string, string> = {};
  for (const c of COMPANIES) {
    const company = await db.entity.create({
      data: { type: "COMPANY", name: c.name, shortName: c.name },
    });
    companyByName[c.name] = company.id;
    const stock = await db.entity.create({
      data: { type: "STOCK", name: `${c.name}(${c.ticker})`, ticker: c.ticker, exchange: c.exchange },
    });
    await db.entityRelation.createMany({
      data: [
        { fromId: company.id, toId: sector.id, type: "BELONGS_TO" },
        { fromId: company.id, toId: stock.id, type: "ISSUES" },
      ],
    });
  }

  // 示范人物（执行时可核对姓名/职务；结构对即可）
  const smicId = companyByName["中芯国际"];
  if (smicId) {
    const person = await db.entity.create({
      data: { type: "PERSON", name: "赵海军", meta: { title: "联席CEO" } },
    });
    await db.entityRelation.create({
      data: { fromId: person.id, toId: smicId, type: "WORKS_AT" },
    });
  }

  // 一条产业链关联示范
  const nmc = companyByName["北方华创"];
  const smic = companyByName["中芯国际"];
  if (nmc && smic) {
    await db.entityRelation.create({ data: { fromId: nmc, toId: smic, type: "RELATED" } });
  }

  const count = await db.entity.count();
  console.log(`Seeded ${count} entities.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => void db.$disconnect());
```

- [ ] **Step 4: 跑 seed**

Run: `npx prisma db seed`
Expected: 输出 `Seeded 18 entities.`（1 板块 + 8 公司 + 8 股票 + 1 人物）。

- [ ] **Step 5: 验证数据落库**

Run:
```bash
node -e "const{PrismaClient}=require('@prisma/client');const d=new PrismaClient();d.entity.count({where:{type:'STOCK'}}).then(n=>{console.log('stocks:',n);return d.\$disconnect()})"
```
Expected: `stocks: 8`。

- [ ] **Step 6: 提交**

```bash
git add prisma/seed.ts package.json package-lock.json
git commit -m "feat: seed semiconductor entity graph"
```

---

## Task 8: 首页与实体页

**Files:**
- Modify: `src/app/page.tsx`
- Create: `src/app/entity/[id]/page.tsx`

- [ ] **Step 1: 首页列出板块**

替换 `src/app/page.tsx` 全部内容为：
```tsx
import Link from "next/link";
import { api } from "~/trpc/server";

export default async function Home() {
  const sectors = await api.entity.listByType({ type: "SECTOR" });
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-bold">解牛 · 板块</h1>
      <ul className="mt-4 space-y-2">
        {sectors.map((s) => (
          <li key={s.id}>
            <Link href={`/entity/${s.id}`} className="text-blue-600 hover:underline">
              {s.name}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 2: 实体页**

`src/app/entity/[id]/page.tsx`:
```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { api } from "~/trpc/server";
import { entityTypeLabel } from "~/lib/format";
import { BUCKET_LABEL, type RelationBucket } from "~/lib/entity-graph";

export default async function EntityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await api.entity.getById({ id });
  if (!data) notFound();
  const { entity, groups } = data;
  const buckets = Object.keys(groups) as RelationBucket[];

  return (
    <main className="mx-auto max-w-2xl p-6">
      <Link href="/" className="text-sm text-blue-600 hover:underline">← 首页</Link>
      <p className="mt-2 text-sm text-gray-500">{entityTypeLabel(entity.type)}</p>
      <h1 className="text-2xl font-bold">{entity.name}</h1>
      {entity.ticker && (
        <p className="text-gray-600">{entity.exchange} · {entity.ticker}</p>
      )}
      {buckets.filter((b) => groups[b].length > 0).map((b) => (
        <section key={b} className="mt-6">
          <h2 className="mb-2 font-semibold">{BUCKET_LABEL[b]}</h2>
          <ul className="flex flex-wrap gap-2">
            {groups[b].map((e) => (
              <li key={e.id}>
                <Link href={`/entity/${e.id}`} className="rounded border px-3 py-1 hover:bg-gray-50">
                  {e.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
```

- [ ] **Step 3: 手动验证端到端**

Run: `npm run dev`，浏览器打开 `http://localhost:3000`
Expected:
- 首页看到「半导体」链接；
- 点进去看到「板块成分」下 8 家公司；
- 点「中芯国际」看到「所属板块 半导体 / 股票 中芯国际(688981) / 相关人物 赵海军 / 相关 北方华创」，且都可点跳转。

- [ ] **Step 4: 提交**

```bash
git add src/app/page.tsx "src/app/entity/[id]/page.tsx"
git commit -m "feat: home (sectors) + entity page with relations"
```

---

## Task 9: PWA 外壳

**Files:**
- Create: `public/manifest.webmanifest`
- Create: `public/icon-192.png`, `public/icon-512.png`（占位图标，后续替换品牌图）
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: 加 manifest**

`public/manifest.webmanifest`:
```json
{
  "name": "解牛",
  "short_name": "解牛",
  "description": "聚焦式一手财经资讯 + 大师视角解读",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#111111",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

- [ ] **Step 2: 生成占位图标**

Run（macOS 自带 sips，先用纯色占位）:
```bash
cd /Users/mac/claudeclaw/finance-agent/projects/jieniu/public
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC' | base64 --decode > _px.png
sips -z 512 512 _px.png --out icon-512.png >/dev/null
sips -z 192 192 _px.png --out icon-192.png >/dev/null
rm _px.png
```
Expected: `icon-192.png`、`icon-512.png` 生成（品牌图标在打磨阶段替换）。

- [ ] **Step 3: 在 root layout 挂 manifest 与 meta**

`src/app/layout.tsx` 的 `metadata`/`viewport` 导出中加入（App Router 用 Metadata API）：
```ts
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "解牛",
  description: "聚焦式一手财经资讯 + 大师视角解读",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "解牛" },
};

export const viewport: Viewport = {
  themeColor: "#111111",
};
```

- [ ] **Step 4: 验证 manifest 可访问 + 可安装性**

Run: `npm run dev`，然后：
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/manifest.webmanifest
```
Expected: `200`。Chrome DevTools → Application → Manifest 能识别「解牛」和图标。

- [ ] **Step 5: Service worker 与 iOS standalone（调用 skill）**

调用 `installable-pwa` skill 完成 service worker 注册与 iOS「添加到主屏」的坑（capability 缓存、底部白条、键盘 viewport 等）。该 skill 有踩过的雷，别手搓。
Expected: 手机「添加到主屏」后全屏 standalone 打开。

- [ ] **Step 6: 提交**

```bash
git add public/ src/app/layout.tsx
git commit -m "feat: PWA shell (manifest + icons + meta)"
```

---

## Task 10: 部署到 jieniu.swaylab.ai

**Files:** 无代码改动（构建 + 隧道）

- [ ] **Step 1: 生产构建**

Run:
```bash
npm run build
```
Expected: 构建成功，无类型错误。若报 NextAuth/env 校验错误，按提示在 `.env` 补齐（如 `AUTH_SECRET`，用 `npx auth secret` 生成）。

- [ ] **Step 2: 起生产服务**

Run（选一个固定端口）:
```bash
PORT=3838 npm run start
```
Expected: 服务在 `http://localhost:3838`（保持运行，或后台起）。

- [ ] **Step 3: 用 expose-tunnel 暴露到公网**

调用 `expose-tunnel` skill，把本机 `3838` 映射到 `jieniu.swaylab.ai`（rathole + Caddy + Let's Encrypt）。
Expected: skill 完成 server.toml/client.toml/Caddyfile 配置与证书签发。

- [ ] **Step 4: 验证公网可访问**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://jieniu.swaylab.ai
```
Expected: `200`。浏览器打开 `https://jieniu.swaylab.ai` 能看到首页并点进半导体实体页。

- [ ] **Step 5: 记录部署信息**

把端口、隧道配置、启动命令记到 `docs/reference/deploy.md`（新建）。提交：
```bash
git add docs/reference/deploy.md
git commit -m "docs: deploy notes for jieniu.swaylab.ai"
```

---

## 完成标准（M0+M1）

- `npm test` 全绿（format / entity-graph / entity router）。
- 本地和 `https://jieniu.swaylab.ai` 都能：首页看板块 → 点进半导体看成分 → 点公司看股票/人物/关联，全程可跳转。
- PWA 可「添加到主屏」standalone 打开。
- 所有改动已提交到 `projects/jieniu` 仓库。

**下一份计划（M2 数据管线）** 会：接入 6 个数据源的 fetcher（照 `docs/reference/data-sources.md`）、去重、实体标注（把新闻挂到本计划建的 Entity 上）、重要性打分，让实体页从「静态种子」变成「真实一手新闻时间线」。
