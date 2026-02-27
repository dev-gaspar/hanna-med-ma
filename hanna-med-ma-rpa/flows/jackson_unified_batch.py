"""
Jackson Unified Batch Flow — Single-session extraction.

ONE PowerChart login performs ALL three tasks:
  1. Capture patient list census  (screenshot → OCR → send patient_list)
  2. For each patient, open detail ONCE and extract:
     - Clinical summary  (Notes tree → report → Ctrl+A / Ctrl+C)
     - Insurance info    (More → Insurance Information → Guarantors → copy)
  3. Close PowerChart and return to VDI

Sends THREE payloads to the backend (patient_list, patient_summary,
patient_insurance) so the contract remains 100 % backward-compatible.
"""

from datetime import datetime
from typing import List, Optional

import pyautogui
import pyperclip
import pydirectinput

from config import config
from core.s3_client import get_s3_client
from core.vdi_input import stoppable_sleep
from logger import logger

from .base_flow import BaseFlow
from .jackson import JacksonFlow
from agentic.models import AgentStatus
from agentic.omniparser_client import start_warmup_async
from agentic.runners import JacksonSummaryRunner


class JacksonUnifiedBatchFlow(BaseFlow):
    """
    Fully unified Jackson flow — login once, do everything, close once.

    Flow:
      1. Navigate to patient list  (login → steps 1-8)
      2. Capture patient list screenshots → OCR + LLM → structured patients
      3. Send patient_list payload to backend
      4. Enter fullscreen
      5. For each patient:
         a. Find patient and navigate to report  (JacksonSummaryRunner)
         b. Extract summary content              (Ctrl+A / Ctrl+C)
         c. Extract insurance                    (More → Insurance Info → Guarantors → copy → Alt+F4)
         d. Close patient detail → return to list (Alt+F4 + patience wait)
      6. Exit fullscreen
      7. Cleanup  (close EMR, return to VDI)
    """

    FLOW_NAME = "Jackson Unified Batch"
    FLOW_TYPE = "jackson_unified_batch"
    EMR_TYPE = "JACKSON"

    def __init__(self):
        super().__init__()
        self._jackson_flow = JacksonFlow()
        self._patient_detail_open = False
        self._insurance_window_open = False
        self.patient_names: List[str] = []
        self.structured_patients: list = []
        self.hospital_type: str = ""
        self.doctor_specialty: Optional[str] = None
        self.summary_results: List[dict] = []
        self.insurance_results: List[dict] = []
        self.s3_client = get_s3_client()

    # ------------------------------------------------------------------
    # Setup
    # ------------------------------------------------------------------

    def setup(
        self,
        doctor_id=None,
        doctor_name=None,
        credentials=None,
        patient_names=None,
        hospital_type=None,
        doctor_specialty=None,
        **kwargs,
    ):
        """Setup flow with execution context."""
        super().setup(
            doctor_id=doctor_id,
            doctor_name=doctor_name,
            credentials=credentials,
            **kwargs,
        )
        self.patient_names = patient_names or []
        self.structured_patients = []
        self.hospital_type = hospital_type or "JACKSON"
        self.doctor_specialty = doctor_specialty
        self.summary_results = []
        self.insurance_results = []

        # Also setup the internal Jackson flow reference
        self._jackson_flow.setup(
            doctor_id=self.doctor_id,
            doctor_name=self.doctor_name,
            credentials=self.credentials,
        )
        if doctor_specialty:
            logger.info(f"[JACKSON-UNIFIED] Doctor specialty: {doctor_specialty}")

    # ------------------------------------------------------------------
    # Execute
    # ------------------------------------------------------------------

    def execute(self):
        """
        Main execution — ONE login, patient list + summary + insurance.
        """
        logger.info("=" * 70)
        logger.info(" JACKSON UNIFIED BATCH - STARTING (single session)")
        logger.info("=" * 70)

        # Phase 1: Navigate to patient list (login once — steps 1-8)
        if not self._navigate_to_patient_list():
            logger.error("[JACKSON-UNIFIED] Failed to navigate to patient list")
            return {
                "structured_patients": [],
                "summary_patients": [],
                "insurance_patients": [],
                "hospital": self.hospital_type,
                "error": "Navigation failed",
            }

        # Phase 2: Capture patient list census
        logger.info("[JACKSON-UNIFIED] Phase 2 — Capturing patient list census...")
        self.structured_patients = self._capture_patient_list()
        patient_count = len(self.structured_patients)
        logger.info(f"[JACKSON-UNIFIED] Census captured: {patient_count} patient(s)")

        # Send patient_list payload to backend immediately
        self._send_patient_list_to_backend(self.structured_patients)

        # Derive patient names for batch processing
        if not self.patient_names:
            self.patient_names = [
                p.get("name", "")
                for p in self.structured_patients
                if isinstance(p, dict) and p.get("name")
            ]
            logger.info(
                f"[JACKSON-UNIFIED] Extracted {len(self.patient_names)} patient "
                "name(s) from census"
            )

        if not self.patient_names:
            logger.warning("[JACKSON-UNIFIED] No patients to process — cleaning up")
            self._click_normalscreen()
            stoppable_sleep(3)
            self._cleanup()
            return {
                "structured_patients": self.structured_patients,
                "summary_patients": [],
                "insurance_patients": [],
                "hospital": self.hospital_type,
            }

        logger.info(
            f"[JACKSON-UNIFIED] Phase 3 — Processing {len(self.patient_names)} "
            "patient(s) for summary + insurance"
        )

        # Already in fullscreen from patient list capture — proceed directly

        # Phase 3: Process each patient (summary + insurance)
        total = len(self.patient_names)
        for idx, patient in enumerate(self.patient_names, 1):
            is_last = idx == total

            logger.info(
                f"[JACKSON-UNIFIED] Processing patient {idx}/{total}: {patient}"
            )

            summary_content = None
            insurance_content = None
            patient_found = False

            try:
                # Step A: Find patient + navigate to report
                runner_result = self._find_patient_and_report(patient)

                if runner_result.status == AgentStatus.FINISHED:
                    # Report found — extract summary then insurance
                    patient_found = True
                    self._patient_detail_open = True

                    # Step B: Extract summary
                    summary_content = self._extract_summary()
                    logger.info(f"[JACKSON-UNIFIED] Summary extracted for {patient}")

                    # Step C: Extract insurance
                    try:
                        insurance_content = self._extract_insurance()
                        logger.info(
                            f"[JACKSON-UNIFIED] Insurance extracted for {patient}"
                        )
                    except Exception as ins_err:
                        logger.error(
                            f"[JACKSON-UNIFIED] Insurance failed for {patient}: {ins_err}"
                        )
                        self._safe_close_insurance_window()

                    # Step D: Return to patient list
                    if not is_last:
                        self._return_to_patient_list()
                    else:
                        self._patient_detail_open = True
                        logger.info(
                            "[JACKSON-UNIFIED] Last patient — detail stays open for cleanup"
                        )

                elif runner_result.patient_detail_open:
                    # Patient detail open but report not found — still try insurance
                    patient_found = True
                    self._patient_detail_open = True
                    logger.warning(
                        f"[JACKSON-UNIFIED] Report not found for {patient}, "
                        "trying insurance anyway..."
                    )

                    try:
                        insurance_content = self._extract_insurance()
                        logger.info(
                            f"[JACKSON-UNIFIED] Insurance extracted for {patient} "
                            "(no summary)"
                        )
                    except Exception as ins_err:
                        logger.error(
                            f"[JACKSON-UNIFIED] Insurance also failed for {patient}: "
                            f"{ins_err}"
                        )
                        self._safe_close_insurance_window()

                    if not is_last:
                        self._return_to_patient_list()
                    else:
                        self._patient_detail_open = True

                else:
                    # Patient not found in list
                    logger.warning(f"[JACKSON-UNIFIED] Patient not found: {patient}")

            except Exception as e:
                logger.error(f"[JACKSON-UNIFIED] Error processing {patient}: {str(e)}")
                if self._patient_detail_open:
                    self._close_patient_detail()

            # Record results
            self.summary_results.append(
                {
                    "patient": patient,
                    "found": patient_found,
                    "content": summary_content,
                }
            )
            self.insurance_results.append(
                {
                    "patient": patient,
                    "found": patient_found,
                    "content": insurance_content,
                }
            )

        # Exit fullscreen before cleanup
        logger.info("[JACKSON-UNIFIED] Exiting fullscreen mode...")
        self._click_normalscreen()
        stoppable_sleep(3)

        # Phase 4: Cleanup (close EMR, return to VDI)
        logger.info("[JACKSON-UNIFIED] Cleanup phase")
        self._cleanup()

        summary_ok = sum(1 for r in self.summary_results if r.get("content"))
        insurance_ok = sum(1 for r in self.insurance_results if r.get("content"))

        logger.info("=" * 70)
        logger.info(" JACKSON UNIFIED BATCH - COMPLETE")
        logger.info(f" Census: {patient_count} patient(s)")
        logger.info(f" Processed: {total} patient(s)")
        logger.info(f" Summaries extracted: {summary_ok}")
        logger.info(f" Insurance extracted: {insurance_ok}")
        logger.info("=" * 70)

        return {
            "structured_patients": self.structured_patients,
            "summary_patients": self.summary_results,
            "insurance_patients": self.insurance_results,
            "hospital": self.hospital_type,
            "total": total,
            "summary_found_count": sum(
                1 for r in self.summary_results if r.get("found")
            ),
            "insurance_found_count": sum(
                1 for r in self.insurance_results if r.get("found")
            ),
        }

    # ------------------------------------------------------------------
    # Navigation  (from JacksonBatchSummaryFlow)
    # ------------------------------------------------------------------

    def _navigate_to_patient_list(self) -> bool:
        """Navigate to Jackson patient list. Reuses JacksonFlow steps 1-8."""
        self.set_step("NAVIGATE_TO_PATIENT_LIST")
        logger.info("[JACKSON-UNIFIED] Navigating to patient list...")

        try:
            start_warmup_async()

            self._jackson_flow.step_1_tab()
            self._jackson_flow.step_2_powered()
            self._jackson_flow.step_3_open_download()
            self._jackson_flow.step_4_username()
            self._jackson_flow.step_5_password()
            self._jackson_flow.step_6_login_ok()
            self._handle_info_modal_after_login()
            self._jackson_flow.step_7_patient_list()
            self._jackson_flow.step_8_hospital_tab()

            stoppable_sleep(3)
            logger.info("[JACKSON-UNIFIED] Patient list visible")
            return True

        except Exception as e:
            logger.error(f"[JACKSON-UNIFIED] Navigation failed: {e}")
            return False

    def _handle_info_modal_after_login(self):
        """Handle info modal that may appear after login."""
        info_modal = self.wait_for_element(
            config.get_rpa_setting("images.jackson_info_modal"),
            timeout=3,
            description="Info Modal",
        )
        if info_modal:
            logger.info("[JACKSON-UNIFIED] Info modal detected - dismissing")
            pydirectinput.press("enter")
            stoppable_sleep(2)

    # ------------------------------------------------------------------
    # Patient List Capture  (replaces separate JacksonFlow execution)
    # ------------------------------------------------------------------

    def _capture_patient_list(self) -> list:
        """
        Capture patient list census from the currently-visible patient list.

        Replicates JacksonFlow.step_9_capture() + _extract_patients_from_screenshots()
        but WITHOUT closing Cerner or navigating away — the session stays open
        for batch processing afterwards.

        Returns:
            List of structured patient dicts [{name, location, reason, admittedDate}]
        """
        self.set_step("CAPTURE_PATIENT_LIST")
        logger.info("[JACKSON-UNIFIED] Capturing patient list census...")

        # Enter fullscreen for ROI screenshot
        if not self._click_fullscreen():
            raise Exception("Failed to enter fullscreen mode for patient list capture")
        stoppable_sleep(3)

        # Load ROIs from config
        rois = self._get_rois("patient_finder")

        # Capture screenshot with ROI mask (no enhancement for Jackson)
        screenshot_data = self.s3_client.capture_screenshot_with_processing(
            "South Florida Foot And Ankle Institut",
            "Hospital_1",
            1,
            self.doctor_id or "unknown",
            rois=rois,
            enhance=False,
        )

        # Stay in fullscreen — batch patient processing continues here

        # Extract structured patients from screenshot via OCR + LLM
        structured_patients = self._extract_patients_from_screenshots([screenshot_data])

        logger.info(
            f"[JACKSON-UNIFIED] Census: {len(structured_patients)} patient(s) extracted"
        )
        return structured_patients

    def _send_patient_list_to_backend(self, structured_patients: list):
        """
        Send patient_list payload to backend — identical to JacksonFlow.notify_completion().
        """
        payload = {
            "status": "completed",
            "type": "jackson_health_patient_list_capture",
            "total_patients": len(structured_patients),
            "patients": structured_patients,
            "timestamp": datetime.now().strftime("%Y%m%d_%H%M%S"),
            "doctor_name": self.doctor_name,
        }
        logger.info(
            f"[JACKSON-UNIFIED] Sending patient_list to backend "
            f"({len(structured_patients)} patient(s))..."
        )
        response = self._send_to_list_webhook_n8n(payload)
        if response:
            logger.info(
                f"[JACKSON-UNIFIED] patient_list backend response: {response.status_code}"
            )
        else:
            logger.error("[JACKSON-UNIFIED] Failed to send patient_list to backend")

    # ------------------------------------------------------------------
    # Patient Finding  (from JacksonBatchSummaryFlow — uses SummaryRunner)
    # ------------------------------------------------------------------

    def _find_patient_and_report(self, patient_name: str):
        """
        Find patient in the list and navigate to their clinical report.

        Uses JacksonSummaryRunner which chains:
          PatientFinder → open patient + Notes → ReportFinder
        """
        self.set_step(f"FIND_PATIENT_{patient_name}")
        logger.info(f"[JACKSON-UNIFIED] Finding patient: {patient_name}")

        runner = JacksonSummaryRunner(
            max_steps=30,
            step_delay=1.0,
            doctor_specialty=self.doctor_specialty,
        )

        result = runner.run(patient_name=patient_name)
        self._patient_detail_open = result.patient_detail_open

        if result.status == AgentStatus.PATIENT_NOT_FOUND:
            logger.warning(f"[JACKSON-UNIFIED] Patient not found: {patient_name}")
        elif result.status == AgentStatus.FINISHED:
            logger.info(
                f"[JACKSON-UNIFIED] Patient found in {result.steps_taken} steps"
            )
            stoppable_sleep(2)
        else:
            error_msg = result.error or "Agent did not find the report"
            logger.error(
                f"[JACKSON-UNIFIED] Agent error for {patient_name}: {error_msg}"
            )
            if self._patient_detail_open:
                logger.info(
                    "[JACKSON-UNIFIED] Patient detail open — will try insurance"
                )

        return result

    # ------------------------------------------------------------------
    # Summary Extraction  (from JacksonBatchSummaryFlow.extract_content)
    # ------------------------------------------------------------------

    def _extract_summary(self) -> str:
        """Extract content from the current patient's report (Ctrl+A, Ctrl+C)."""
        self.set_step("EXTRACT_SUMMARY")
        logger.info("[JACKSON-UNIFIED] Extracting summary content...")

        stoppable_sleep(2)

        # Click on report document area
        report_element = self.wait_for_element(
            config.get_rpa_setting("images.jackson_report_document"),
            timeout=10,
            description="Report Document",
        )
        if report_element:
            self.safe_click(report_element, "Report Document")
        else:
            screen_w, screen_h = pyautogui.size()
            pyautogui.click(screen_w // 2, screen_h // 2)
        stoppable_sleep(0.5)

        # Clear clipboard
        pyperclip.copy("")
        stoppable_sleep(0.3)

        # Select all
        pydirectinput.keyDown("ctrl")
        stoppable_sleep(0.1)
        pydirectinput.press("a")
        stoppable_sleep(0.1)
        pydirectinput.keyUp("ctrl")
        stoppable_sleep(0.5)

        # Copy
        pydirectinput.keyDown("ctrl")
        stoppable_sleep(0.1)
        pydirectinput.press("c")
        stoppable_sleep(0.1)
        pydirectinput.keyUp("ctrl")
        stoppable_sleep(0.5)

        content = pyperclip.paste()

        if content and len(content) > 50:
            logger.info(f"[JACKSON-UNIFIED] Summary: {len(content)} characters")
        else:
            logger.warning("[JACKSON-UNIFIED] Summary content seems too short")

        return content or ""

    # ------------------------------------------------------------------
    # Insurance Extraction  (from JacksonBatchInsuranceFlow._extract_insurance)
    # ------------------------------------------------------------------

    def _extract_insurance(self) -> str:
        """
        Extract insurance content from Guarantors tab.

        Steps:
          1. Click 'More' button
          2. Click 'Insurance Information'  → separate window opens
          3. Click 'Guarantors' tab
          4. Ctrl+A / Ctrl+C to copy content
          5. Alt+F4 to close insurance window  → back to patient detail
        """
        self.set_step("EXTRACT_INSURANCE")
        logger.info("[JACKSON-UNIFIED] Extracting insurance content...")

        # Step 1: Click More
        logger.info("[JACKSON-UNIFIED] Clicking 'More' button...")
        more_img = config.get_rpa_setting("images.jackson_more")
        location = self.wait_for_element(
            more_img,
            timeout=10,
            confidence=0.8,
            description="More button",
        )
        if not location:
            more_alt_img = config.get_rpa_setting("images.jackson_more_alt")
            if more_alt_img:
                logger.info("[JACKSON-UNIFIED] Trying alternate 'More' button image...")
                location = self.wait_for_element(
                    more_alt_img,
                    timeout=10,
                    confidence=0.8,
                    description="More button (alt)",
                )
        if not location:
            raise Exception("More button not found")
        self.safe_click(location, "More button")
        stoppable_sleep(2)

        # Step 2: Click Insurance Information  →  NEW WINDOW opens after this
        logger.info("[JACKSON-UNIFIED] Clicking 'Insurance Information'...")
        ins_img = config.get_rpa_setting("images.jackson_insurance_information")
        location = self.wait_for_element(
            ins_img,
            timeout=10,
            confidence=0.8,
            description="Insurance Information",
        )
        if not location:
            ins_alt = config.get_rpa_setting("images.jackson_insurance_information_alt")
            if ins_alt:
                logger.info(
                    "[JACKSON-UNIFIED] Trying alternate 'Insurance Information' image..."
                )
                location = self.wait_for_element(
                    ins_alt,
                    timeout=10,
                    confidence=0.8,
                    description="Insurance Information (alt)",
                )
        if not location:
            raise Exception("Insurance Information not found")
        self.safe_click(location, "Insurance Information")
        stoppable_sleep(4)
        self._insurance_window_open = True  # Track: insurance window is now open

        # Step 3: Click Guarantors
        logger.info("[JACKSON-UNIFIED] Clicking 'Guarantors' tab...")
        guar_img = config.get_rpa_setting("images.jackson_insurance_guarantors")
        location = self.wait_for_element(
            guar_img,
            timeout=15,
            confidence=0.8,
            description="Guarantors tab",
        )
        if not location:
            guar_alt = config.get_rpa_setting("images.jackson_insurance_guarantors_alt")
            if guar_alt:
                logger.info("[JACKSON-UNIFIED] Trying alternate 'Guarantors' image...")
                location = self.wait_for_element(
                    guar_alt,
                    timeout=10,
                    confidence=0.8,
                    description="Guarantors tab (alt)",
                )
        if not location:
            raise Exception("Guarantors tab not found")
        self.safe_click(location, "Guarantors tab")
        stoppable_sleep(2)

        # Step 4: Select All and Copy
        logger.info("[JACKSON-UNIFIED] Copying insurance content...")
        pyperclip.copy("")
        stoppable_sleep(0.3)

        pydirectinput.keyDown("ctrl")
        stoppable_sleep(0.1)
        pydirectinput.press("a")
        stoppable_sleep(0.1)
        pydirectinput.keyUp("ctrl")
        stoppable_sleep(0.5)

        pydirectinput.keyDown("ctrl")
        stoppable_sleep(0.1)
        pydirectinput.press("c")
        stoppable_sleep(0.1)
        pydirectinput.keyUp("ctrl")
        stoppable_sleep(0.5)

        content = pyperclip.paste()
        logger.info(f"[JACKSON-UNIFIED] Insurance: {len(content)} characters")

        # Step 5: Close insurance window (Alt+F4) → back to patient detail
        logger.info("[JACKSON-UNIFIED] Closing insurance window (Alt+F4)...")
        pydirectinput.keyDown("alt")
        stoppable_sleep(0.1)
        pydirectinput.press("f4")
        stoppable_sleep(0.1)
        pydirectinput.keyUp("alt")
        stoppable_sleep(2)
        self._insurance_window_open = False

        return content or ""

    def _safe_close_insurance_window(self):
        """Close insurance window if it was left open after an error."""
        if self._insurance_window_open:
            logger.info(
                "[JACKSON-UNIFIED] Closing orphaned insurance window (Alt+F4)..."
            )
            pydirectinput.keyDown("alt")
            stoppable_sleep(0.1)
            pydirectinput.press("f4")
            stoppable_sleep(0.1)
            pydirectinput.keyUp("alt")
            stoppable_sleep(2)
            self._insurance_window_open = False

    # ------------------------------------------------------------------
    # Return to Patient List  (from JacksonBatchSummaryFlow)
    # ------------------------------------------------------------------

    def _return_to_patient_list(self):
        """
        Close patient detail and return to patient list.
        Uses Alt+F4 + conservative patience wait.
        Does NOT retry Alt+F4 to avoid race conditions.
        """
        self.set_step("RETURN_TO_PATIENT_LIST")
        logger.info("[JACKSON-UNIFIED] Returning to patient list...")

        screen_w, screen_h = pyautogui.size()
        pyautogui.click(screen_w // 2, screen_h // 2)
        stoppable_sleep(0.5)

        # Close patient detail with Alt+F4
        logger.info("[JACKSON-UNIFIED] Sending Alt+F4 to close patient detail...")
        pydirectinput.keyDown("alt")
        stoppable_sleep(0.1)
        pydirectinput.press("f4")
        stoppable_sleep(0.1)
        pydirectinput.keyUp("alt")

        # Wait for system to process the close
        logger.info("[JACKSON-UNIFIED] Waiting 15s for system to process close...")
        stoppable_sleep(15)

        patient_list_header_img = config.get_rpa_setting(
            "images.jackson_patient_list_header"
        )

        header_found = self._wait_for_patient_list_with_patience(
            patient_list_header_img,
            max_attempts=3,
            attempt_timeout=15,
        )

        if header_found:
            logger.info("[JACKSON-UNIFIED] OK — Patient list confirmed")
        else:
            logger.warning(
                "[JACKSON-UNIFIED] Patient list header not detected after patience "
                "wait. Continuing anyway to avoid race condition."
            )

        self._patient_detail_open = False
        logger.info("[JACKSON-UNIFIED] Back at patient list")

    def _close_patient_detail(self):
        """Close patient detail window (Alt+F4) — error recovery helper."""
        screen_w, screen_h = pyautogui.size()
        pyautogui.click(screen_w // 2, screen_h // 2)
        stoppable_sleep(0.5)

        pydirectinput.keyDown("alt")
        stoppable_sleep(0.1)
        pydirectinput.press("f4")
        stoppable_sleep(0.1)
        pydirectinput.keyUp("alt")

        stoppable_sleep(15)
        self._patient_detail_open = False
        logger.info("[JACKSON-UNIFIED] Patient detail closed")

    # ------------------------------------------------------------------
    # Cleanup  (from JacksonBatchSummaryFlow)
    # ------------------------------------------------------------------

    def _cleanup(self):
        """Close Jackson EMR session completely and return to VDI lobby."""
        self.set_step("CLEANUP")
        logger.info("[JACKSON-UNIFIED] Cleanup — closing EMR...")

        screen_w, screen_h = pyautogui.size()

        # If patient detail is still open (last patient), close it first
        if self._patient_detail_open:
            logger.info("[JACKSON-UNIFIED] Closing last patient detail...")
            pyautogui.click(screen_w // 2, screen_h // 2)
            stoppable_sleep(0.5)

            pydirectinput.keyDown("alt")
            stoppable_sleep(0.1)
            pydirectinput.press("f4")
            stoppable_sleep(0.1)
            pydirectinput.keyUp("alt")

            stoppable_sleep(5)
            self._patient_detail_open = False

        # Close the patient list / Jackson main window
        logger.info("[JACKSON-UNIFIED] Closing Jackson main window...")
        pyautogui.click(screen_w // 2, screen_h // 2)
        stoppable_sleep(0.5)

        pydirectinput.keyDown("alt")
        stoppable_sleep(0.1)
        pydirectinput.press("f4")
        stoppable_sleep(0.1)
        pydirectinput.keyUp("alt")

        stoppable_sleep(3)

        # Navigate to VDI desktop
        self._jackson_flow.step_11_vdi_tab()

        # Verify we're back at the lobby
        self.verify_lobby()

        logger.info("[JACKSON-UNIFIED] Cleanup complete")

    # ------------------------------------------------------------------
    # Backend Notification
    # ------------------------------------------------------------------

    def notify_completion(self, result):
        """
        Send summary + insurance payloads to the backend.

        patient_list was already sent during execute() right after capture,
        so we only send the batch results here.
        """
        # 1. Summary payload
        summary_payload = {
            "status": "completed",
            "type": f"batch_{self.hospital_type.lower()}_summary",
            "doctor_name": self.doctor_name,
            "doctor_specialty": self.doctor_specialty,
            "hospital": self.hospital_type,
            "patients": result.get("summary_patients", []),
            "total": result.get("total", 0),
            "found_count": result.get("summary_found_count", 0),
        }
        logger.info("[JACKSON-UNIFIED] Sending summary results to backend...")
        resp = self._send_to_summary_webhook_n8n(summary_payload)
        if resp:
            logger.info(
                f"[JACKSON-UNIFIED] Summary backend response: {resp.status_code}"
            )
        else:
            logger.error("[JACKSON-UNIFIED] Failed to send summary to backend")

        # 2. Insurance payload
        insurance_payload = {
            "status": "completed",
            "type": "jackson_batch_insurance",
            "doctor_name": self.doctor_name,
            "hospital": self.hospital_type,
            "patients": result.get("insurance_patients", []),
            "total": result.get("total", 0),
            "found_count": result.get("insurance_found_count", 0),
            "timestamp": datetime.now().strftime("%Y%m%d_%H%M%S"),
        }
        logger.info("[JACKSON-UNIFIED] Sending insurance results to backend...")
        resp = self._send_to_batch_insurance_webhook_n8n(insurance_payload)
        if resp:
            logger.info(
                f"[JACKSON-UNIFIED] Insurance backend response: {resp.status_code}"
            )
        else:
            logger.error("[JACKSON-UNIFIED] Failed to send insurance to backend")
