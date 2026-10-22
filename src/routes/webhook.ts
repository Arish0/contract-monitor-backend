import { createPublicClient, http, decodeFunctionData, decodeErrorResult, toFunctionSelector, type Abi, type Hex } from "viem";
import loanContractAbiJson from "../abi/loan-contract-abi.json";
import { sendTelegram } from "../telegram";
import { verifyAlchemySignature, alreadyHandled, markHandled } from "../verify";
import { logEvent, getSettings } from "../db";
import type { Env, AlchemyMinedTx, ClientFailureReport } from "../types";

const abi = loanContractAbiJson as Abi;

// Selectors the deployed implementation exposes that the bundled ABI doesn't
// (the ABI predates an upgrade that changed these signatures).
const EXTRA_SELECTORS: Record<string, string> = {
  "0xa82b8841": "acceptLoan",
};

const SELECTOR_NAMES: Record<string, string> = {
  ...Object.fromEntries(
    abi.filter((item) => item.type === "function").map((fn) => [toFunctionSelector(fn), fn.name]),
  ),
  ...EXTRA_SELECTORS,
};

function selectorFallback(input: string): string {
  const selector = input.slice(0, 10).toLowerCase();
  return SELECTOR_NAMES[selector] ?? `Unknown function (${selector})`;
}

function rpcUrl(env: Env): string {
  return `https://${env.ALCHEMY_NETWORK}.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`;
}

/** Ingests a mined-transaction webhook from Alchemy: decodes calldata, logs the event, and alerts Telegram. */
export async function handleAlchemyWebhook(req: Request, env: Env): Promise<Response> {
  const rawBody = await req.text();
  const signature = req.headers.get("x-alchemy-signature") ?? "";

  const sigOk = await verifyAlchemySignature(rawBody, signature, env.ALCHEMY_SIGNING_KEY);
  if (!sigOk) {
    return new Response("bad signature", { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  // Webhook payload shape (Custom/GraphQL type): event.data.block.transactions[]
  const txs: AlchemyMinedTx[] = payload?.event?.data?.block?.transactions ?? [];

  const client = createPublicClient({ transport: http(rpcUrl(env)) });
  const contractAddress = env.CONTRACT_ADDRESS.toLowerCase();
  const settings = await getSettings(env);

  for (const tx of txs) {
    const toAddress = tx.to?.address;
    const fromAddress = tx.from?.address ?? "unknown";
    if (!toAddress || toAddress.toLowerCase() !== contractAddress) continue;
    if (await alreadyHandled(tx.hash)) continue;

    // The webhook query can't expose raw calldata on this schema, so fetch
    // the full transaction (which has `input`) via RPC using the hash.
    let fullTx;
    let gasUsed: number | null = null;
    let gasPrice: string | null = null;
    let blockTime: number | null = null;
    let blockNumber: bigint;
    try {
      fullTx = await client.getTransaction({ hash: tx.hash as `0x${string}` });
      gasPrice = fullTx.gasPrice?.toString() ?? null;
      const receipt = await client.getTransactionReceipt({ hash: tx.hash as `0x${string}` });
      gasUsed = Number(receipt.gasUsed);
      blockNumber = receipt.blockNumber;
      const block = await client.getBlock({ blockHash: receipt.blockHash });
      blockTime = Number(block.timestamp);
    } catch (err) {
      console.error("failed to fetch tx/receipt details", err);
      continue;
    }

    let functionName: string;
    try {
      functionName = decodeFunctionData({ abi, data: fullTx.input }).functionName;
    } catch (err) {
      functionName = selectorFallback(fullTx.input);
      console.warn("ABI decode failed; continuing with selector fallback", { txHash: tx.hash, selector: fullTx.input.slice(0, 10), err });
    }

    if (tx.status === 1) {
      await logEvent(env, {
        txHash: tx.hash,
        functionName: functionName,
        fromAddress,
        status: "success",
        gasUsed,
        gasPrice,
        blockTime,
        revertReason: null,
      });
      if (settings.notify_success) {
        await sendTelegram(
          env,
          env.TELEGRAM_ACTIVITY_CHANNEL_ID,
          `✅ ${functionName} called\nBy: ${fromAddress}\nTx: ${env.EXPLORER_TX_BASE_URL}/${tx.hash}`,
        );
      }
    } else {
      const reason = await decodeRevertReason(client, fromAddress, fullTx.input, fullTx.value, blockNumber, env);
      await logEvent(env, {
        txHash: tx.hash,
        functionName: functionName,
        fromAddress,
        status: "reverted",
        gasUsed,
        gasPrice,
        blockTime,
        revertReason: reason,
      });
      if (settings.notify_revert) {
        await sendTelegram(
          env,
          env.TELEGRAM_ADMIN_GROUP_ID,
          `🚨 ${functionName} REVERTED\nBy: ${fromAddress}\nReason: ${reason}\nTx: ${env.EXPLORER_TX_BASE_URL}/${tx.hash}`,
        );
      }
    }

    await markHandled(tx.hash);
  }

  return new Response("ok");
}

/**
 * Replays the reverted call's raw calldata against the state just before its block to recover
 * a human-readable revert reason. Works from the raw input, so it doesn't depend on the
 * function being present in the ABI.
 */
async function decodeRevertReason(
  client: ReturnType<typeof createPublicClient>,
  fromAddress: string,
  input: Hex,
  value: bigint,
  blockNumber: bigint,
  env: Env,
): Promise<string> {
  try {
    await client.call({
      account: fromAddress as `0x${string}`,
      to: env.CONTRACT_ADDRESS as `0x${string}`,
      data: input,
      value,
      blockNumber: blockNumber - 1n,
    });
    return "unknown (replay succeeded — revert depended on earlier txs in the same block)";
  } catch (err: any) {
    const data: Hex | undefined = err.walk?.((e: any) => typeof e?.data === "string")?.data;
    if (data && data.length >= 10) {
      try {
        const { errorName, args } = decodeErrorResult({ abi, data });
        return args?.length ? `${errorName}(${args.map(String).join(", ")})` : errorName;
      } catch {
        // Not a custom error in our ABI — fall through to viem's own message (covers Error(string)/Panic).
      }
    }
    return err.shortMessage ?? err.cause?.reason ?? err.message ?? "unknown revert";
  }
}

/** Ingests a pre-mine failure reported directly by the marketplace frontend (rejected by wallet, simulation failed, etc). */
export async function handleClientFailure(req: Request, env: Env): Promise<Response> {
  const body = await req.json<ClientFailureReport>();

  await logEvent(env, {
    txHash: null,
    functionName: body.fn,
    fromAddress: body.user,
    status: "failed_premine",
    gasUsed: null,
    gasPrice: null,
    blockTime: Math.floor(Date.now() / 1000),
    revertReason: body.reason,
  });

  const settings = await getSettings(env);
  if (settings.notify_failure) {
    await sendTelegram(
      env,
      env.TELEGRAM_ADMIN_GROUP_ID,
      `🚨 ${body.fn} failed before mining (${body.stage})\nUser: ${body.user}\nReason: ${body.reason}`,
    );
  }

  return new Response("ok");
}
