/**
 * Rewrites every item in `billing:note-search:scheduled` so its maturity
 * score = now + DELAY_SECONDS (default 10). Use this after marking a
 * patient as seen if you don't want to wait the real 4h.
 */

import "dotenv/config";
import Redis from "ioredis";

(async () => {
  const delaySeconds = Number(process.env.DELAY_SECONDS ?? 10);
  const url = process.env.SERVER_REDIS_URL;
  if (!url) throw new Error("SERVER_REDIS_URL not set");

  const r = new Redis(url);
  const key = "billing:note-search:scheduled";

  const items = await r.zrange(key, 0, -1, "WITHSCORES");
  if (items.length === 0) {
    console.log(`${key} is empty — nothing to fast-forward.`);
    await r.quit();
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const newScore = now + delaySeconds;

  // Items come as [payload1, score1, payload2, score2, ...]
  const entries: Array<{ payload: string; oldScore: number }> = [];
  for (let i = 0; i < items.length; i += 2) {
    entries.push({ payload: items[i], oldScore: Number(items[i + 1]) });
  }

  console.log(
    `Fast-forwarding ${entries.length} scheduled task(s) → new ETA +${delaySeconds}s`,
  );

  for (const { payload, oldScore } of entries) {
    const eta = oldScore - now;
    await r.zadd(key, newScore, payload);
    console.log(
      `  rescored (was ETA ${eta}s, now ETA +${delaySeconds}s): ${payload.slice(0, 100)}...`,
    );
  }

  await r.quit();
  console.log(`Done. The scheduler (30s poll) will flip these shortly.`);
})();
