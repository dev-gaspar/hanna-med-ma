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
import threading
from datetime import datetime
from pathlib import Path

import requests

from core.redis_consumer import RedisConsumer
from caretracker.worker import handle_caretracker_task
from billing.worker import get_billing_worker

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
        self._redis_consumer = None
        self._redis_thread = None
        # Stores patient names per hospital after patient_list extraction
        # Used to pass to batch summary/insurance flows
        self._last_patient_names: dict[str, list[str]] = {}
        # Cached data status per hospital (refreshed once per extraction cycle)
        self._data_status_cache: dict[str, dict] = {}

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

    def start_redis_listener(self):
        """Start Redis listeners in background threads."""
        logger.info("Initializing Redis Consumers...")

        # CareTracker queue (Playwright headless — runs in parallel)
        self._redis_consumer = RedisConsumer()
        def run_caretracker_listener():
            self._redis_consumer.listen("caretracker:tasks", handle_caretracker_task)
        self._redis_thread = threading.Thread(
            target=run_caretracker_listener, daemon=True, name="CareTrackerListener"
        )
        self._redis_thread.start()
        logger.info("CareTracker Redis listener started.")

        # Billing note search queue (enqueues for processing between cycles)
        self._billing_consumer = RedisConsumer()
        billing_worker = get_billing_worker()
        def run_billing_listener():
            self._billing_consumer.listen("billing:note-search", billing_worker.enqueue_task)
        self._billing_thread = threading.Thread(
            target=run_billing_listener, daemon=True, name="BillingNoteListener"
        )
        self._billing_thread.start()
        logger.info("Billing note Redis listener started.")

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
        skip_lab = config.get_rpa_setting("skip_batch_lab", False)

        while not check_should_stop():
            # Refresh config and heartbeat at the start of each cycle
            self._fetch_config()
            self.send_heartbeat()
            self._data_status_cache.clear()

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

                # ──────────────────────────────────────────────────────────
                # UNIFIED FLOW: single login session (login once → list +
                #   summary + insurance → close once)
                # Supported: JACKSON, BAPTIST
                # ──────────────────────────────────────────────────────────
                if hospital_type in ("JACKSON", "BAPTIST"):
                    if not (
                        skip_patient_list
                        and skip_summaries
                        and skip_insurance
                        and skip_lab
                    ):
                        self._run_task(
                            name=f"{hospital_type} unified_batch",
                            fn=self._extract_unified_batch,
                            hospital_type=hospital_type,
                            hospital_config=hospital_config,
                            timeout=task_timeout,
                        )
                else:
                    # OTHER HOSPITALS: keep the legacy 3-task pattern
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

                    # Task 4: Batch Lab
                    if not skip_lab:
                        self._run_task(
                            name=f"{hospital_type} batch_lab",
                            fn=self._extract_batch_lab,
                            hospital_type=hospital_type,
                            hospital_config=hospital_config,
                            timeout=task_timeout,
                        )

                logger.info(f"--- {hospital_type} complete ---")

                # Brief pause between hospitals so the UI fully resets
                if not check_should_stop():
                    time.sleep(5)

            # Process billing note tasks between cycles
            self._process_billing_queue()

            # Wait before next full cycle
            interval = config.get_rpa_setting("extraction_interval_seconds", 3600)
            logger.info(
                f"=== CYCLE COMPLETE — waiting {interval}s before next cycle ==="
            )
            for _ in range(interval):
                if check_should_stop():
                    break
                # Check for new billing tasks during wait
                billing_worker = get_billing_worker()
                if billing_worker.has_pending_tasks():
                    logger.info("[BILLING] New tasks detected during wait, processing...")
                    self._process_billing_queue()
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
                p.get("name", "")
                for p in result
                if isinstance(p, dict) and p.get("name")
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

    def _extract_unified_batch(self, hospital_type: str, hospital_config: dict):
        """
        Single-session extraction: patient list + summary + insurance + lab.

        The unified flow handles everything in one EMR login:
          1. Login → navigate to patient list
          2. Capture census → OCR → send patient_list to backend
          3. For each patient: open detail once → extract summary + insurance + lab
          4. Close EMR → return to VDI

        Supported hospitals: JACKSON, BAPTIST.
        """
        logger.info(f"Unified batch (single session): starting for {hospital_type}")

        if hospital_type == "JACKSON":
            from flows.jackson_unified_batch import JacksonUnifiedBatchFlow

            flow = JacksonUnifiedBatchFlow()
        elif hospital_type == "BAPTIST":
            from flows.baptist_unified_batch import BaptistUnifiedBatchFlow

            flow = BaptistUnifiedBatchFlow()
        else:
            logger.warning(f"No unified batch flow for hospital type: {hospital_type}")
            return

        creds = self._get_credentials_for(hospital_type)

        # Smart extraction: fetch data status for per-patient skip decisions
        data_status = self._get_patient_data_status(hospital_type)

        result = flow.run(
            doctor_id=self.doctor_id,
            doctor_name=self.doctor_name,
            credentials=creds,
            doctor_specialty=self.doctor_specialty,
            hospital_type=hospital_type,
            data_status=data_status,
        )

        if result and isinstance(result, dict):
            census_count = len(result.get("structured_patients", []))
            summary_count = result.get("summary_found_count", 0)
            insurance_count = result.get("insurance_found_count", 0)
            lab_count = result.get("lab_found_count", 0)
            logger.info(
                f"Unified batch complete for {hospital_type}: "
                f"census={census_count}, summaries={summary_count}, "
                f"insurance={insurance_count}, lab={lab_count}"
            )

            # Store patient names in case other code needs them
            if result.get("structured_patients"):
                names = [
                    p.get("name", "")
                    for p in result["structured_patients"]
                    if isinstance(p, dict) and p.get("name")
                ]
                self._last_patient_names[hospital_type] = names
        else:
            logger.info(f"Unified batch for {hospital_type} completed (no return data)")

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

        # Smart extraction: filter patients that already have summaries
        data_status = self._get_patient_data_status(hospital_type)
        patient_names = self._filter_patients(patient_names, data_status, "summary")
        if not patient_names:
            logger.info(f"[SMART] All patients already have summaries for {hospital_type}. Skipping batch.")
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
            found_count = (
                result.get("found_count", 0) if isinstance(result, dict) else 0
            )
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

        # Smart extraction: filter patients that already have insurance
        data_status = self._get_patient_data_status(hospital_type)
        patient_names = self._filter_patients(patient_names, data_status, "insurance")
        if not patient_names:
            logger.info(f"[SMART] All patients already have insurance for {hospital_type}. Skipping batch.")
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
            found_count = (
                result.get("found_count", 0) if isinstance(result, dict) else 0
            )
            logger.info(
                f"Batch insurance complete for {hospital_type}: "
                f"{found_count}/{len(patient_names)} patients found"
            )
        else:
            logger.info(
                f"Batch insurance flow for {hospital_type} completed (no return data)"
            )

    def _extract_batch_lab(self, hospital_type: str, hospital_config: dict):
        """
        Extract lab results for all patients in a batch EMR session.

        The flow's notify_completion() already sends data to the backend.
        Patient names are passed from the previously extracted patient list.
        """
        logger.info(f"Extracting batch lab from {hospital_type}...")

        # Get patient names from the patient list extraction
        patient_names = self._last_patient_names.get(hospital_type, [])
        if not patient_names:
            logger.warning(
                f"No patient names available for {hospital_type} batch lab. "
                "Skipping — patient list may have failed or returned no patients."
            )
            return

        # Smart extraction: filter patients based on lab rules
        data_status = self._get_patient_data_status(hospital_type)
        patient_names = self._filter_patients(patient_names, data_status, "lab")
        if not patient_names:
            logger.info(f"[SMART] All patients already have lab for {hospital_type}. Skipping batch.")
            return

        logger.info(
            f"Batch lab: processing {len(patient_names)} patients for {hospital_type}"
        )

        batch_map = {
            "JACKSON": ("flows.jackson_batch_lab", "JacksonBatchLabFlow"),
            "BAPTIST": ("flows.baptist_batch_lab", "BaptistBatchLabFlow"),
            "STEWARD": ("flows.steward_batch_lab", "StewardBatchLabFlow"),
        }

        mapping = batch_map.get(hospital_type)
        if not mapping:
            logger.warning(f"No batch lab flow for hospital type: {hospital_type}")
            return

        import importlib

        module_name, class_name = mapping
        try:
            module = importlib.import_module(module_name)
        except ImportError:
            logger.warning(f"Batch lab flow module not available for {hospital_type}")
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
            found_count = (
                result.get("found_count", 0) if isinstance(result, dict) else 0
            )
            logger.info(
                f"Batch lab complete for {hospital_type}: "
                f"{found_count}/{len(patient_names)} patients found"
            )
        else:
            logger.info(
                f"Batch lab flow for {hospital_type} completed (no return data)"
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

    def _process_billing_queue(self):
        """Process pending billing note search tasks between extraction cycles."""
        billing_worker = get_billing_worker()
        pending = billing_worker.pending_count()

        if pending == 0:
            return

        logger.info(f"[BILLING] Processing {pending} pending note search task(s)...")

        while billing_worker.has_pending_tasks():
            from core.rpa_engine import check_should_stop

            if check_should_stop():
                break
            billing_worker.process_next_task()

        logger.info("[BILLING] Billing queue processing complete.")

    def _get_patient_data_status(self, hospital_type: str) -> dict:
        """
        Query backend for existing data status of all active patients.
        Cached per hospital per extraction cycle. Falls back to empty dict on error.
        """
        if hospital_type in self._data_status_cache:
            return self._data_status_cache[hospital_type]

        try:
            response = requests.get(
                f"{self.backend_url}/rpa/{self.uuid}/patients/data-status",
                params={"emrSystem": hospital_type},
                timeout=15,
            )
            if response.status_code == 200:
                status = response.json()
                logger.info(
                    f"[SMART] Data status received for {len(status)} patients in {hospital_type}"
                )
                self._data_status_cache[hospital_type] = status
                return status
            else:
                logger.warning(
                    f"[SMART] Backend returned {response.status_code}, falling back to full extraction"
                )
                return {}
        except Exception as e:
            logger.warning(f"[SMART] Could not fetch data status: {e}, falling back to full extraction")
            return {}

    def _filter_patients(
        self, patient_names: list, data_status: dict, data_type: str
    ) -> list:
        """
        Filter patient list based on smart extraction rules.
        data_type: "summary", "insurance", or "lab"
        """
        smart_config = config.get_rpa_setting("smart_extraction", {})
        if not smart_config.get("enabled", False):
            return patient_names

        rule = smart_config.get("rules", {}).get(data_type, "always")

        if rule == "always":
            logger.info(
                f"[SMART] {data_type.capitalize()}: processing all {len(patient_names)} patients (rule: always)"
            )
            return patient_names

        if rule == "if_missing":
            needed = []
            skipped = []
            for name in patient_names:
                patient_status = data_status.get(name, {})
                if patient_status.get(data_type, False):
                    skipped.append(name)
                else:
                    needed.append(name)

            if skipped:
                logger.info(
                    f"[SMART] {data_type.capitalize()}: skipping {len(skipped)} patients "
                    f"(already have data), processing {len(needed)}"
                )
            else:
                logger.info(
                    f"[SMART] {data_type.capitalize()}: processing all {len(needed)} patients "
                    f"(none have data yet)"
                )
            return needed

        logger.warning(f"[SMART] Unknown rule '{rule}' for {data_type}, processing all")
        return patient_names

    def _build_per_patient_skip_flags(
        self, patient_names: list, data_status: dict
    ) -> dict:
        """
        Build per-patient skip flags for unified batch flows.
        Returns: { "PATIENT NAME": { "skip_summary": True, "skip_insurance": False, "skip_lab": False } }
        """
        smart_config = config.get_rpa_setting("smart_extraction", {})
        if not smart_config.get("enabled", False):
            return {}

        rules = smart_config.get("rules", {})
        flags = {}

        for name in patient_names:
            patient_status = data_status.get(name, {})
            patient_flags = {}
            for data_type in ("summary", "insurance", "lab"):
                rule = rules.get(data_type, "always")
                if rule == "if_missing" and patient_status.get(data_type, False):
                    patient_flags[f"skip_{data_type}"] = True
                else:
                    patient_flags[f"skip_{data_type}"] = False
            flags[name] = patient_flags

        skipped_summary = sum(1 for f in flags.values() if f.get("skip_summary"))
        skipped_insurance = sum(1 for f in flags.values() if f.get("skip_insurance"))
        total = len(patient_names)

        if skipped_summary or skipped_insurance:
            logger.info(
                f"[SMART] Per-patient flags: {skipped_summary}/{total} skip summary, "
                f"{skipped_insurance}/{total} skip insurance"
            )

        return flags

    def _report_error(self, hospital_type: str, error_message: str):
        """Report an error to the backend."""
        try:
            screenshot_url = None
            try:
                from core.s3_client import get_s3_client

                s3 = get_s3_client()
                img_buffer = s3.take_screenshot()
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                filename = f"errors/{self.uuid}/{hospital_type}_{timestamp}.png"
                s3.upload_image(img_buffer, filename)
                screenshot_url = s3.generate_presigned_url(filename)
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
