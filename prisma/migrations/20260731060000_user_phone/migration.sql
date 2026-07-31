-- 手机号登录（张楚寒转述她爹 2026-07-31：「登陆怎么还要邮箱啊」「手机号登陆不好吗」）。
-- nullable + unique：存量用户全是邮箱注册，phone 为 null；Postgres 的 unique 索引允许多个 null。
ALTER TABLE "User" ADD COLUMN     "phone" TEXT;
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
