"""
Redis delayed-queue scheduler.

Pattern:
  - Producers ZADD payloads to a sorted set `<queue>:scheduled` with score =
    Unix timestamp at which the task should become visible to the worker.
  - This scheduler runs in a background thread, polling every POLL_INTERVAL
    seconds. It atomically moves matured entries (score <= now) from the
    sorted set into the primary list `<queue>`, where the normal
    RedisConsumer picks them up via BRPOP.

Redis does not support delayed lists natively, but this sorted-set pattern is
the standard way to implement them. It is robust to RPA restarts (the set is
persisted), idempotent (ZREM before LPUSH via Lua to avoid double-dispatch),
and cheap (a few ops per tick).
"""

import json
import logging
import threading
import time
from typing import Iterable, Optional

import redis

from config import config

logger = logging.getLogger(__name__)


# Lua script: move up to LIMIT matured items from <queue>:scheduled to <queue>.
# Atomic — we ZREM before LPUSH so a restart mid-tick cannot duplicate an item.
_MOVE_MATURED_LUA = """
local zkey = KEYS[1]
local lkey = KEYS[2]
local now = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])

local items = redis.call('ZRANGEBYSCORE', zkey, '-inf', now, 'LIMIT', 0, limit)
for i = 1, #items do
    redis.call('ZREM', zkey, items[i])
    redis.call('LPUSH', lkey, items[i])
end
return #items
"""


class RedisScheduler:
    """Background thread that flushes matured delayed items into the active queue."""

    POLL_INTERVAL_SECONDS = 30
    BATCH_LIMIT = 100

    def __init__(self, queue_names: Iterable[str]):
        """
        Args:
            queue_names: The primary list names whose `<queue>:scheduled`
                sorted-set companions should be polled (e.g.
                ["billing:note-search"]).
        """
        self.queue_names = list(queue_names)
        self.redis_url = config.REDIS_URL
        self.client: Optional[redis.Redis] = None
        self._thread: Optional[threading.Thread] = None
        self._should_stop = threading.Event()
        self._move_script = None

    def _connect(self):
        try:
            self.client = redis.Redis.from_url(
                self.redis_url,
                decode_responses=True,
                socket_connect_timeout=10,
                health_check_interval=30,
            )
            self.client.ping()
            self._move_script = self.client.register_script(_MOVE_MATURED_LUA)
            logger.info(
                f"[SCHEDULER] Connected to Redis for queues: {self.queue_names}"
            )
        except Exception as e:
            logger.error(f"[SCHEDULER] Redis connection failed: {e}")
            self.client = None
            self._move_script = None

    def start(self):
        """Launch the scheduler in a daemon thread."""
        if self._thread and self._thread.is_alive():
            return
        self._should_stop.clear()
        self._thread = threading.Thread(
            target=self._run,
            daemon=True,
            name="RedisScheduler",
        )
        self._thread.start()
        logger.info("[SCHEDULER] started")

    def stop(self):
        self._should_stop.set()

    def _run(self):
        while not self._should_stop.is_set():
            if not self.client or not self._move_script:
                self._connect()
                if not self.client:
                    # Connection still down; back off
                    if self._should_stop.wait(5):
                        break
                    continue

            try:
                now_ts = time.time()
                total_moved = 0
                for queue in self.queue_names:
                    zkey = f"{queue}:scheduled"
                    moved = self._move_script(
                        keys=[zkey, queue],
                        args=[now_ts, self.BATCH_LIMIT],
                    )
                    if moved:
                        logger.info(
                            f"[SCHEDULER] moved {moved} matured task(s) "
                            f"from {zkey} → {queue}"
                        )
                        total_moved += int(moved)
            except (redis.ConnectionError, redis.TimeoutError) as net_err:
                logger.error(f"[SCHEDULER] Redis network error: {net_err}")
                self.client = None
                self._move_script = None
            except Exception as e:
                logger.error(f"[SCHEDULER] unexpected error: {e}", exc_info=True)

            if self._should_stop.wait(self.POLL_INTERVAL_SECONDS):
                break

        logger.info("[SCHEDULER] stopped")


def enqueue_with_delay(
    queue_name: str,
    payload: dict,
    delay_seconds: float,
) -> bool:
    """
    Producer-side helper. Schedules `payload` on `<queue_name>:scheduled` with
    score = now + delay_seconds. The scheduler thread will flip it to the
    active queue when the delay elapses.

    Returns True on success, False if Redis is unreachable.
    """
    try:
        client = redis.Redis.from_url(
            config.REDIS_URL,
            decode_responses=True,
            socket_connect_timeout=10,
        )
        client.ping()
        zkey = f"{queue_name}:scheduled"
        score = time.time() + max(0, float(delay_seconds))
        client.zadd(zkey, {json.dumps(payload): score})
        logger.info(
            f"[SCHEDULER] enqueued to {zkey} (delay={delay_seconds:.0f}s, "
            f"score={score:.0f})"
        )
        return True
    except Exception as e:
        logger.error(f"[SCHEDULER] enqueue_with_delay failed: {e}")
        return False
