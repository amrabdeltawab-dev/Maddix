import { SignJWT, jwtVerify } from "jose";
import type { Response, Request } from "express";
import { getSessionCookieOptions } from "./_core/cookies";
import { getUserById } from "./db";
import type { User } from "../drizzle/schema";

export const MADDIX_SESSION = "maddix_session";

function secret() {
  const configured = process.env.JWT_SECRET;
  if (process.env.NODE_ENV === "production" && (!configured || configured.length < 32)) {
    throw new Error("JWT_SECRET must be configured with at least 32 characters in production");
  }
  return new TextEncoder().encode(configured || "maddix-local-development-secret");
}

export async function createMaddixSession(user: User) {
  return new SignJWT({ userId: String(user.id), role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret());
}

export async function getMaddixUser(req: Request) {
  const raw = req.cookies?.[MADDIX_SESSION] || req.headers.cookie?.match(new RegExp(`${MADDIX_SESSION}=([^;]+)`))?.[1];
  if (!raw) return null;
  try {
    const { payload } = await jwtVerify(raw, secret());
    const userId = Number(payload.userId ?? payload.sub);
    if (!Number.isInteger(userId)) return null;
    const user = await getUserById(userId);
    return user?.active ? user : null;
  } catch {
    return null;
  }
}

export function setMaddixSession(res: Response, req: Request, token: string) {
  res.cookie(MADDIX_SESSION, token, { ...getSessionCookieOptions(req), maxAge: 7 * 24 * 60 * 60 * 1000 });
}

export function hasMaddixSession(req: Request) {
  return Boolean(req.cookies?.[MADDIX_SESSION] || req.headers.cookie?.includes(`${MADDIX_SESSION}=`));
}

export function clearMaddixSession(res: Response, req: Request) {
  res.clearCookie(MADDIX_SESSION, { ...getSessionCookieOptions(req), maxAge: -1 });
}
