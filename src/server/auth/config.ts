import { PrismaAdapter } from "@auth/prisma-adapter";
import { type DefaultSession, type NextAuthConfig } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

import { db } from "~/server/db";
import { verifyOtpCode } from "~/server/otp-verify";
import { verifyPassword } from "~/lib/password";

/**
 * Module augmentation for `next-auth` types — add `id` onto session.user.
 */
declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

/**
 * Email-OTP login: the code is issued + emailed by tRPC `auth.requestOtp`;
 * here we only verify it (via the shared `verifyOtpCode`) and mint a JWT session.
 * Credentials provider requires the `jwt` session strategy.
 */
export const authConfig = {
  // App runs behind the rathole + Caddy reverse proxy; trust the forwarded host.
  trustHost: true,
  providers: [
    CredentialsProvider({
      name: "Email OTP",
      credentials: {
        email: { label: "邮箱", type: "email" },
        code: { label: "验证码", type: "text" },
      },
      authorize: async (credentials) => {
        const email =
          typeof credentials?.email === "string" ? credentials.email : "";
        const code =
          typeof credentials?.code === "string" ? credentials.code : "";
        if (!email || !code) return null;
        const result = await verifyOtpCode(db, email, code);
        if (!result.ok || !result.userId) return null;
        return { id: result.userId, email: email.toLowerCase() };
      },
    }),
    CredentialsProvider({
      id: "password",
      name: "Email + Password",
      credentials: {
        email: { label: "邮箱", type: "email" },
        password: { label: "密码", type: "password" },
      },
      authorize: async (credentials) => {
        const email =
          typeof credentials?.email === "string"
            ? credentials.email.toLowerCase()
            : "";
        const password =
          typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password) return null;
        const user = await db.user.findUnique({ where: { email } });
        if (!user?.password) return null;
        const ok = await verifyPassword(password, user.password);
        return ok ? { id: user.id, email } : null;
      },
    }),
  ],
  adapter: PrismaAdapter(db),
  session: { strategy: "jwt" },
  callbacks: {
    session: ({ session, token }) => ({
      ...session,
      user: {
        ...session.user,
        id: token.sub ?? "",
      },
    }),
  },
} satisfies NextAuthConfig;
