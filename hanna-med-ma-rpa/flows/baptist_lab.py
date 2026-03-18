"""
Baptist Lab Flow - RPA + Agentic flow for patient lab results extraction.

This flow combines:
1. Traditional RPA to navigate to the patient list
2. Local agentic runner (PatientFinder) to find the patient
3. RPA to navigate to Results Review, print lab PDF, extract text
4. Cleanup and return to VDI

Lab extraction steps (from patient detail with menu visible):
  1. Click 'Results Review' (at the level of Notes)
  2. Click 'Group' radiobutton (if visible — already in view if not)
  3. Click Print button (shared with report/insurance)
  4. Press Enter (confirm print dialog)
  5. Ctrl+Alt (exit VDI focus — save dialog is on local machine)
  6. Click 'lab baptis' file
  7. Press Enter, Left arrow, Enter (confirm save/replace)
  8. Extract text from 'lab baptis.pdf' on desktop
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
from .baptist import BaptistFlow
from agentic.models import AgentStatus
from agentic.omniparser_client import start_warmup_async
from agentic.runners import BaptistLabRunner


class BaptistLabFlow(BaseFlow):
    """
    RPA flow for extracting patient lab results from Baptist Health.

    Workflow:
    1. Warmup: Pre-heat OmniParser API in background
    2. Phase 1 (RPA): Navigate to patient list using existing Baptist flow steps 1-10
    3. Phase 2 (Agentic): Use PatientFinder to locate patient and open detail
    4. Phase 3 (RPA): Navigate to Results Review, print to PDF, extract text
    5. Phase 4 (RPA): Cleanup - close horizon session and return to start
    """

    FLOW_NAME = "Baptist Patient Lab"
    FLOW_TYPE = "baptist_patient_lab"
    EMR_TYPE = "baptist"

    PDF_FILENAME = "lab baptis.pdf"

    def __init__(self):
        super().__init__()
        self.patient_name: Optional[str] = None
        self.copied_content: Optional[str] = None
        self._baptist_flow = BaptistFlow()

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

        self._baptist_flow.setup(
            doctor_id=self.doctor_id,
            doctor_name=self.doctor_name,
            credentials=self.credentials,
        )

        logger.info(f"[BAPTIST LAB] Patient to find: {patient_name}")

    def execute(self):
        """Execute the flow for patient lab results extraction."""
        if not self.patient_name:
            raise ValueError("Patient name is required for lab flow")

        start_warmup_async()

        # Phase 1: Traditional RPA - Navigate to patient list
        logger.info("[BAPTIST LAB] Phase 1: Navigating to patient list...")
        self._phase1_navigate_to_patient_list()
        logger.info("[BAPTIST LAB] Phase 1: Complete - Patient list visible")

        # Enter fullscreen for better agentic vision
        logger.info("[BAPTIST LAB] Entering fullscreen mode...")
        self._click_fullscreen()

        # Phase 2: Agentic - Find patient and open detail
        logger.info(
            f"[BAPTIST LAB] Phase 2: Finding patient '{self.patient_name}'..."
        )
        phase2_status, phase2_error, patient_detail_open = (
            self._phase2_agentic_find_patient()
        )

        # Handle patient not found
        if phase2_status == "patient_not_found":
            logger.warning(
                f"[BAPTIST LAB] Patient '{self.patient_name}' NOT FOUND - cleaning up..."
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
                f"[BAPTIST LAB] Agent FAILED for '{self.patient_name}' - cleaning up..."
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

        logger.info("[BAPTIST LAB] Phase 2: Complete - Patient detail open")

        # Phase 3: Lab Extraction (Results Review → Print → PDF)
        logger.info("[BAPTIST LAB] Phase 3: Extracting lab results...")
        self._phase3_extract_lab_content()
        logger.info("[BAPTIST LAB] Phase 3: Complete - Content extracted")

        # Phase 4: Cleanup
        logger.info("[BAPTIST LAB] Phase 4: Cleanup...")
        self._phase4_cleanup()
        logger.info("[BAPTIST LAB] Phase 4: Complete")

        logger.info("[BAPTIST LAB] Flow complete")

        return {
            "patient_name": self.patient_name,
            "content": self.copied_content or "[ERROR] No content extracted",
            "patient_found": True,
        }

    # ------------------------------------------------------------------
    # Phase 1: Navigation
    # ------------------------------------------------------------------

    def _phase1_navigate_to_patient_list(self):
        """Phase 1: Navigate to the patient list. Reuses Baptist flow steps 1-10."""
        self.set_step("PHASE1_NAVIGATE_TO_PATIENT_LIST")

        self._baptist_flow.step_1_open_vdi_desktop()
        self._baptist_flow.step_2_open_edge()
        self._baptist_flow.step_3_wait_pineapple_connect()
        self._baptist_flow.step_4_open_menu()
        self._baptist_flow.step_5_scroll_modal()
        self._baptist_flow.step_6_click_cerner()
        self._baptist_flow.step_7_wait_cerner_login()
        self._baptist_flow.step_8_click_favorites()
        self._baptist_flow.step_9_click_powerchart()
        self._baptist_flow.step_10_wait_powerchart_open()

        # Click on patient list button
        logger.info("[BAPTIST LAB] Clicking patient list button...")
        patient_list_btn = self._baptist_flow.wait_for_element(
            config.get_rpa_setting("images.patient_list"),
            timeout=10,
            description="Patient List button",
            auto_click=True,
        )
        if not patient_list_btn:
            raise Exception("Patient List not found")
        stoppable_sleep(3)

        logger.info("[BAPTIST LAB] Patient list visible - ready for agentic phase")

    # ------------------------------------------------------------------
    # Phase 2: Agentic Patient Finding
    # ------------------------------------------------------------------

    def _phase2_agentic_find_patient(self) -> tuple:
        """
        Phase 2: Use BaptistLabRunner to find patient and open detail.

        Returns:
            Tuple of (status, error_message, patient_detail_open)
        """
        self.set_step("PHASE2_AGENTIC_FIND_PATIENT")

        runner = BaptistLabRunner(
            max_steps=15,
            step_delay=1.5,
        )

        result = runner.run(patient_name=self.patient_name)

        if result.status == AgentStatus.PATIENT_NOT_FOUND:
            logger.warning(
                f"[BAPTIST LAB] Agent signaled patient not found: {result.error}"
            )
            return ("patient_not_found", result.error, result.patient_detail_open)

        if result.status != AgentStatus.FINISHED:
            error_msg = (
                result.error or "Agent did not complete (max steps reached or error)"
            )
            logger.error(f"[BAPTIST LAB] Agent failed: {error_msg}")
            return ("error", error_msg, result.patient_detail_open)

        logger.info(f"[BAPTIST LAB] Agent completed in {result.steps_taken} steps")
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
        2. Click 'Group' radiobutton (if visible — already in view if not)
        3. Click Print button
        4. Press Enter (confirm print dialog)
        5. Ctrl+Alt (exit VDI focus)
        6. Click 'lab baptis' file
        7. Press Enter, Left arrow, Enter (confirm save/replace)
        8. Extract text from PDF on desktop
        """
        self.set_step("PHASE3_EXTRACT_LAB_CONTENT")

        # Step 1: Click Results Review
        logger.info("[BAPTIST LAB] Step 1: Clicking 'Results Review'...")
        results_review_img = config.get_rpa_setting("images.baptist_results_review")
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

        # Step 2: Click Group radiobutton (if visible — already in view if not)
        logger.info("[BAPTIST LAB] Step 2: Looking for 'Group' radiobutton...")
        group_img = config.get_rpa_setting("images.baptist_group")
        location = self.wait_for_element(
            group_img,
            timeout=5,
            confidence=0.8,
            description="Group",
        )
        if location:
            logger.info("[BAPTIST LAB] Group found - clicking...")
            self.safe_click(location, "Group")
            stoppable_sleep(2)
        else:
            logger.info(
                "[BAPTIST LAB] Group not visible - already in correct view"
            )

        # Step 3: Click Print button (shared with report/insurance)
        logger.info("[BAPTIST LAB] Step 3: Clicking Print button...")
        print_img = config.get_rpa_setting("images.baptist_print_powerchart")
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

        # Step 4: Press Enter to confirm print dialog
        logger.info("[BAPTIST LAB] Step 4: Pressing Enter to confirm print...")
        pydirectinput.press("enter")
        stoppable_sleep(3)

        # Step 5: Ctrl+Alt to exit VDI focus (save dialog is on local machine)
        logger.info("[BAPTIST LAB] Step 5: Exiting VDI focus with Ctrl+Alt...")
        pydirectinput.keyDown("ctrl")
        pydirectinput.keyDown("alt")
        pydirectinput.keyUp("alt")
        pydirectinput.keyUp("ctrl")
        stoppable_sleep(2)

        # Step 6: Click on 'lab baptis' file (existing file on desktop)
        logger.info("[BAPTIST LAB] Step 6: Clicking 'lab baptis' file...")
        lab_baptis_img = config.get_rpa_setting("images.baptist_lab_baptis")
        location = self.wait_for_element(
            lab_baptis_img,
            timeout=10,
            confidence=0.95,
            description="Lab Baptis file",
        )
        if location:
            self.safe_click(location, "Lab Baptis file")
        else:
            logger.warning(
                "[BAPTIST LAB] Lab Baptis file not found, continuing..."
            )
        stoppable_sleep(2)

        # Step 7: Enter to confirm file selection
        logger.info("[BAPTIST LAB] Step 7: Pressing Enter to confirm...")
        pydirectinput.press("enter")
        stoppable_sleep(2)

        # Step 8: Left arrow to select 'Replace' option
        logger.info("[BAPTIST LAB] Step 8: Pressing Left arrow to select Replace...")
        pydirectinput.press("left")
        stoppable_sleep(2)

        # Step 9: Enter to confirm replacement
        logger.info("[BAPTIST LAB] Step 9: Pressing Enter to confirm replacement...")
        pydirectinput.press("enter")
        stoppable_sleep(5)

        # Step 10: Extract text from PDF
        logger.info("[BAPTIST LAB] Step 10: Extracting text from PDF...")
        self._extract_pdf_content()

    def _extract_pdf_content(self):
        """Extract text content from the saved PDF file with retry logic."""
        try:
            import PyPDF2

            desktop_path = os.path.join(os.path.expanduser("~"), "Desktop")
            pdf_path = os.path.join(desktop_path, self.PDF_FILENAME)

            if not os.path.exists(pdf_path):
                logger.error(f"[BAPTIST LAB] PDF not found at: {pdf_path}")
                self.copied_content = "[ERROR] PDF file not found on desktop"
                return

            max_attempts = 5
            for attempt in range(1, max_attempts + 1):
                file_size = os.path.getsize(pdf_path)
                if file_size > 0:
                    logger.info(f"[BAPTIST LAB] PDF ready ({file_size} bytes)")
                    break
                logger.warning(
                    f"[BAPTIST LAB] PDF empty, waiting... (attempt {attempt}/{max_attempts})"
                )
                stoppable_sleep(1)
            else:
                logger.error("[BAPTIST LAB] PDF still empty after max attempts")
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
                f"[BAPTIST LAB] Extracted {len(self.copied_content)} characters from PDF"
            )

        except ImportError:
            logger.error(
                "[BAPTIST LAB] PyPDF2 not installed - cannot extract PDF content"
            )
            self.copied_content = "[ERROR] PyPDF2 library not available"
        except Exception as e:
            logger.error(f"[BAPTIST LAB] Error extracting PDF content: {e}")
            self.copied_content = f"[ERROR] Failed to extract PDF: {e}"

    # ------------------------------------------------------------------
    # Phase 4: Cleanup
    # ------------------------------------------------------------------

    def _phase4_cleanup(self):
        """Phase 4: Close horizon session and return to start."""
        self.set_step("PHASE4_CLEANUP")
        self._baptist_flow.step_13_close_horizon()
        self._baptist_flow.step_14_accept_alert()
        self._baptist_flow.step_15_return_to_start()
        logger.info("[BAPTIST LAB] Cleanup complete")

    def _cleanup_and_return_to_lobby(self):
        """Cleanup when patient not found (only patient list open)."""
        logger.info("[BAPTIST LAB] Performing cleanup (patient list only)...")
        try:
            self._phase4_cleanup()
        except Exception as e:
            logger.warning(f"[BAPTIST LAB] Cleanup error (continuing): {e}")

        self.verify_lobby()

    def _cleanup_with_patient_detail_open(self):
        """Cleanup when patient detail window is open."""
        logger.info("[BAPTIST LAB] Performing cleanup (patient detail open)...")
        try:
            screen_w, screen_h = pyautogui.size()
            pyautogui.click(screen_w // 2, screen_h // 2)
            stoppable_sleep(0.5)

            logger.info("[BAPTIST LAB] Sending Alt+F4 to close patient detail...")
            pyautogui.hotkey("alt", "F4")
            stoppable_sleep(2)

            self._phase4_cleanup()
        except Exception as e:
            logger.warning(f"[BAPTIST LAB] Cleanup error (continuing): {e}")

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
