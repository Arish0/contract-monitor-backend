import { trafficByHour, gasByHour, byFunction, topWallets, heatmap, summary, listEvents, countEvents, getSettings, updateSettings } from "./db";
import { isAuthed, handleLogin, handleChangeCredentials } from "./routes/login";
import { handleAlchemyWebhook, handleClientFailure } from "./routes/webhook";
import { resolveRange } from "./range";
import { json, CORS_HEADERS } from "./http";
import type { Env } from "./types";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

    if (url.pathname === "/health") return new Response("ok");

    if (req.method === "POST" && url.pathname === "/auth/login") {
      return handleLogin(req, env);
    }

    if (req.method === "POST" && url.pathname === "/webhook/alchemy") {
      return handleAlchemyWebhook(req, env);
    }

    if (req.method === "POST" && url.pathname === "/report-failure") {
      return handleClientFailure(req, env);
    }

    // Everything below is the operator dashboard's data — requires a valid session.
    if (!(await isAuthed(req, env))) {
      return json({ error: "unauthorized" }, 401);
    }

    if (req.method === "POST" && url.pathname === "/auth/change-credentials") {
      return handleChangeCredentials(req, env);
    }

    if (req.method === "GET" && url.pathname === "/analytics/summary") {
      return json(await summary(env, resolveRange(url)));
    }

    if (req.method === "GET" && url.pathname === "/analytics/traffic") {
      return json(await trafficByHour(env, resolveRange(url)));
    }

    if (req.method === "GET" && url.pathname === "/analytics/gas") {
      return json(await gasByHour(env, resolveRange(url)));
    }

    if (req.method === "GET" && url.pathname === "/analytics/by-function") {
      return json(await byFunction(env, resolveRange(url)));
    }

    if (req.method === "GET" && url.pathname === "/analytics/top-wallets") {
      return json(await topWallets(env, resolveRange(url), Number(url.searchParams.get("limit") ?? 20)));
    }

    if (req.method === "GET" && url.pathname === "/analytics/heatmap") {
      return json(await heatmap(env, resolveRange(url)));
    }

    if (req.method === "GET" && url.pathname === "/analytics/events") {
      const range = resolveRange(url);
      const limit = Number(url.searchParams.get("limit") ?? 10);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const [events, total] = await Promise.all([listEvents(env, range, limit, offset), countEvents(env, range)]);
      const withLinks = events.map((e) => ({
        ...e,
        explorer_url: e.tx_hash ? `${env.EXPLORER_TX_BASE_URL}/${e.tx_hash}` : null,
      }));
      return json({ events: withLinks, total });
    }

    if (req.method === "GET" && url.pathname === "/settings") {
      return json(await getSettings(env));
    }

    if (req.method === "POST" && url.pathname === "/settings") {
      const patch = await req.json<Partial<{ notify_success: boolean; notify_revert: boolean; notify_failure: boolean }>>();
      return json(await updateSettings(env, patch));
    }

    return new Response("not found", { status: 404 });
  },
};
