import { getAuth, insertAuth, updateAuth } from "../db";
import { signSession, verifySession, timingSafeEqual, hashPassword, verifyPassword } from "../auth";
import { json } from "../http";
import type { Env } from "../types";

/** True if the request carries a valid, unexpired session token. */
export async function isAuthed(req: Request, env: Env): Promise<boolean> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  return verifySession(env.AUTH_SECRET, token);
}

export async function handleLogin(req: Request, env: Env): Promise<Response> {
  const body = await req
    .json<{ email?: string; password?: string }>()
    .catch(() => ({}) as { email?: string; password?: string });
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";

  const auth = await getAuth(env);

  if (!auth) {
    // First login ever: bootstrap the DB-backed credential from the factory-default secrets.
    const emailOk = timingSafeEqual(email, env.AUTH_EMAIL.trim().toLowerCase());
    const passwordOk = timingSafeEqual(password, env.AUTH_PASSWORD);
    if (!emailOk || !passwordOk) {
      return json({ error: "invalid credentials" }, 401);
    }
    const { hash, salt } = await hashPassword(password);
    await insertAuth(env, email, hash, salt);
  } else {
    const emailOk = timingSafeEqual(email, auth.email);
    const passwordOk = await verifyPassword(password, auth.password_hash, auth.password_salt);
    if (!emailOk || !passwordOk) {
      return json({ error: "invalid credentials" }, 401);
    }
  }

  const session = await signSession(env.AUTH_SECRET);
  return json(session);
}

export async function handleChangeCredentials(req: Request, env: Env): Promise<Response> {
  const body = await req
    .json<{ currentPassword?: string; newEmail?: string; newPassword?: string }>()
    .catch(() => ({}) as { currentPassword?: string; newEmail?: string; newPassword?: string });

  const currentPassword = body.currentPassword ?? "";
  const newEmail = (body.newEmail ?? "").trim().toLowerCase();
  const newPassword = body.newPassword ?? "";

  if (!newEmail || newPassword.length < 8) {
    return json({ error: "newEmail and a newPassword of at least 8 characters are required" }, 400);
  }

  const auth = await getAuth(env);
  if (!auth) return json({ error: "auth not configured" }, 500);

  const currentOk = await verifyPassword(currentPassword, auth.password_hash, auth.password_salt);
  if (!currentOk) return json({ error: "current password is incorrect" }, 401);

  const { hash, salt } = await hashPassword(newPassword);
  await updateAuth(env, newEmail, hash, salt);

  return json({ ok: true });
}
