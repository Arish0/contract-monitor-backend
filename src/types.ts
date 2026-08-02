export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_ACTIVITY_CHANNEL_ID: string;
  TELEGRAM_ADMIN_GROUP_ID: string;
  ALCHEMY_API_KEY: string;
  ALCHEMY_SIGNING_KEY: string;
  CONTRACT_ADDRESS: string;
  ALCHEMY_NETWORK: string;
  EXPLORER_TX_BASE_URL: string;
  AUTH_EMAIL: string;
  AUTH_PASSWORD: string;
  AUTH_SECRET: string;
}

export interface AlchemyMinedTx {
  hash: string;
  to: { address: string } | null;
  from: { address: string } | null;
  status: number; // 1 success, 0 reverted
}

export interface ClientFailureReport {
  fn: string;
  user: string;
  reason: string;
  stage: "rejected-by-node" | "preflight-simulation" | string;
}
