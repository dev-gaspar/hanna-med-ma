"""
Billing Worker - Consumes note search tasks from Redis and processes them.

Tasks are enqueued from the billing:note-search Redis queue and processed
between extraction cycles (since they require visual EMR interaction).

State reported to the backend for each attempt:
- SEARCHING  : attempt started
- FOUND_SIGNED   : success, providerNote populated
- FOUND_UNSIGNED : note exists but not signed yet → re-enqueue with +4h delay
- NOT_FOUND  : nothing matched → re-enqueue with +4h delay

On the last attempt (attempt == maxAttempts) we leave whichever state we
reached without re-enqueuing; noteAttempts on the encounter reaches 6 and
the scheduler stops trying.
"""

import json
import logging
import threading
from collections import deque
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import requests

from config import config
from core.redis_scheduler import enqueue_with_delay

logger = logging.getLogger(__name__)


RETRY_DELAY_SECONDS = 4 * 60 * 60  # 4 hours between attempts


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
        max_attempts = task.get("maxAttempts", 6)

        logger.info(
            f"[BILLING] Processing note search: encounter {encounter_id}, "
            f"patient {patient_name}, attempt {attempt}/{max_attempts}"
        )

        # Mark SEARCHING before running the flow
        self._patch_note_state(encounter_id, {
            "noteStatus": "SEARCHING",
            "noteAttempts": attempt,
            "noteLastAttemptAt": self._now_iso(),
        })

        try:
            result = self._execute_note_search(task)
            outcome = result.get("outcome", "not_found")
            agent_summary = result.get("agent_summary") or ""
            s3_key = result.get("s3_key")

            if outcome == "found_signed" and s3_key:
                self._patch_note_state(encounter_id, {
                    "noteStatus": "FOUND_SIGNED",
                    "providerNote": s3_key,
                    "noteAttempts": attempt,
                    "noteAgentSummary": agent_summary,
                    "noteLastAttemptAt": self._now_iso(),
                })
                logger.info(
                    f"[BILLING] Encounter {encounter_id} FOUND_SIGNED "
                    f"(attempt {attempt}) → {s3_key}"
                )

            elif outcome == "found_unsigned":
                self._patch_note_state(encounter_id, {
                    "noteStatus": "FOUND_UNSIGNED",
                    "noteAttempts": attempt,
                    "noteAgentSummary": agent_summary,
                    "noteLastAttemptAt": self._now_iso(),
                })
                if attempt < max_attempts:
                    self._reschedule(task, attempt + 1, max_attempts)
                else:
                    logger.warning(
                        f"[BILLING] Encounter {encounter_id} ended FOUND_UNSIGNED "
                        f"after {attempt} attempts — doctor never signed."
                    )

            else:  # not_found
                self._patch_note_state(encounter_id, {
                    "noteStatus": "NOT_FOUND",
                    "noteAttempts": attempt,
                    "noteAgentSummary": agent_summary,
                    "noteLastAttemptAt": self._now_iso(),
                })
                if attempt < max_attempts:
                    self._reschedule(task, attempt + 1, max_attempts)
                else:
                    logger.warning(
                        f"[BILLING] Encounter {encounter_id} ended NOT_FOUND "
                        f"after {attempt} attempts."
                    )

        except Exception as e:
            logger.error(
                f"[BILLING] Error processing encounter {encounter_id}: {e}",
                exc_info=True,
            )
            self._patch_note_state(encounter_id, {
                "noteStatus": "NOT_FOUND",
                "noteAttempts": attempt,
                "noteAgentSummary": f"Outcome: not_found. Unhandled exception: {e}",
                "noteLastAttemptAt": self._now_iso(),
            })
            if attempt < max_attempts:
                self._reschedule(task, attempt + 1, max_attempts)

    @staticmethod
    def _now_iso() -> str:
        return datetime.now(timezone.utc).isoformat()

    def _reschedule(self, task: dict, next_attempt: int, max_attempts: int):
        """Put the task back on the delayed queue with a 4h delay."""
        next_task = dict(task)
        next_task["attempt"] = next_attempt
        next_task["maxAttempts"] = max_attempts
        ok = enqueue_with_delay(
            "billing:note-search", next_task, RETRY_DELAY_SECONDS
        )
        if ok:
            logger.info(
                f"[BILLING] Encounter {task.get('encounterId')} re-enqueued "
                f"for attempt {next_attempt}/{max_attempts} in "
                f"{RETRY_DELAY_SECONDS // 60}min"
            )
        else:
            logger.error(
                f"[BILLING] Failed to re-schedule encounter "
                f"{task.get('encounterId')} — dropping. Manual intervention needed."
            )

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

    def _patch_note_state(self, encounter_id: int, data: dict):
        """PATCH the encounter note-tracking fields on the backend."""
        if not encounter_id:
            return

        try:
            url = f"{self.backend_url}/rpa/encounters/{encounter_id}/note"
            response = requests.patch(url, json=data, timeout=15)

            if response.status_code in (200, 201):
                logger.info(
                    f"[BILLING] Encounter {encounter_id} PATCHed: "
                    f"status={data.get('noteStatus')}, attempts={data.get('noteAttempts')}"
                )
            else:
                logger.error(
                    f"[BILLING] PATCH /rpa/encounters/{encounter_id}/note failed: "
                    f"{response.status_code} - {response.text}"
                )
        except Exception as e:
            logger.error(f"[BILLING] Error PATCHing encounter {encounter_id}: {e}")


# Singleton worker instance
_worker = None


def get_billing_worker() -> BillingNoteWorker:
    """Get singleton billing worker instance."""
    global _worker
    if _worker is None:
        _worker = BillingNoteWorker()
    return _worker
