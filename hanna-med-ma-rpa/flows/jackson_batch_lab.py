"""
Jackson Batch Lab Flow - Batch patient lab results extraction for Jackson Health.

Processes multiple patients in a single EMR session, extracting lab results
via Results Review > Print to PDF > extract text.
Uses JacksonInsuranceRunner for patient finding.
"""

import os
from datetime import datetime
from typing import List, Optional

import pyautogui
import pydirectinput

from config import config
from core.vdi_input import stoppable_sleep
from logger import logger

from .base_flow import BaseFlow
from .jackson import JacksonFlow
from agentic.models import AgentStatus
from agentic.omniparser_client import start_warmup_async
from agentic.runners import JacksonInsuranceRunner


class JacksonBatchLabFlow(BaseFlow):
    """
    Batch lab flow for Jackson Health.

    Keeps the Jackson EMR session open in FULLSCREEN mode while processing
    multiple patients, extracting lab results from Results Review,
    returning consolidated results.

    Flow:
    1. Navigate to patient list
    2. Enter fullscreen mode (better for agentic vision)
    3. For each patient:
       - Find patient and open patient detail (agentic)
       - Click Results Review, unpin menu, select Labs Group
       - Print to PDF, extract text
       - Re-open menu and pin it
       - Alt+F4 to close patient detail (wait for patient list header)
    4. Exit fullscreen mode
    5. Cleanup (close EMR, return to VDI)
    """

    FLOW_NAME = "Jackson Batch Lab"
    FLOW_TYPE = "jackson_batch_lab"
    EMR_TYPE = "jackson"

    PDF_FILENAME = "lab jackson.pdf"

    def __init__(self):
        super().__init__()
        self._jackson_flow = JacksonFlow()
        self._patient_detail_open = False
        self.patient_names: List[str] = []
        self.hospital_type: str = ""
        self.current_patient: Optional[str] = None
        self.current_content: Optional[str] = None
        self.results: List[dict] = []

    def setup(
        self,
        doctor_id=None,
        doctor_name=None,
        credentials=None,
        patient_names=None,
        hospital_type=None,
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
        self.hospital_type = hospital_type or "JACKSON"
        self.results = []

        self._jackson_flow.setup(
            doctor_id=self.doctor_id,
            doctor_name=self.doctor_name,
            credentials=self.credentials,
        )

        logger.info(f"[JACKSON-BATCH-LAB] Setup for {len(self.patient_names)} patients")

    def execute(self):
        """
        Execute batch lab extraction.

        1. Navigate to patient list (once)
        2. Enter fullscreen mode
        3. For each patient: find, extract lab, return to list
        4. Exit fullscreen mode (only at the end)
        5. Cleanup (once)
        """
        logger.info("=" * 70)
        logger.info(" JACKSON BATCH LAB - STARTING")
        logger.info("=" * 70)
        logger.info(f"[JACKSON-BATCH-LAB] Patients to process: {self.patient_names}")
        logger.info("=" * 70)

        # Phase 1: Navigate to patient list (once)
        if not self._navigate_to_patient_list():
            logger.error("[JACKSON-BATCH-LAB] Failed to navigate to patient list")
            return {
                "patients": [],
                "hospital": self.hospital_type,
                "error": "Navigation failed",
            }

        # Enter fullscreen mode
        logger.info("[JACKSON-BATCH-LAB] Entering fullscreen mode...")
        self._click_fullscreen()

        # Phase 2: Process each patient
        total_patients = len(self.patient_names)
        for idx, patient in enumerate(self.patient_names, 1):
            self.current_patient = patient
            self.current_content = None

            logger.info(
                f"[JACKSON-BATCH-LAB] Processing patient {idx}/{total_patients}: {patient}"
            )

            try:
                found = self._find_patient(patient)

                if found:
                    self.current_content = self._extract_lab()
                    logger.info(f"[JACKSON-BATCH-LAB] Extracted lab for {patient}")

                    # Return to patient list
                    self._return_to_patient_list()
                else:
                    logger.warning(f"[JACKSON-BATCH-LAB] Patient not found: {patient}")

                self.results.append(
                    {
                        "patient": patient,
                        "found": found,
                        "content": self.current_content,
                    }
                )

            except Exception as e:
                logger.error(
                    f"[JACKSON-BATCH-LAB] Error processing {patient}: {str(e)}"
                )
                self.results.append(
                    {
                        "patient": patient,
                        "found": False,
                        "content": None,
                        "error": str(e),
                    }
                )
                if self._patient_detail_open:
                    self._close_patient_detail()

        # Exit fullscreen before cleanup
        logger.info("[JACKSON-BATCH-LAB] Exiting fullscreen mode...")
        self._click_normalscreen()
        stoppable_sleep(3)

        # Phase 3: Cleanup
        logger.info("[JACKSON-BATCH-LAB] Cleanup phase")
        self._cleanup()

        logger.info("=" * 70)
        logger.info(" JACKSON BATCH LAB - COMPLETE")
        logger.info(f" Processed: {total_patients} patients")
        logger.info(f" Found: {sum(1 for r in self.results if r.get('found'))}")
        logger.info("=" * 70)

        return {
            "patients": self.results,
            "hospital": self.hospital_type,
            "total": len(self.patient_names),
            "found_count": sum(1 for r in self.results if r.get("found")),
        }

    # ------------------------------------------------------------------
    # Navigation
    # ------------------------------------------------------------------

    def _navigate_to_patient_list(self) -> bool:
        """Navigate to Jackson patient list. Reuses JacksonFlow steps 1-8."""
        self.set_step("NAVIGATE_TO_PATIENT_LIST")
        logger.info("[JACKSON-BATCH-LAB] Navigating to patient list...")

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
            logger.info("[JACKSON-BATCH-LAB] Patient list visible")
            return True

        except Exception as e:
            logger.error(f"[JACKSON-BATCH-LAB] Navigation failed: {e}")
            return False

    def _handle_info_modal_after_login(self):
        """Handle info modal that may appear after login."""
        info_modal = self.wait_for_element(
            config.get_rpa_setting("images.jackson_info_modal"),
            timeout=3,
            description="Info Modal",
        )

        if info_modal:
            logger.info("[JACKSON-BATCH-LAB] Info modal detected - dismissing")
            pydirectinput.press("enter")
            stoppable_sleep(2)

    # ------------------------------------------------------------------
    # Patient Finding
    # ------------------------------------------------------------------

    def _find_patient(self, patient_name: str) -> bool:
        """
        Find a patient using the JacksonInsuranceRunner.

        Returns:
            True if patient found and clicked, False otherwise.
        """
        self.set_step(f"FIND_PATIENT_{patient_name}")
        logger.info(f"[JACKSON-BATCH-LAB] Finding patient: {patient_name}")

        runner = JacksonInsuranceRunner(
            max_steps=15,
            step_delay=1.0,
        )

        result = runner.run(patient_name=patient_name)

        self._patient_detail_open = getattr(result, "patient_detail_open", False)

        if result.status == AgentStatus.PATIENT_NOT_FOUND:
            logger.warning(f"[JACKSON-BATCH-LAB] Patient not found: {patient_name}")
            return False

        if result.status != AgentStatus.FINISHED:
            error_msg = result.error or "Agent did not complete"
            logger.error(
                f"[JACKSON-BATCH-LAB] Agent error for {patient_name}: {error_msg}"
            )
            if self._patient_detail_open:
                logger.info("[JACKSON-BATCH-LAB] Closing patient detail after error...")
                self._close_patient_detail()
            return False

        self._patient_detail_open = True
        logger.info(f"[JACKSON-BATCH-LAB] Patient found in {result.steps_taken} steps")
        stoppable_sleep(2)
        return True

    # ------------------------------------------------------------------
    # Lab Extraction
    # ------------------------------------------------------------------

    def _extract_lab(self) -> str:
        """
        Extract lab results via Results Review → Print to PDF → extract text.

        Steps:
        1. Click 'Results Review'
        2. Unpin menu
        3. Click 'Labs Group' radiobutton (if visible)
        4. Click Print button
        5. Press Enter, click 'Lab Jackson'
        6. Enter → Left arrow → Enter (confirm save/replace)
        7. Extract text from PDF
        8. Re-open menu and pin it
        """
        self.set_step("EXTRACT_LAB")
        logger.info(f"[JACKSON-BATCH-LAB] Extracting lab for: {self.current_patient}")

        # Step 1: Click Results Review
        logger.info("[JACKSON-BATCH-LAB] Step 1: Clicking 'Results Review'...")
        results_review_img = config.get_rpa_setting("images.jackson_results_review")
        location = self.wait_for_element(
            results_review_img,
            timeout=10,
            confidence=0.8,
            description="Results Review",
        )
        if not location:
            raise Exception("Results Review button not found")
        self.safe_click(location, "Results Review")
        stoppable_sleep(2)

        # Step 2: Unpin menu
        logger.info("[JACKSON-BATCH-LAB] Step 2: Unpinning menu...")
        unpin_img = config.get_rpa_setting("images.jackson_unpin_menu")
        location = self.wait_for_element(
            unpin_img,
            timeout=10,
            confidence=0.8,
            description="Unpin Menu",
        )
        if not location:
            raise Exception("Unpin menu button not found")
        self.safe_click(location, "Unpin Menu")
        stoppable_sleep(2)

        # Step 3: Click Labs Group radiobutton (if visible)
        logger.info("[JACKSON-BATCH-LAB] Step 3: Looking for 'Labs Group'...")
        labs_group_img = config.get_rpa_setting("images.jackson_labs_group")
        location = self.wait_for_element(
            labs_group_img,
            timeout=5,
            confidence=0.8,
            description="Labs Group",
        )
        if location:
            logger.info("[JACKSON-BATCH-LAB] Labs Group found - clicking...")
            self.safe_click(location, "Labs Group")
            stoppable_sleep(2)
        else:
            logger.info(
                "[JACKSON-BATCH-LAB] Labs Group not visible - already in correct view"
            )

        # Step 4: Click Print button
        logger.info("[JACKSON-BATCH-LAB] Step 4: Clicking Print button...")
        print_img = config.get_rpa_setting("images.jackson_print")
        location = self.wait_for_element(
            print_img,
            timeout=10,
            confidence=0.8,
            description="Print button",
        )
        if not location:
            raise Exception("Print button not found")
        self.safe_click(location, "Print button")
        stoppable_sleep(2)

        # Step 5: Press Enter, then click 'Lab Jackson'
        logger.info("[JACKSON-BATCH-LAB] Step 5: Confirming print dialog...")
        pydirectinput.press("enter")
        stoppable_sleep(2)

        logger.info("[JACKSON-BATCH-LAB] Step 5b: Clicking 'Lab Jackson' file...")
        lab_jackson_img = config.get_rpa_setting("images.jackson_lab_jackson")
        location = self.wait_for_element(
            lab_jackson_img,
            timeout=10,
            confidence=0.8,
            description="Lab Jackson file",
        )
        if not location:
            raise Exception("Lab Jackson file not found")
        self.safe_click(location, "Lab Jackson file")
        stoppable_sleep(2)

        # Step 6: Enter → Left → Enter (confirm save/replace)
        logger.info("[JACKSON-BATCH-LAB] Step 6: Confirming save...")
        pydirectinput.press("enter")
        stoppable_sleep(1)
        pydirectinput.press("left")
        stoppable_sleep(1)
        pydirectinput.press("enter")
        stoppable_sleep(5)

        # Step 7: Extract text from PDF
        logger.info("[JACKSON-BATCH-LAB] Step 7: Extracting text from PDF...")
        content = self._extract_pdf_content()

        # Step 8: Re-open menu and pin it
        logger.info("[JACKSON-BATCH-LAB] Step 8: Re-opening menu...")
        open_menu_img = config.get_rpa_setting("images.jackson_open_menu")
        location = self.wait_for_element(
            open_menu_img,
            timeout=10,
            confidence=0.8,
            description="Open Menu",
        )
        if not location:
            logger.warning("[JACKSON-BATCH-LAB] Open Menu not found, continuing...")
        else:
            self.safe_click(location, "Open Menu")
            stoppable_sleep(2)

        logger.info("[JACKSON-BATCH-LAB] Step 8b: Pinning menu...")
        pin_menu_img = config.get_rpa_setting("images.jackson_pin_menu")
        location = self.wait_for_element(
            pin_menu_img,
            timeout=10,
            confidence=0.8,
            description="Pin Menu",
        )
        if not location:
            logger.warning("[JACKSON-BATCH-LAB] Pin Menu not found, continuing...")
        else:
            self.safe_click(location, "Pin Menu")
            stoppable_sleep(2)

        return content or ""

    def _extract_pdf_content(self) -> str:
        """Extract text content from the saved PDF file with retry logic."""
        try:
            import PyPDF2

            desktop_path = os.path.join(os.path.expanduser("~"), "Desktop")
            pdf_path = os.path.join(desktop_path, self.PDF_FILENAME)

            if not os.path.exists(pdf_path):
                logger.error(f"[JACKSON-BATCH-LAB] PDF not found at: {pdf_path}")
                return "[ERROR] PDF file not found on desktop"

            max_attempts = 5
            for attempt in range(1, max_attempts + 1):
                file_size = os.path.getsize(pdf_path)
                if file_size > 0:
                    logger.info(f"[JACKSON-BATCH-LAB] PDF ready ({file_size} bytes)")
                    break
                logger.warning(
                    f"[JACKSON-BATCH-LAB] PDF empty, waiting... (attempt {attempt}/{max_attempts})"
                )
                stoppable_sleep(1)
            else:
                logger.error("[JACKSON-BATCH-LAB] PDF still empty after max attempts")
                return "[ERROR] PDF file is empty after waiting"

            with open(pdf_path, "rb") as pdf_file:
                pdf_reader = PyPDF2.PdfReader(pdf_file)
                text_content = []

                for page_num, page in enumerate(pdf_reader.pages):
                    page_text = page.extract_text()
                    if page_text:
                        text_content.append(page_text)

                content = "\n".join(text_content)

            logger.info(
                f"[JACKSON-BATCH-LAB] Extracted {len(content)} characters from PDF"
            )
            return content

        except ImportError:
            logger.error(
                "[JACKSON-BATCH-LAB] PyPDF2 not installed - cannot extract PDF content"
            )
            return "[ERROR] PyPDF2 library not available"
        except Exception as e:
            logger.error(f"[JACKSON-BATCH-LAB] Error extracting PDF content: {e}")
            return f"[ERROR] Failed to extract PDF: {e}"

    # ------------------------------------------------------------------
    # Return to Patient List
    # ------------------------------------------------------------------

    def _close_patient_detail(self):
        """Close patient detail window (Alt+F4) without navigating to VDI."""
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
        logger.info("[JACKSON-BATCH-LAB] Patient detail closed")

    def _return_to_patient_list(self):
        """
        Close current patient detail and return to patient list.
        Uses Alt+F4 + conservative patience wait.
        Does NOT retry Alt+F4 to avoid race conditions.
        """
        self.set_step("RETURN_TO_PATIENT_LIST")
        logger.info("[JACKSON-BATCH-LAB] Returning to patient list...")

        screen_w, screen_h = pyautogui.size()
        pyautogui.click(screen_w // 2, screen_h // 2)
        stoppable_sleep(0.5)

        logger.info("[JACKSON-BATCH-LAB] Sending Alt+F4 to close patient detail...")
        pydirectinput.keyDown("alt")
        stoppable_sleep(0.1)
        pydirectinput.press("f4")
        stoppable_sleep(0.1)
        pydirectinput.keyUp("alt")

        logger.info("[JACKSON-BATCH-LAB] Waiting 15s for system to process close...")
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
            logger.info("[JACKSON-BATCH-LAB] OK - Patient list confirmed")
        else:
            logger.warning(
                "[JACKSON-BATCH-LAB] Patient list header not detected after patience wait. "
                "Continuing anyway to avoid race condition."
            )

        self._patient_detail_open = False
        logger.info("[JACKSON-BATCH-LAB] Back at patient list")

    # ------------------------------------------------------------------
    # Cleanup
    # ------------------------------------------------------------------

    def _cleanup(self):
        """Close Jackson EMR session completely."""
        self.set_step("CLEANUP")
        logger.info("[JACKSON-BATCH-LAB] Cleanup - closing EMR...")

        screen_w, screen_h = pyautogui.size()

        pyautogui.click(screen_w // 2, screen_h // 2)
        stoppable_sleep(0.5)

        pydirectinput.keyDown("alt")
        stoppable_sleep(0.1)
        pydirectinput.press("f4")
        stoppable_sleep(0.1)
        pydirectinput.keyUp("alt")

        stoppable_sleep(3)

        self._jackson_flow.step_11_vdi_tab()

        self.verify_lobby()

        logger.info("[JACKSON-BATCH-LAB] Cleanup complete")

    # ------------------------------------------------------------------
    # Backend Notification
    # ------------------------------------------------------------------

    def notify_completion(self, result):
        """Send consolidated lab results to backend."""
        payload = {
            "status": "completed",
            "type": self.FLOW_TYPE,
            "doctor_name": self.doctor_name,
            "hospital": self.hospital_type,
            "patients": result.get("patients", []),
            "total": result.get("total", 0),
            "found_count": result.get("found_count", 0),
            "timestamp": datetime.now().strftime("%Y%m%d_%H%M%S"),
        }

        response = self._send_to_lab_webhook_n8n(payload)
        logger.info(
            f"[BACKEND] Batch lab notification sent - Status: {response.status_code}"
        )
        return response
