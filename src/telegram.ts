import type { Env } from "./types";

export async function sendTelegram(env: Env, chatId: string, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // No parse_mode: revert reasons / error messages can contain characters
    // (_, *, `) that break Telegram's Markdown parser and silently drop the
    // whole message. Plain text is more reliable than pretty-but-fragile.
    body: JSON.stringify({ chat_id: chatId, text }),
  });

  if (!res.ok) {
    console.error("Telegram send failed", res.status, await res.text());
  }
}
