import "dotenv/config";
import Redis from "ioredis";

(async () => {
  const url = process.env.SERVER_REDIS_URL;
  if (!url) throw new Error("SERVER_REDIS_URL not set");
  const r = new Redis(url);

  const now = Math.floor(Date.now() / 1000);

  const activeLen = await r.llen("billing:note-search");
  const activeItems = await r.lrange("billing:note-search", 0, -1);
  console.log(`billing:note-search (active): ${activeLen}`);
  activeItems.forEach((item, i) =>
    console.log(`  [${i}] ${item.slice(0, 120)}...`),
  );

  const scheduled = await r.zrange(
    "billing:note-search:scheduled",
    0,
    -1,
    "WITHSCORES",
  );
  console.log(
    `\nbilling:note-search:scheduled (delayed): ${scheduled.length / 2}`,
  );
  for (let i = 0; i < scheduled.length; i += 2) {
    const payload = scheduled[i];
    const score = Number(scheduled[i + 1]);
    const eta = score - now;
    console.log(
      `  eta=${eta >= 0 ? `+${eta}s` : `${eta}s (overdue)`}  ${payload.slice(0, 100)}...`,
    );
  }

  const cLen = await r.llen("caretracker:tasks");
  console.log(`\ncaretracker:tasks: ${cLen}`);

  await r.quit();
})();
