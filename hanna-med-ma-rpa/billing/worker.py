"""
Billing Worker - Consumes note search tasks from Redis and processes them.

Tasks are enqueued from the billing:note-search Redis queue and processed
between extraction cycles (since they require visual EMR interaction).
"""

import json
import logging
import threading
from collections import deque
from typing import Any, Dict, Optional

import requests

from config import config

logger = logging.getLogger(__name__)


class BillingNoteWorker:
    """Manages the billing note search task queue."""

    def __init__(self):
        self._queue: deque = deque()
        self._lock = threading.Lock()
        self.backend_url = config.BACKEND_URL

    def enqueue_task(self, task_data: dict):
        """
        Callback for Redis consumer. Enqueues task for later processing.
        Thread-safe — called from the Redis listener background thread.
        """
        with self._lock:
            self._queue.append(task_data)
            logger.info(
                f"[BILLING] Task enqueued: encounter {task_data.get('encounterId')} "
                f"for {task_data.get('patientName')} (queue size: {len(self._queue)})"
            )

    def has_pending_tasks(self) -> bool:
        """Check if there are tasks waiting to be processed."""
        with self._lock:
            return len(self._queue) > 0

    def pending_count(self) -> int:
        """Get number of pending tasks."""
        with self._lock:
            return len(self._queue)

    def process_next_task(self):
        """
        Process the next task in the queue.
        Called from the main thread between extraction cycles.
        """
        task = None
        with self._lock:
            if self._queue:
                task = self._queue.popleft()

        if not task:
            return

        encounter_id = task.get("encounterId")
        patient_name = task.get("patientName", "Unknown")
        attempt = task.get("attempt", 1)
        max_attempts = task.get("maxAttempts", 3)

        logger.info(
            f"[BILLING] Processing note search: encounter {encounter_id}, "
            f"patient {patient_name}, attempt {attempt}/{max_attempts}"
        )

        try:
            # Execute the note search flow
            result = self._execute_note_search(task)

            if result.get("success") and result.get("s3_key"):
                # Note found and uploaded — set providerNote on the encounter
                self._update_encounter(encounter_id, {
                    "providerNote": result["s3_key"],
                })
                logger.info(
                    f"[BILLING] Note found for encounter {encounter_id}: {result['s3_key']}"
                )
            elif attempt < max_attempts:
                # Re-enqueue for another attempt
                task["attempt"] = attempt + 1
                with self._lock:
                    self._queue.append(task)
                logger.info(
                    f"[BILLING] Note not found for encounter {encounter_id}, "
                    f"re-enqueued for attempt {attempt + 1}/{max_attempts}"
                )
            else:
                logger.warning(
                    f"[BILLING] Note not found after {max_attempts} attempts "
                    f"for encounter {encounter_id}"
                )

        except Exception as e:
            logger.error(
                f"[BILLING] Error processing encounter {encounter_id}: {e}",
                exc_info=True,
            )
            if attempt < max_attempts:
                task["attempt"] = attempt + 1
                with self._lock:
                    self._queue.append(task)

    def _execute_note_search(self, task: dict) -> dict:
        """Execute the Baptist note search flow."""
        from billing.baptist_note_flow import BaptistNoteFlow

        emr_system = task.get("emrSystem", "BAPTIST")

        if emr_system != "BAPTIST":
            logger.warning(f"[BILLING] Unsupported EMR system: {emr_system}, skipping")
            return {"success": False, "message": f"Unsupported EMR: {emr_system}"}

        flow = BaptistNoteFlow()

        # Get credentials for Baptist
        from flows.base_flow import _load_uuid
        try:
            rpa_uuid = _load_uuid()
            response = requests.get(
                f"{self.backend_url}/rpa/{rpa_uuid}/config", timeout=15
            )
            if response.status_code == 200:
                config_data = response.json()
                credentials = [
                    h.get("credentials", {})
                    for h in config_data.get("hospitals", [])
                    if h.get("type", "").upper() == "BAPTIST"
                ]
            else:
                credentials = []
        except Exception:
            credentials = []

        return flow.run(
            patient_name=task.get("patientName", ""),
            doctor_id=task.get("doctorId", 0),
            doctor_name=task.get("doctorName", ""),
            doctor_specialty=task.get("doctorSpecialty", ""),
            encounter_type=task.get("encounterType", "CONSULT"),
            date_of_service=task.get("dateOfService", ""),
            emr_system=emr_system,
            credentials=credentials,
        )

    def _update_encounter(self, encounter_id: int, data: dict):
        """Update encounter providerNote on the backend."""
        if not encounter_id:
            return

        try:
            url = f"{self.backend_url}/rpa/encounters/{encounter_id}/note"
            response = requests.patch(url, json=data, timeout=15)

            if response.status_code in (200, 201):
                logger.info(
                    f"[BILLING] Encounter {encounter_id} updated: providerNote={data.get('providerNote')}"
                )
            else:
                logger.error(
                    f"[BILLING] Failed to update encounter {encounter_id}: "
                    f"{response.status_code} - {response.text}"
                )
        except Exception as e:
            logger.error(f"[BILLING] Error updating encounter {encounter_id}: {e}")


# Singleton worker instance
_worker = None


def get_billing_worker() -> BillingNoteWorker:
    """Get singleton billing worker instance."""
    global _worker
    if _worker is None:
        _worker = BillingNoteWorker()
    return _worker
