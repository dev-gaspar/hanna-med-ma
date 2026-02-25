"""
Hanna-Med RPA Node — Headless Data Collector

This is a headless RPA service that:
1. Registers itself with the backend using a unique UUID
2. Periodically extracts patient data from EMR systems
3. Sends raw data to the backend for processing

No GUI. No Cloudflare. No n8n webhooks.
"""

import signal
import sys
import time

from config import config
from core.rpa_engine import set_should_stop
from logger import logger
from rpa_node import RpaNode


def signal_handler(sig, frame):
    """Handle Ctrl+C gracefully."""
    logger.info("Shutdown signal received. Stopping RPA node...")
    set_should_stop(True)
    sys.exit(0)


signal.signal(signal.SIGINT, signal_handler)


def main():
    """Main entry point for headless RPA node."""
    logger.info("=" * 60)
    logger.info("  Hanna-Med RPA Node — Starting (Headless Mode)")
    logger.info("=" * 60)

    node = RpaNode()

    # Step 1: Register with backend (or confirm registration)
    if not node.register():
        logger.error("Failed to register with backend. Exiting.")
        sys.exit(1)

    # Step 2: Check current assignment status
    node.wait_for_assignment(timeout_seconds=0)

    if node.doctor_id:
        logger.info(f"Node initially assigned to Doctor ID: {node.doctor_id}")
    else:
        logger.info("Node is PENDING assignment. Will keep checking automatically.")

    # Step 3: Start the extraction loop
    node.run_extraction_loop()


if __name__ == "__main__":
    main()
