"""
Baptist Batch Lab Flow - Batch patient lab results extraction for Baptist Health.

Processes multiple patients in a single EMR session, extracting lab results
via Results Review > Print to PDF > extract text.
Uses BaptistLabRunner with VDI OCR enhancement.
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
from .baptist import BaptistFlow
from agentic.models import AgentStatus
from agentic.omniparser_client import start_warmup_async
from agentic.runners import BaptistLabRunner


class BaptistBatchLabFlow(BaseFlow):
    """
    Batch lab flow for Baptist Health.

    Keeps the Baptist EMR session open while processing multiple patients,
    extracting lab results from Results Review via PDF printing,
    returning consolidated results.

    Flow:
    1. Navigate to patient list
    2. Enter fullscreen mode (better for agentic vision)
    3. For each patient:
       - Find patient and open patient detail (agentic)
       - Click Results Review, select Group
       - Print to PDF, extract text
       - Alt+F4 to close patient detail (wait for patient list header)
    4. Exit fullscreen mode
    5. Cleanup (close EMR, return to VDI)
    """

    FLOW_NAME = "Baptist Batch Lab"
    FLOW_TYPE = "baptist_batch_lab"
    EMR_TYPE = "baptist"

    PDF_FILENAME = "lab baptis.pdf"

    def __init__(self):
        super().__init__()
        self._baptist_flow = BaptistFlow()
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
        self.hospital_type = hospital_type or "BAPTIST"
        self.results = []

        self._baptist_flow.setup(
            doctor_id=self.doctor_id,
            doctor_name=self.doctor_name,
            credentials=self.credentials,
        )

        logger.info(f"[BAPTIST-BATCH-LAB] Setup for {len(self.patient_names)} patients")

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
        logger.info(" BAPTIST BATCH LAB - STARTING")
        logger.info("=" * 70)
        logger.info(f"[BAPTIST-BATCH-LAB] Patients to process: {self.patient_names}")
        logger.info("=" * 70)

        # Phase 1: Navigate to patient list (once)
        if not self._navigate_to_patient_list():
            logger.error("[BAPTIST-BATCH-LAB] Failed to navigate to patient list")
            return {
                "patients": [],
                "hospital": self.hospital_type,
                "error": "Navigation failed",
            }

        # Enter fullscreen mode for better agentic vision
        logger.info("[BAPTIST-BATCH-LAB] Entering fullscreen mode...")
        self._click_fullscreen()

        # Phase 2: Process each patient
        total_patients = len(self.patient_names)
        for idx, patient in enumerate(self.patient_names, 1):
            self.current_patient = patient
            self.current_content = None

            logger.info(
                f"[BAPTIST-BATCH-LAB] Processing patient {idx}/{total_patients}: {patient}"
            )

            try:
                found = self._find_patient(patient)

                if found:
                    self.current_content = self._extract_lab()
                    logger.info(f"[BAPTIST-BATCH-LAB] Extracted lab for {patient}")

                    # Return to patient list
                    self._return_to_patient_list()
                else:
                    logger.warning(
                        f"[BAPTIST-BATCH-LAB] Patient not found: {patient}"
                    )

                self.results.append(
                    {
                        "patient": patient,
                        "found": found,
                        "content": self.current_content,
                    }
                )

            except Exception as e:
                logger.error(
                    f"[BAPTIST-BATCH-LAB] Error processing {patient}: {str(e)}"
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
        logger.info("[BAPTIST-BATCH-LAB] Exiting fullscreen mode...")
        self._click_normalscreen()
        stoppable_sleep(3)

        # Phase 3: Cleanup
        logger.info("[BAPTIST-BATCH-LAB] Cleanup phase")
        self._cleanup()

        logger.info("=" * 70)
        logger.info(" BAPTIST BATCH LAB - COMPLETE")
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
        """Navigate to Baptist patient list. Reuses BaptistFlow steps 1-10."""
        self.set_step("NAVIGATE_TO_PATIENT_LIST")
        logger.info("[BAPTIST-BATCH-LAB] Navigating to patient list...")

        try:
            start_warmup_async()

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

            # Click patient list
            logger.info("[BAPTIST-BATCH-LAB] Clicking patient list...")
            patient_list_btn = self._baptist_flow.wait_for_element(
                config.get_rpa_setting("images.patient_list"),
                timeout=10,
                description="Patient List button",
                auto_click=True,
            )
            if not patient_list_btn:
                raise Exception("Patient List not found")
            stoppable_sleep(3)

            logger.info("[BAPTIST-BATCH-LAB] Patient list visible")
            return True

        except Exception as e:
            logger.error(f"[BAPTIST-BATCH-LAB] Navigation failed: {e}")
            return False

    # ------------------------------------------------------------------
    # Patient Finding
    # ------------------------------------------------------------------

    def _find_patient(self, patient_name: str) -> bool:
        """
        Find a patient and open their detail using the BaptistInsuranceRunner.

        Returns:
            True if patient found and detail opened, False otherwise.
        """
        self.set_step(f"FIND_PATIENT_{patient_name}")
        logger.info(f"[BAPTIST-BATCH-LAB] Finding patient: {patient_name}")

        runner = BaptistLabRunner(
            max_steps=15,
            step_delay=1.5,
            vdi_enhance=True,
        )

        result = runner.run(patient_name=patient_name)

        self._patient_detail_open = getattr(result, "patient_detail_open", False)

        if result.status == AgentStatus.PATIENT_NOT_FOUND:
            logger.warning(
                f"[BAPTIST-BATCH-LAB] Patient not found: {patient_name}"
            )
            return False

        if result.status != AgentStatus.FINISHED:
            error_msg = result.error or "Agent did not complete"
            logger.error(
                f"[BAPTIST-BATCH-LAB] Agent error for {patient_name}: {error_msg}"
            )
            if self._patient_detail_open:
                logger.info(
                    "[BAPTIST-BATCH-LAB] Closing patient detail after error..."
                )
                self._close_patient_detail()
            return False

        self._patient_detail_open = True
        logger.info(
            f"[BAPTIST-BATCH-LAB] Patient found in {result.steps_taken} steps"
        )
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
        2. Click 'Group' radiobutton (if visible — already in view if not)
        3. Click Print button
        4. Press Enter (confirm print dialog)
        5. Ctrl+Alt (exit VDI focus)
        6. Click 'lab baptis' file
        7. Enter, Left arrow, Enter (confirm save/replace)
        8. Extract text from PDF
        """
        self.set_step("EXTRACT_LAB")
        logger.info(
            f"[BAPTIST-BATCH-LAB] Extracting lab for: {self.current_patient}"
        )

        # Step 1: Click Results Review
        logger.info("[BAPTIST-BATCH-LAB] Step 1: Clicking 'Results Review'...")
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
        logger.info("[BAPTIST-BATCH-LAB] Step 2: Looking for 'Group'...")
        group_img = config.get_rpa_setting("images.baptist_group")
        location = self.wait_for_element(
            group_img,
            timeout=5,
            confidence=0.8,
            description="Group",
        )
        if location:
            logger.info("[BAPTIST-BATCH-LAB] Group found - clicking...")
            self.safe_click(location, "Group")
            stoppable_sleep(2)
        else:
            logger.info(
                "[BAPTIST-BATCH-LAB] Group not visible - already in correct view"
            )

        # Step 3: Click Print button (shared with report/insurance)
        logger.info("[BAPTIST-BATCH-LAB] Step 3: Clicking Print button...")
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
        logger.info("[BAPTIST-BATCH-LAB] Step 4: Confirming print dialog...")
        pydirectinput.press("enter")
        stoppable_sleep(3)

        # Step 5: Ctrl+Alt to exit VDI focus (save dialog is on local machine)
        logger.info("[BAPTIST-BATCH-LAB] Step 5: Exiting VDI focus...")
        pydirectinput.keyDown("ctrl")
        pydirectinput.keyDown("alt")
        pydirectinput.keyUp("alt")
        pydirectinput.keyUp("ctrl")
        stoppable_sleep(2)

        # Step 6: Click 'lab baptis' file
        logger.info("[BAPTIST-BATCH-LAB] Step 6: Clicking 'lab baptis' file...")
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
                "[BAPTIST-BATCH-LAB] Lab Baptis file not found, continuing..."
            )
        stoppable_sleep(2)

        # Step 7: Enter, Left, Enter (confirm save/replace)
        logger.info("[BAPTIST-BATCH-LAB] Step 7: Confirming save...")
        pydirectinput.press("enter")
        stoppable_sleep(2)
        pydirectinput.press("left")
        stoppable_sleep(2)
        pydirectinput.press("enter")
        stoppable_sleep(5)

        # Step 8: Extract text from PDF
        logger.info("[BAPTIST-BATCH-LAB] Step 8: Extracting text from PDF...")
        return self._extract_pdf_content()

    def _extract_pdf_content(self) -> str:
        """Extract text from saved PDF with retry logic."""
        try:
            import PyPDF2

            desktop_path = os.path.join(os.path.expanduser("~"), "Desktop")
            pdf_path = os.path.join(desktop_path, self.PDF_FILENAME)

            if not os.path.exists(pdf_path):
                logger.error(f"[BAPTIST-BATCH-LAB] PDF not found: {pdf_path}")
                return "[ERROR] PDF file not found"

            max_attempts = 5
            for attempt in range(1, max_attempts + 1):
                file_size = os.path.getsize(pdf_path)
                if file_size > 0:
                    logger.info(f"[BAPTIST-BATCH-LAB] PDF ready ({file_size} bytes)")
                    break
                logger.warning(
                    f"[BAPTIST-BATCH-LAB] PDF empty, waiting... "
                    f"(attempt {attempt}/{max_attempts})"
                )
                stoppable_sleep(1)
            else:
                logger.error("[BAPTIST-BATCH-LAB] PDF still empty after max attempts")
                return "[ERROR] PDF file is empty after waiting"

            with open(pdf_path, "rb") as pdf_file:
                pdf_reader = PyPDF2.PdfReader(pdf_file)
                text_content = []

                for page in pdf_reader.pages:
                    page_text = page.extract_text()
                    if page_text:
                        text_content.append(page_text)

                content = "\n".join(text_content)
                logger.info(
                    f"[BAPTIST-BATCH-LAB] Extracted {len(content)} characters"
                )
                return content

        except ImportError:
            return "[ERROR] PyPDF2 not installed"
        except Exception as e:
            return f"[ERROR] PDF extraction failed: {e}"

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

        stoppable_sleep(5)
        self._patient_detail_open = False
        logger.info("[BAPTIST-BATCH-LAB] Patient detail closed")

    def _return_to_patient_list(self):
        """
        Close current patient detail and return to patient list.
        Uses Alt+F4 to close the patient detail view.
        Uses visual validation to confirm we're back at the patient list.
        """
        self.set_step("RETURN_TO_PATIENT_LIST")
        logger.info("[BAPTIST-BATCH-LAB] Returning to patient list...")

        # Click center to re-engage VDI focus (released by Ctrl+Alt during PDF save)
        screen_w, screen_h = pyautogui.size()
        pyautogui.click(screen_w // 2, screen_h // 2)
        stoppable_sleep(0.5)

        # Close patient detail with Alt+F4
        logger.info(
            "[BAPTIST-BATCH-LAB] Sending Alt+F4 to close patient detail..."
        )
        pydirectinput.keyDown("alt")
        stoppable_sleep(0.1)
        pydirectinput.press("f4")
        stoppable_sleep(0.1)
        pydirectinput.keyUp("alt")

        # Wait for patient list header to be visible (visual validation)
        logger.info(
            "[BAPTIST-BATCH-LAB] Waiting for patient list header (max 30s)..."
        )

        patient_list_header_img = config.get_rpa_setting(
            "images.baptist_patient_list_header"
        )

        header_found = self.wait_for_element(
            patient_list_header_img,
            timeout=30,
            description="Patient List Header",
        )

        if header_found:
            logger.info("[BAPTIST-BATCH-LAB] OK - Patient list header detected")
        else:
            # Fallback: retry Alt+F4
            logger.warning(
                "[BAPTIST-BATCH-LAB] Patient list header NOT detected — "
                "retrying Alt+F4..."
            )
            pyautogui.click(screen_w // 2, screen_h // 2)
            stoppable_sleep(0.5)

            pydirectinput.keyDown("alt")
            stoppable_sleep(0.1)
            pydirectinput.press("f4")
            stoppable_sleep(0.1)
            pydirectinput.keyUp("alt")

            header_found = self.wait_for_element(
                patient_list_header_img,
                timeout=30,
                description="Patient List Header (retry)",
            )

            if header_found:
                logger.info(
                    "[BAPTIST-BATCH-LAB] OK - Patient list header detected "
                    "after retry"
                )
            else:
                logger.error(
                    "[BAPTIST-BATCH-LAB] FAIL - Patient list header still "
                    "NOT detected"
                )

        self._patient_detail_open = False
        logger.info("[BAPTIST-BATCH-LAB] Back at patient list")

    # ------------------------------------------------------------------
    # Cleanup
    # ------------------------------------------------------------------

    def _cleanup(self):
        """Close Baptist EMR session completely."""
        self.set_step("CLEANUP")
        logger.info("[BAPTIST-BATCH-LAB] Cleanup - closing session...")

        try:
            self._baptist_flow.step_13_close_horizon()
            self._baptist_flow.step_14_accept_alert()
            self._baptist_flow.step_15_return_to_start()
        except Exception as e:
            logger.warning(f"[BAPTIST-BATCH-LAB] Cleanup error: {e}")

        logger.info("[BAPTIST-BATCH-LAB] Cleanup complete")

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
