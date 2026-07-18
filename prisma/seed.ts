import { PrismaClient } from "../generated/prisma";

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
    data: {
      type: "SECTOR",
      name: "半导体",
      shortName: "半导体",
      aliases: ["芯片", "集成电路", "IC"],
    },
  });

  const companyByName: Record<string, string> = {};
  for (const c of COMPANIES) {
    const company = await db.entity.create({
      data: { type: "COMPANY", name: c.name, shortName: c.name },
    });
    companyByName[c.name] = company.id;
    const stock = await db.entity.create({
      data: {
        type: "STOCK",
        name: `${c.name}(${c.ticker})`,
        ticker: c.ticker,
        exchange: c.exchange,
      },
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
    await db.entityRelation.create({
      data: { fromId: nmc, toId: smic, type: "RELATED" },
    });
  }

  const count = await db.entity.count();
  console.log(`Seeded ${count} entities.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
