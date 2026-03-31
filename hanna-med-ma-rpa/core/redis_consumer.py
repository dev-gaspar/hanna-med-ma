"""
Redis Consumer for listening to tasks on queues using BRPOP.
"""

import json
import time
import socket
import logging
from typing import Callable, Any

import redis

from config import config

logger = logging.getLogger(__name__)


class RedisConsumer:
    """Consumes tasks from a Redis list."""

    def __init__(self):
        self.redis_url = config.REDIS_URL
        self.client = None
        self._should_stop = False
        self._connect()

    def _connect(self):
        """Establish connection to Redis."""
        try:
            self.client = redis.Redis.from_url(
                self.redis_url,
                decode_responses=True,
                socket_connect_timeout=10,
                health_check_interval=30
            )
            self.client.ping()
            logger.info(f"Connected to Redis at {self.redis_url}")
        except Exception as e:
            logger.error(f"Failed to connect to Redis: {e}")
            self.client = None

    def stop(self):
        """Signal the consumer to stop."""
        self._should_stop = True

    def listen(self, queue_name: str, callback: Callable[[dict], None], timeout: int = 30):
        """
        Listen to a queue using BRPOP and process messages via callback.

        Args:
            queue_name: The Redis list name to listen to.
            callback: Function holding the logic to run on the received message.
            timeout: BRPOP timeout in seconds.
        """
        logger.info(f"Starting Redis listener on queue '{queue_name}'")

        while not self._should_stop:
            from core.rpa_engine import check_should_stop
            try:
                check_should_stop()
            except KeyboardInterrupt:
                break

            if not self.client:
                logger.warning("No Redis connection, attempting to reconnect in 5s...")
                time.sleep(5)
                self._connect()
                continue

            try:
                # Blocks for up to 'timeout' seconds
                result = self.client.brpop(queue_name, timeout=timeout)
                if result:
                    _, message_str = result
                    try:
                        message_data = json.loads(message_str)
                        logger.info(f"Received message from '{queue_name}'")
                        callback(message_data)
                    except json.JSONDecodeError:
                        logger.error(f"Failed to decode message from Redis: {message_str}")
                    except Exception as handler_err:
                        logger.error(f"Error in task handler: {handler_err}")
            except (redis.ConnectionError, redis.TimeoutError, socket.error) as net_err:
                logger.error(f"Redis connection issue during brpop: {net_err}")
                self.client = None
                time.sleep(5)  # Wait before reconnecting
            except KeyboardInterrupt:
                logger.info("Redis listener stopped by KeyboardInterrupt")
                break
            except Exception as e:
                logger.error(f"Unexpected error in Redis listener loop: {e}")
                time.sleep(2)

        logger.info(f"Redis listener on queue '{queue_name}' has stopped.")
