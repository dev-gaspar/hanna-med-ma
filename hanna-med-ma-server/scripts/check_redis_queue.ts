import "dotenv/config";
import Redis from "ioredis";

(async () => {
  const url = process.env.SERVER_REDIS_URL;
  if (!url) throw new Error("SERVER_REDIS_URL not set");
  const r = new Redis(url);

  const len = await r.llen("billing:note-search");
  const items = await r.lrange("billing:note-search", 0, -1);

  console.log(`billing:note-search length: ${len}`);
  items.forEach((item, i) => console.log(`  [${i}] ${item.slice(0, 100)}...`));

  const cLen = await r.llen("caretracker:tasks");
  console.log(`caretracker:tasks length: ${cLen}`);

  await r.quit();
})();
