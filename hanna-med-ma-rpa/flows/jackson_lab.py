"""
Jackson Lab Flow - RPA + Agentic flow for patient lab results extraction.

This flow combines:
1. Traditional RPA to navigate to the patient list
2. Local agentic runner (PatientFinder) to find and click the patient
3. RPA to navigate to Results Review, print lab PDF, extract text
4. Cleanup and return to lobby

Lab extraction steps (from patient detail with menu visible):
  1. Click 'Results Review' (at the level of Notes)
  2. Unpin menu
  3. Click 'Labs Group' radiobutton (if visible — already in view if not)
  4. Click Print button
  5. Press Enter, click 'Lab Jackson'
  6. Press Enter, Left arrow, Enter (confirm save/replace)
  7. Extract text from 'lab jackson.pdf' on desktop
  8. Re-open menu (open_menu) and pin it (pin_menu)
"""

import os
from datetime import datetime
from typing import Optional

import pyautogui
import pydirectinput

from config import config
from core.vdi_input import stoppable_sleep
from logger import logger

from .base_flow import BaseFlow
from .jackson import JacksonFlow
from agentic.models import AgentStatus
from agentic.omniparser_client import start_warmup_async
from agentic.runners import JacksonLabRunner


class JacksonLabFlow(BaseFlow):
    """
    RPA flow for extracting patient lab results from Jackson Health.

    Workflow:
    1. Warmup: Pre-heat OmniParser API in background
    2. Phase 1 (RPA): Navigate to patient list using existing Jackson flow steps
    3. Phase 2 (Agentic + RPA): Use PatientFinder to locate patient, then click
    4. Phase 3 (RPA): Navigate to Results Review, print to PDF, extract text
    5. Phase 4 (RPA): Cleanup - close Jackson session and return to start
    """

    FLOW_NAME = "Jackson Patient Lab"
    FLOW_TYPE = "jackson_patient_lab"
    EMR_TYPE = "jackson"

    PDF_FILENAME = "lab jackson.pdf"

    def __init__(self):
        super().__init__()
        self.patient_name: Optional[str] = None
        self.copied_content: Optional[str] = None
        self._jackson_flow = JacksonFlow()

    def setup(
        self,
        doctor_id=None,
        doctor_name=None,
        credentials=None,
        patient_name=None,
        **kwargs,
    ):
        """Setup flow with execution context including patient name."""
        super().setup(
            doctor_id=doctor_id,
            doctor_name=doctor_name,
            credentials=credentials,
            **kwargs,
        )
        self.patient_name = patient_name

        self._jackson_flow.setup(
            doctor_id=self.doctor_id,
            doctor_name=self.doctor_name,
            credentials=self.credentials,
        )

        logger.info(f"[JACKSON LAB] Patient to find: {patient_name}")

    def execute(self):
        """Execute the flow for patient lab results extraction."""
        if not self.patient_name:
            raise ValueError("Patient name is required for lab flow")

        start_warmup_async()

        # Phase 1: Traditional RPA - Navigate to patient list
        logger.info("[JACKSON LAB] Phase 1: Navigating to patient list...")
        self._phase1_navigate_to_patient_list()
        logger.info("[JACKSON LAB] Phase 1: Complete - Patient list visible")

        # Enter fullscreen for better agentic vision
        logger.info("[JACKSON LAB] Entering fullscreen mode...")
        self._click_fullscreen()

        # Phase 2: Agentic - Find patient and click
        logger.info(f"[JACKSON LAB] Phase 2: Finding patient '{self.patient_name}'...")
        phase2_status, phase2_error, patient_detail_open = (
            self._phase2_agentic_find_and_click_patient()
        )

        # Handle patient not found
        if phase2_status == "patient_not_found":
            logger.warning(
                f"[JACKSON LAB] Patient '{self.patient_name}' NOT FOUND - cleaning up..."
            )
            self._click_normalscreen()
            self._cleanup_and_return_to_lobby()

            result = {
                "patient_name": self.patient_name,
                "content": None,
                "patient_found": False,
                "error": f"Patient '{self.patient_name}' not found in patient list",
            }
            self.notify_completion(result)
            return result

        # Handle agent error
        if phase2_status == "error":
            error_msg = f"Agent failed: {phase2_error}"
            logger.error(
                f"[JACKSON LAB] Agent FAILED for '{self.patient_name}' - cleaning up..."
            )
            self.notify_error(error_msg)

            self._click_normalscreen()

            if patient_detail_open:
                self._cleanup_with_patient_detail_open()
            else:
                self._cleanup_and_return_to_lobby()

            return {
                "patient_name": self.patient_name,
                "content": None,
                "patient_found": False,
                "error": error_msg,
            }

        logger.info("[JACKSON LAB] Phase 2: Complete - Patient clicked")

        # Phase 3: Lab Extraction (Results Review → Print → PDF)
        logger.info("[JACKSON LAB] Phase 3: Extracting lab results...")
        self._phase3_extract_lab_content()
        logger.info("[JACKSON LAB] Phase 3: Complete - Content extracted")

        # Exit fullscreen before cleanup
        logger.info("[JACKSON LAB] Exiting fullscreen mode...")
        self._click_normalscreen()
        stoppable_sleep(2)

        # Phase 4: Cleanup
        logger.info("[JACKSON LAB] Phase 4: Cleanup...")
        self._phase4_cleanup()
        logger.info("[JACKSON LAB] Phase 4: Complete")

        logger.info("[JACKSON LAB] Flow complete")

        return {
            "patient_name": self.patient_name,
            "content": self.copied_content or "[ERROR] No content extracted",
            "patient_found": True,
        }

    # ------------------------------------------------------------------
    # Phase 1: Navigation
    # ------------------------------------------------------------------

    def _phase1_navigate_to_patient_list(self):
        """Phase 1: Navigate to the patient list. Reuses Jackson flow steps 1-8."""
        self.set_step("PHASE1_NAVIGATE_TO_PATIENT_LIST")

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

    def _handle_info_modal_after_login(self):
        """Handle info modal that may appear after login."""
        logger.info("[JACKSON LAB] Checking for info modal after login...")

        info_modal = self.wait_for_element(
            config.get_rpa_setting("images.jackson_info_modal"),
            timeout=3,
            description="Info Modal",
        )

        if info_modal:
            logger.info("[JACKSON LAB] Info modal detected - pressing Enter to dismiss")
            pydirectinput.press("enter")
            stoppable_sleep(2)
        else:
            logger.info("[JACKSON LAB] No info modal detected, continuing...")

    # ------------------------------------------------------------------
    # Phase 2: Agentic Patient Finding
    # ------------------------------------------------------------------

    def _phase2_agentic_find_and_click_patient(self) -> tuple:
        """
        Phase 2: Use JacksonLabRunner to find and click patient.

        Returns:
            Tuple of (status, error_message, patient_detail_open)
        """
        self.set_step("PHASE2_AGENTIC_FIND_AND_CLICK_PATIENT")

        runner = JacksonLabRunner(
            max_steps=15,
            step_delay=1.5,
        )

        result = runner.run(patient_name=self.patient_name)

        if result.status == AgentStatus.PATIENT_NOT_FOUND:
            logger.warning(
                f"[JACKSON LAB] Agent signaled patient not found: {result.error}"
            )
            return ("patient_not_found", result.error, result.patient_detail_open)

        if result.status != AgentStatus.FINISHED:
            error_msg = (
                result.error or "Agent did not complete (max steps reached or error)"
            )
            logger.error(f"[JACKSON LAB] Agent failed: {error_msg}")
            return ("error", error_msg, result.patient_detail_open)

        logger.info(f"[JACKSON LAB] Agent completed in {result.steps_taken} steps")
        stoppable_sleep(2)
        return ("success", None, True)

    # ------------------------------------------------------------------
    # Phase 3: Lab Extraction (Results Review → Print → PDF → Extract)
    # ------------------------------------------------------------------

    def _phase3_extract_lab_content(self):
        """
        Phase 3: Extract lab results via Results Review → Print to PDF.

        Steps:
        1. Click 'Results Review'
        2. Unpin menu
        3. Click 'Labs Group' radiobutton (if visible)
        4. Click Print button
        5. Press Enter, click 'Lab Jackson'
        6. Press Enter, Left arrow, Enter (confirm save/replace)
        7. Extract text from PDF on desktop
        8. Re-open menu and pin it
        """
        self.set_step("PHASE3_EXTRACT_LAB_CONTENT")

        # Step 1: Click Results Review
        logger.info("[JACKSON LAB] Step 1: Clicking 'Results Review'...")
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
        logger.info("[JACKSON LAB] Step 2: Unpinning menu...")
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

        # Step 3: Click Labs Group radiobutton (if visible — already in view if not)
        logger.info("[JACKSON LAB] Step 3: Looking for 'Labs Group' radiobutton...")
        labs_group_img = config.get_rpa_setting("images.jackson_labs_group")
        location = self.wait_for_element(
            labs_group_img,
            timeout=5,
            confidence=0.8,
            description="Labs Group",
        )
        if location:
            logger.info("[JACKSON LAB] Labs Group found - clicking...")
            self.safe_click(location, "Labs Group")
            stoppable_sleep(2)
        else:
            logger.info(
                "[JACKSON LAB] Labs Group not visible - already in correct view"
            )

        # Step 4: Click Print button
        logger.info("[JACKSON LAB] Step 4: Clicking Print button...")
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
        logger.info("[JACKSON LAB] Step 5: Confirming print dialog (Enter)...")
        pydirectinput.press("enter")
        stoppable_sleep(2)

        logger.info("[JACKSON LAB] Step 5b: Clicking 'Lab Jackson' file...")
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

        # Step 6: Enter → Left arrow → Enter (confirm save/replace)
        logger.info("[JACKSON LAB] Step 6: Confirming save (Enter, Left, Enter)...")
        pydirectinput.press("enter")
        stoppable_sleep(1)
        pydirectinput.press("left")
        stoppable_sleep(1)
        pydirectinput.press("enter")
        stoppable_sleep(5)  # Wait for PDF to be saved

        # Step 7: Extract text from PDF
        logger.info("[JACKSON LAB] Step 7: Extracting text from PDF...")
        self._extract_pdf_content()

        # Step 8: Re-open menu and pin it
        logger.info("[JACKSON LAB] Step 8: Re-opening menu...")
        open_menu_img = config.get_rpa_setting("images.jackson_open_menu")
        location = self.wait_for_element(
            open_menu_img,
            timeout=10,
            confidence=0.8,
            description="Open Menu",
        )
        if not location:
            logger.warning("[JACKSON LAB] Open Menu button not found, continuing...")
        else:
            self.safe_click(location, "Open Menu")
            stoppable_sleep(2)

        logger.info("[JACKSON LAB] Step 8b: Pinning menu...")
        pin_menu_img = config.get_rpa_setting("images.jackson_pin_menu")
        location = self.wait_for_element(
            pin_menu_img,
            timeout=10,
            confidence=0.8,
            description="Pin Menu",
        )
        if not location:
            logger.warning("[JACKSON LAB] Pin Menu button not found, continuing...")
        else:
            self.safe_click(location, "Pin Menu")
            stoppable_sleep(2)

        logger.info("[JACKSON LAB] Lab extraction complete")

    def _extract_pdf_content(self):
        """Extract text content from the saved PDF file with retry logic."""
        try:
            import PyPDF2

            desktop_path = os.path.join(os.path.expanduser("~"), "Desktop")
            pdf_path = os.path.join(desktop_path, self.PDF_FILENAME)

            if not os.path.exists(pdf_path):
                logger.error(f"[JACKSON LAB] PDF not found at: {pdf_path}")
                self.copied_content = "[ERROR] PDF file not found on desktop"
                return

            # Retry loop: wait for PDF to have content (max 5 attempts, 1s each)
            max_attempts = 5
            for attempt in range(1, max_attempts + 1):
                file_size = os.path.getsize(pdf_path)
                if file_size > 0:
                    logger.info(f"[JACKSON LAB] PDF ready ({file_size} bytes)")
                    break
                logger.warning(
                    f"[JACKSON LAB] PDF empty, waiting... (attempt {attempt}/{max_attempts})"
                )
                stoppable_sleep(1)
            else:
                logger.error("[JACKSON LAB] PDF still empty after max attempts")
                self.copied_content = "[ERROR] PDF file is empty after waiting"
                return

            with open(pdf_path, "rb") as pdf_file:
                pdf_reader = PyPDF2.PdfReader(pdf_file)
                text_content = []

                for page_num, page in enumerate(pdf_reader.pages):
                    page_text = page.extract_text()
                    if page_text:
                        text_content.append(page_text)

                self.copied_content = "\n".join(text_content)

            logger.info(
                f"[JACKSON LAB] Extracted {len(self.copied_content)} characters from PDF"
            )

        except ImportError:
            logger.error(
                "[JACKSON LAB] PyPDF2 not installed - cannot extract PDF content"
            )
            self.copied_content = "[ERROR] PyPDF2 library not available"
        except Exception as e:
            logger.error(f"[JACKSON LAB] Error extracting PDF content: {e}")
            self.copied_content = f"[ERROR] Failed to extract PDF: {e}"

    # ------------------------------------------------------------------
    # Phase 4: Cleanup
    # ------------------------------------------------------------------

    def _phase4_cleanup(self):
        """Phase 4: Close Jackson session and return to start."""
        self.set_step("PHASE4_CLEANUP")
        self._cleanup_with_patient_detail_open()
        logger.info("[JACKSON LAB] Cleanup complete")

    def _cleanup_and_return_to_lobby(self):
        """Cleanup when patient not found (only patient list open)."""
        logger.info("[JACKSON LAB] Performing cleanup (patient list only)...")
        try:
            screen_w, screen_h = pyautogui.size()
            pyautogui.click(screen_w // 2, screen_h // 2)
            stoppable_sleep(0.5)

            logger.info("[JACKSON LAB] Sending Alt+F4 to close Jackson...")
            pydirectinput.keyDown("alt")
            stoppable_sleep(0.1)
            pydirectinput.press("f4")
            stoppable_sleep(0.1)
            pydirectinput.keyUp("alt")

            stoppable_sleep(3)

            self._jackson_flow.step_11_vdi_tab()

        except Exception as e:
            logger.warning(f"[JACKSON LAB] Cleanup error (continuing): {e}")

        self.verify_lobby()

    def _cleanup_with_patient_detail_open(self):
        """Cleanup when patient detail is open (2x Alt+F4)."""
        logger.info("[JACKSON LAB] Performing cleanup (patient detail + list)...")
        try:
            screen_w, screen_h = pyautogui.size()
            patient_list_header_img = config.get_rpa_setting(
                "images.jackson_patient_list_header"
            )

            pyautogui.click(screen_w // 2, screen_h // 2)
            stoppable_sleep(0.5)

            # First close: patient detail
            logger.info("[JACKSON LAB] Sending Alt+F4 to close patient detail...")
            pydirectinput.keyDown("alt")
            stoppable_sleep(0.1)
            pydirectinput.press("f4")
            stoppable_sleep(0.1)
            pydirectinput.keyUp("alt")

            logger.info("[JACKSON LAB] Waiting 15s for system to process close...")
            stoppable_sleep(15)

            header_found = self._wait_for_patient_list_with_patience(
                patient_list_header_img,
                max_attempts=3,
                attempt_timeout=15,
            )

            if header_found:
                logger.info("[JACKSON LAB] OK - Patient list confirmed")
            else:
                logger.warning(
                    "[JACKSON LAB] Patient list header not detected after patience wait. "
                    "Continuing anyway to avoid race condition."
                )

            pyautogui.click(screen_w // 2, screen_h // 2)
            stoppable_sleep(0.5)

            # Second close: patient list
            logger.info("[JACKSON LAB] Sending Alt+F4 to close Jackson list...")
            pydirectinput.keyDown("alt")
            stoppable_sleep(0.1)
            pydirectinput.press("f4")
            stoppable_sleep(0.1)
            pydirectinput.keyUp("alt")

            stoppable_sleep(3)

            self._jackson_flow.step_11_vdi_tab()

        except Exception as e:
            logger.warning(f"[JACKSON LAB] Cleanup error (continuing): {e}")

        self.verify_lobby()

    # ------------------------------------------------------------------
    # Backend Notification
    # ------------------------------------------------------------------

    def notify_completion(self, result):
        """Notify backend of completion with the lab content."""
        patient_found = result.get("patient_found", True)
        payload = {
            "status": "completed" if patient_found else "patient_not_found",
            "type": self.FLOW_TYPE,
            "patient_name": result.get("patient_name"),
            "content": result.get("content"),
            "patient_found": patient_found,
            "error": result.get("error"),
            "timestamp": datetime.now().strftime("%Y%m%d_%H%M%S"),
            "doctor_name": self.doctor_name,
        }
        response = self._send_to_lab_webhook_n8n(payload)
        logger.info(f"[BACKEND] Lab notification sent - Status: {response.status_code}")
        return response
