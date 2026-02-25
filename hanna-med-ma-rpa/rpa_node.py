"""
RPA Node — Orchestrates the headless data collection lifecycle.

Handles:
- UUID-based registration with the backend
- Heartbeat management
- Periodic data extraction from configured EMR systems
- Batch data sending to the backend ingestion endpoint
"""

import time
import socket
import uuid
import json
import logging
from pathlib import Path

import requests

from config import config

logger = logging.getLogger(__name__)

# Path to store the UUID persistently
UUID_FILE = Path("rpa_uuid.json")


def get_or_create_uuid() -> str:
    """Get the persisted UUID or generate a new one."""
    try:
        if UUID_FILE.exists():
            data = json.loads(UUID_FILE.read_text())
            if "uuid" in data:
                return data["uuid"]
    except Exception:
        pass

    new_uuid = str(uuid.uuid4())
    try:
        UUID_FILE.write_text(json.dumps({"uuid": new_uuid}))
    except Exception as e:
        logger.warning(f"Could not persist UUID: {e}")

    return new_uuid


class RpaNode:
    """Manages the lifecycle of a headless RPA node."""

    def __init__(self):
        self.uuid = get_or_create_uuid()
        self.backend_url = config.BACKEND_URL
        self.doctor_id = None
        self.doctor_name = None
        self.doctor_specialty = None
        self.credentials = []
        self.hospital_configs = []
        # Stores patient names per hospital after patient_list extraction
        # Used to pass to batch summary/insurance flows
        self._last_patient_names: dict[str, list[str]] = {}

    def register(self) -> bool:
        """Register this RPA node with the backend."""
        try:
            hostname = socket.gethostname()
            response = requests.post(
                f"{self.backend_url}/rpa/register",
                json={
                    "uuid": self.uuid,
                    "hostname": hostname,
                },
                timeout=15,
            )

            if response.status_code in [200, 201]:
                data = response.json()
                logger.info(f"Registered successfully. UUID: {self.uuid}")

                if data.get("doctorId"):
                    self.doctor_id = data["doctorId"]
                    self.doctor_name = data.get("doctorName")

                return True
            else:
                logger.error(
                    f"Registration failed: {response.status_code} — {response.text}"
                )
                return False

        except Exception as e:
            logger.error(f"Registration error: {e}")
            return False

    def wait_for_assignment(self, timeout_seconds: int = 0) -> bool:
        """
        Wait until this node is assigned to a doctor.

        Args:
            timeout_seconds: 0 = don't wait (just check), >0 = wait up to N seconds
        """
        if self.doctor_id:
            return True

        if timeout_seconds == 0:
            return False

        logger.info("Waiting for admin to assign a doctor to this node...")
        start = time.time()

        while time.time() - start < timeout_seconds:
            try:
                response = requests.get(
                    f"{self.backend_url}/rpa/{self.uuid}/config",
                    timeout=10,
                )
                if response.status_code == 200:
                    data = response.json()
                    if data.get("doctorId"):
                        self.doctor_id = data["doctorId"]
                        self.doctor_name = data.get("doctorName")
                        self.doctor_specialty = data.get("doctorSpecialty")
                        self.credentials = data.get("credentials", [])
                        self.hospital_configs = data.get("hospitals", [])
                        return True
            except Exception:
                pass
            time.sleep(30)

        return False

    def _fetch_config(self):
        """Fetch latest configuration from backend."""
        try:
            response = requests.get(
                f"{self.backend_url}/rpa/{self.uuid}/config",
                timeout=10,
            )
            if response.status_code == 200:
                data = response.json()
                self.doctor_id = data.get("doctorId")
                self.doctor_name = data.get("doctorName")
                self.doctor_specialty = data.get("doctorSpecialty")
                self.credentials = data.get("credentials", [])
                self.hospital_configs = data.get("hospitals", [])
        except Exception as e:
            logger.warning(f"Config fetch failed: {e}")

    def send_heartbeat(self):
        """Send heartbeat to backend."""
        try:
            requests.post(
                f"{self.backend_url}/rpa/{self.uuid}/heartbeat",
                timeout=5,
            )
        except Exception as e:
            logger.warning(f"Heartbeat failed: {e}")

    def run_extraction_loop(self):
        """
        Main extraction loop — STRICTLY SEQUENTIAL.

        For each hospital:
          1. patient_list    (opens EMR session)
          2. batch_summaries (reuses open session)
          3. batch_insurance (reuses open session)
        Then waits for `extraction_interval_seconds` before repeating.

        Only one flow is ever running at a time. If a task fails,
        we log the error, take a screenshot, then skip to the next hospital.
        """
        from core.rpa_engine import check_should_stop

        logger.info("Starting sequential extraction loop...")

        # Per-task skip flags (configurable from rpa_config.json)
        task_timeout = config.get_rpa_setting("task_timeout_seconds", 7200)
        skip_patient_list = config.get_rpa_setting("skip_patient_list", False)
        skip_summaries = config.get_rpa_setting("skip_batch_summaries", False)
        skip_insurance = config.get_rpa_setting("skip_batch_insurance", False)

        while not check_should_stop():
            # Refresh config and heartbeat at the start of each cycle
            self._fetch_config()
            self.send_heartbeat()

            if not self.hospital_configs:
                logger.info("No hospital configs found. Waiting 60s...")
                time.sleep(60)
                continue

            disabled_emr_types = set(
                t.upper()
                for t in (config.get_rpa_setting("disabled_emr_types", []) or [])
                if isinstance(t, str)
            )
            if disabled_emr_types:
                logger.info(
                    f"Disabled EMR types (config): {', '.join(sorted(disabled_emr_types))}"
                )

            logger.info(
                f"=== CYCLE START — {len(self.hospital_configs)} hospital(s) to process ==="
            )

            for hospital_config in self.hospital_configs:
                if check_should_stop():
                    break

                hospital_type = hospital_config.get("type", "UNKNOWN").upper()
                if hospital_type in disabled_emr_types:
                    logger.info(
                        f"Skipping {hospital_type} — disabled by config (disabled_emr_types)"
                    )
                    continue

                logger.info(
                    f"\n{'─' * 60}\n" f"  HOSPITAL: {hospital_type}\n" f"{'─' * 60}"
                )

                # Task 1: Patient List
                if not skip_patient_list:
                    if not self._run_task(
                        name=f"{hospital_type} patient_list",
                        fn=self._extract_patient_list,
                        hospital_type=hospital_type,
                        hospital_config=hospital_config,
                        timeout=task_timeout,
                    ):
                        logger.warning(
                            f"Skipping summaries and insurance for {hospital_type} "
                            "because patient_list failed."
                        )
                        continue

                # Task 2: Batch Summaries
                if not skip_summaries:
                    self._run_task(
                        name=f"{hospital_type} batch_summaries",
                        fn=self._extract_batch_summaries,
                        hospital_type=hospital_type,
                        hospital_config=hospital_config,
                        timeout=task_timeout,
                    )

                # Task 3: Batch Insurance
                if not skip_insurance:
                    self._run_task(
                        name=f"{hospital_type} batch_insurance",
                        fn=self._extract_batch_insurance,
                        hospital_type=hospital_type,
                        hospital_config=hospital_config,
                        timeout=task_timeout,
                    )

                logger.info(f"--- {hospital_type} complete ---")

                # Brief pause between hospitals so the UI fully resets
                if not check_should_stop():
                    time.sleep(5)

            # Wait before next full cycle
            interval = config.get_rpa_setting("extraction_interval_seconds", 3600)
            logger.info(
                f"=== CYCLE COMPLETE — waiting {interval}s before next cycle ==="
            )
            for _ in range(interval):
                if check_should_stop():
                    break
                time.sleep(1)

    def _run_task(
        self,
        name: str,
        fn,
        hospital_type: str,
        hospital_config: dict,
        timeout: int = 7200,
    ) -> bool:
        """
        Execute a single extraction task safely.

        Returns True if the task completed without raising, False otherwise.
        This ensures only ONE flow controls the UI at any given time.
        """
        logger.info(f"[TASK START] {name}")
        try:
            fn(hospital_type, hospital_config)
            logger.info(f"[TASK DONE ] {name}")
            return True
        except Exception as e:
            logger.error(f"[TASK FAIL ] {name}: {e}")
            self._report_error(hospital_type, str(e))
            return False

    def _extract_patient_list(self, hospital_type: str, hospital_config: dict):
        """
        Extract patient list (census) from a single EMR system.

        The flow's notify_completion() already sends data to the backend,
        so we do NOT send again from here. We only extract patient names
        from the result to pass them to batch summary/insurance flows.
        """
        flow_map = {
            "JACKSON": ("flows.jackson", "JacksonFlow"),
            "BAPTIST": ("flows.baptist", "BaptistFlow"),
            "STEWARD": ("flows.steward", "StewardFlow"),
        }

        mapping = flow_map.get(hospital_type)
        if not mapping:
            logger.warning(f"Unknown hospital type: {hospital_type}")
            return

        module_name, class_name = mapping
        logger.info(f"Extracting patient list from {hospital_type}...")

        import importlib

        module = importlib.import_module(module_name)
        flow_cls = getattr(module, class_name)
        flow = flow_cls()

        creds = self._get_credentials_for(hospital_type)
        result = flow.run(
            doctor_id=self.doctor_id,
            doctor_name=self.doctor_name,
            credentials=creds,
            doctor_specialty=self.doctor_specialty,
        )

        # Extract patient names from the result for use in batch flows.
        # notify_completion() inside run() already sent data to the backend.
        if result and isinstance(result, list):
            patient_names = [
                p.get("name", "") for p in result if isinstance(p, dict) and p.get("name")
            ]
            self._last_patient_names[hospital_type] = patient_names
            logger.info(
                f"Patient list extracted: {len(patient_names)} patients from {hospital_type}"
            )
        else:
            logger.info(
                f"Patient list flow for {hospital_type} completed "
                "(no structured data returned)"
            )

    def _extract_batch_summaries(self, hospital_type: str, hospital_config: dict):
        """
        Extract clinical summaries for all patients in the open EMR session.

        The flow's notify_completion() already sends data to the backend.
        Patient names are passed from the previously extracted patient list.
        """
        logger.info(f"Extracting batch summaries from {hospital_type}...")

        # Get patient names from the patient list extraction
        patient_names = self._last_patient_names.get(hospital_type, [])
        if not patient_names:
            logger.warning(
                f"No patient names available for {hospital_type} batch summaries. "
                "Skipping — patient list may have failed or returned no patients."
            )
            return

        logger.info(
            f"Batch summaries: processing {len(patient_names)} patients for {hospital_type}"
        )

        batch_map = {
            "JACKSON": ("flows.jackson_batch_summary", "JacksonBatchSummaryFlow"),
            "BAPTIST": ("flows.baptist_batch_summary", "BaptistBatchSummaryFlow"),
            "STEWARD": ("flows.steward_batch_summary", "StewardBatchSummaryFlow"),
        }

        mapping = batch_map.get(hospital_type)
        if not mapping:
            logger.warning(f"No batch summary flow for hospital type: {hospital_type}")
            return

        import importlib

        module_name, class_name = mapping
        try:
            module = importlib.import_module(module_name)
        except ImportError:
            logger.warning(
                f"Batch summary flow module not available for {hospital_type}"
            )
            return

        flow_cls = getattr(module, class_name)
        flow = flow_cls()
        creds = self._get_credentials_for(hospital_type)

        # Pass patient_names and hospital_type to the batch flow
        result = flow.run(
            doctor_id=self.doctor_id,
            doctor_name=self.doctor_name,
            credentials=creds,
            doctor_specialty=self.doctor_specialty,
            patient_names=patient_names,
            hospital_type=hospital_type,
        )

        # notify_completion() inside run() already sent data to the backend
        if result:
            found_count = result.get("found_count", 0) if isinstance(result, dict) else 0
            logger.info(
                f"Batch summaries complete for {hospital_type}: "
                f"{found_count}/{len(patient_names)} patients found"
            )
        else:
            logger.info(
                f"Batch summary flow for {hospital_type} completed (no return data)"
            )

    def _extract_batch_insurance(self, hospital_type: str, hospital_config: dict):
        """
        Extract insurance information for all patients in the open EMR session.

        The flow's notify_completion() already sends data to the backend.
        Patient names are passed from the previously extracted patient list.
        """
        logger.info(f"Extracting batch insurance from {hospital_type}...")

        # Get patient names from the patient list extraction
        patient_names = self._last_patient_names.get(hospital_type, [])
        if not patient_names:
            logger.warning(
                f"No patient names available for {hospital_type} batch insurance. "
                "Skipping — patient list may have failed or returned no patients."
            )
            return

        logger.info(
            f"Batch insurance: processing {len(patient_names)} patients for {hospital_type}"
        )

        batch_map = {
            "JACKSON": ("flows.jackson_batch_insurance", "JacksonBatchInsuranceFlow"),
            "BAPTIST": ("flows.baptist_batch_insurance", "BaptistBatchInsuranceFlow"),
            "STEWARD": ("flows.steward_batch_insurance", "StewardBatchInsuranceFlow"),
        }

        mapping = batch_map.get(hospital_type)
        if not mapping:
            logger.warning(
                f"No batch insurance flow for hospital type: {hospital_type}"
            )
            return

        import importlib

        module_name, class_name = mapping
        try:
            module = importlib.import_module(module_name)
        except ImportError:
            logger.warning(
                f"Batch insurance flow module not available for {hospital_type}"
            )
            return

        flow_cls = getattr(module, class_name)
        flow = flow_cls()
        creds = self._get_credentials_for(hospital_type)

        # Pass patient_names and hospital_type to the batch flow
        result = flow.run(
            doctor_id=self.doctor_id,
            doctor_name=self.doctor_name,
            credentials=creds,
            doctor_specialty=self.doctor_specialty,
            patient_names=patient_names,
            hospital_type=hospital_type,
        )

        # notify_completion() inside run() already sent data to the backend
        if result:
            found_count = result.get("found_count", 0) if isinstance(result, dict) else 0
            logger.info(
                f"Batch insurance complete for {hospital_type}: "
                f"{found_count}/{len(patient_names)} patients found"
            )
        else:
            logger.info(
                f"Batch insurance flow for {hospital_type} completed (no return data)"
            )

    def _get_credentials_for(self, hospital_type: str) -> list:
        """Get credentials for a specific hospital type."""
        return [
            c
            for c in self.credentials
            if c.get("systemKey", "").upper() == hospital_type.upper()
        ]

    def _send_to_backend(self, data_type: str, hospital_type: str, payload: dict):
        """Send extracted data to the backend ingestion endpoint."""
        try:
            response = requests.post(
                f"{self.backend_url}/rpa/ingest",
                json={
                    "uuid": self.uuid,
                    "dataType": data_type,
                    "hospitalType": hospital_type,
                    "payload": payload,
                },
                timeout=30,
            )
            if response.status_code in [200, 201]:
                logger.info(f"Data sent: {data_type} for {hospital_type}")
            else:
                logger.error(
                    f"Backend rejected: {response.status_code} — {response.text}"
                )
        except Exception as e:
            logger.error(f"Send error: {e}")

    def _report_error(self, hospital_type: str, error_message: str):
        """Report an error to the backend."""
        try:
            screenshot_url = None
            try:
                from core.s3_client import get_s3_client

                s3 = get_s3_client()
                screenshot_url = s3.take_screenshot()
            except Exception:
                pass

            requests.post(
                f"{self.backend_url}/rpa/error",
                json={
                    "uuid": self.uuid,
                    "hospitalType": hospital_type,
                    "error": error_message,
                    "screenshotUrl": screenshot_url,
                },
                timeout=10,
            )
        except Exception:
            pass
