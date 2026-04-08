"""
Baptist Note Flow - Find and extract a provider note for a specific encounter.

Uses the same EMR navigation pattern as BaptistUnifiedBatchFlow but focused
on finding a single note for a specific patient/date/specialty.
"""

import os
from datetime import datetime
from typing import Optional

import pyautogui
import pydirectinput

from config import config
from core.rpa_engine import RPABotBase
from core.s3_client import get_s3_client
from core.vdi_input import stoppable_sleep
from flows.baptist import BaptistFlow
from logger import logger

from agentic.runners.baptist_note_runner import BaptistNoteRunner, NoteRunnerResult
from agentic.models import AgentStatus


PDF_NOTE_FILENAME = "baptis report.pdf"


class BaptistNoteFlow:
    """
    Flow to find and extract a provider note from Baptist EMR.

    Steps:
    1. Navigate to patient list (login to Baptist EMR)
    2. Find patient and navigate to notes
    3. Find the encounter note using NoteFinderAgent
    4. Extract note content via print-to-PDF
    5. Upload PDF to S3
    6. Close patient detail and return to patient list
    """

    def __init__(self):
        self._baptist_flow = BaptistFlow()
        self.s3_client = get_s3_client()
        self.rpa = RPABotBase()
        self.doctor_id = None
        self.doctor_name = None

    def run(
        self,
        patient_name: str,
        doctor_id: int,
        doctor_name: str,
        doctor_specialty: str,
        encounter_type: str,
        date_of_service: str,
        emr_system: str,
        credentials: list = None,
    ) -> dict:
        """
        Execute the note search flow.

        Returns:
            dict with: success, note_content, s3_key, message, steps
        """
        self.doctor_id = doctor_id
        self.doctor_name = doctor_name

        logger.info("=" * 70)
        logger.info(" BAPTIST NOTE FLOW - STARTING")
        logger.info(f" Patient: {patient_name}")
        logger.info(f" Specialty: {doctor_specialty}")
        logger.info(f" Encounter: {encounter_type}")
        logger.info(f" Date: {date_of_service}")
        logger.info("=" * 70)

        try:
            # Step 1: Navigate to patient list
            logger.info("[NOTE-FLOW] Navigating to patient list...")
            self._baptist_flow.setup(
                doctor_id=doctor_id,
                doctor_name=doctor_name,
                credentials=credentials or [],
            )

            if not self._navigate_to_patient_list():
                return {
                    "success": False,
                    "message": "Failed to navigate to patient list",
                    "note_content": None,
                    "s3_key": None,
                }

            # Step 2: Enter fullscreen for patient search
            self._click_fullscreen()
            stoppable_sleep(3)

            # Step 3: Run the note runner
            runner = BaptistNoteRunner(
                max_steps=30,
                step_delay=1.5,
                vdi_enhance=True,
                doctor_specialty=doctor_specialty,
                encounter_type=encounter_type,
                date_of_service=date_of_service,
                patient_name=patient_name,
            )

            runner_result = runner.run(patient_name=patient_name)

            if runner_result.status != AgentStatus.FINISHED:
                logger.warning(
                    f"[NOTE-FLOW] Note not found: {runner_result.error or 'unknown'}"
                )
                # Close patient detail if open
                if runner_result.patient_detail_open:
                    self._close_patient_detail()
                self._cleanup()
                return {
                    "success": False,
                    "message": runner_result.error or "Note not found",
                    "note_content": None,
                    "s3_key": None,
                    "steps": runner_result.steps_taken,
                }

            # Step 4: Extract note content via PDF
            logger.info("[NOTE-FLOW] Note found! Extracting content...")
            note_content = self._extract_note_content()

            # Step 5: Upload PDF to S3
            s3_key = self._upload_note_to_s3(patient_name, date_of_service)

            # Step 6: Close patient and cleanup
            self._close_patient_detail()
            self._cleanup()

            logger.info("=" * 70)
            logger.info(" BAPTIST NOTE FLOW - SUCCESS")
            logger.info(f" Content: {len(note_content or '')} chars")
            logger.info(f" S3 Key: {s3_key or 'none'}")
            logger.info("=" * 70)

            return {
                "success": True,
                "message": f"Note extracted ({len(note_content or '')} chars)",
                "note_content": note_content,
                "s3_key": s3_key,
                "steps": runner_result.steps_taken,
            }

        except Exception as e:
            logger.error(f"[NOTE-FLOW] Error: {e}", exc_info=True)
            try:
                self._cleanup()
            except Exception:
                pass
            return {
                "success": False,
                "message": str(e),
                "note_content": None,
                "s3_key": None,
            }

    def _navigate_to_patient_list(self) -> bool:
        """Login to Baptist EMR and navigate to patient list."""
        try:
            self._baptist_flow.step_1_click_vdi_desktop()
            self._baptist_flow.step_2_click_horizon()
            self._baptist_flow.step_3_open_horizon()
            self._baptist_flow.step_4_enter_username()
            self._baptist_flow.step_5_enter_password()
            self._baptist_flow.step_6_login()
            self._baptist_flow.step_7_click_patient_list()
            self._baptist_flow.step_8_click_hospital_tab()
            stoppable_sleep(3)
            logger.info("[NOTE-FLOW] Patient list visible")
            return True
        except Exception as e:
            logger.error(f"[NOTE-FLOW] Navigation failed: {e}")
            return False

    def _click_fullscreen(self):
        """Enter fullscreen mode."""
        try:
            fullscreen_img = config.get_rpa_setting("images.baptist_fullscreen_btn")
            location = pyautogui.locateOnScreen(fullscreen_img, confidence=0.8)
            if location:
                pyautogui.click(pyautogui.center(location))
                logger.info("[NOTE-FLOW] Fullscreen entered")
                stoppable_sleep(2)
        except Exception:
            pass

    def _extract_note_content(self) -> Optional[str]:
        """Extract note content by printing to PDF and reading it."""
        try:
            # Click on report document to focus it
            report_img = config.get_rpa_setting("images.baptist_report_document")
            location = self.rpa.wait_for_element(
                report_img, timeout=10, description="Report Document"
            )
            if location:
                self.rpa.safe_click(location, "Report Document")
            stoppable_sleep(2)

            # Print to PDF
            print_img = config.get_rpa_setting("images.baptist_print_powerchart")
            location = self.rpa.wait_for_element(
                print_img, timeout=10, description="Print PowerChart"
            )
            if location:
                self.rpa.safe_click(location, "Print PowerChart")
            stoppable_sleep(2)

            # Confirm print dialogs
            pydirectinput.press("enter")
            stoppable_sleep(2)
            pydirectinput.press("enter")
            stoppable_sleep(3)

            # Exit VDI focus
            pydirectinput.keyDown("ctrl")
            pydirectinput.keyDown("alt")
            pydirectinput.keyUp("alt")
            pydirectinput.keyUp("ctrl")
            stoppable_sleep(2)

            # Click the PDF file to overwrite
            report_pdf_img = config.get_rpa_setting("images.baptist_report_pdf")
            location = self.rpa.wait_for_element(
                report_pdf_img, timeout=10, description="Report PDF file"
            )
            if location:
                self.rpa.safe_click(location, "Report PDF file")
            stoppable_sleep(2)

            # Save with overwrite
            pydirectinput.press("enter")
            stoppable_sleep(2)
            pydirectinput.press("left")
            stoppable_sleep(2)
            pydirectinput.press("enter")
            stoppable_sleep(5)

            # Extract text from PDF
            return self._read_pdf_content()

        except Exception as e:
            logger.error(f"[NOTE-FLOW] Content extraction failed: {e}")
            return None

    def _read_pdf_content(self) -> Optional[str]:
        """Read text content from the saved PDF."""
        try:
            import PyPDF2

            desktop_path = os.path.join(os.path.expanduser("~"), "Desktop")
            pdf_path = os.path.join(desktop_path, PDF_NOTE_FILENAME)

            if not os.path.exists(pdf_path):
                logger.error(f"[NOTE-FLOW] PDF not found: {pdf_path}")
                return None

            # Wait for PDF to have content
            for attempt in range(1, 6):
                if os.path.getsize(pdf_path) > 0:
                    break
                logger.warning(f"[NOTE-FLOW] PDF empty, waiting... ({attempt}/5)")
                stoppable_sleep(1)
            else:
                logger.error("[NOTE-FLOW] PDF still empty after max attempts")
                return None

            with open(pdf_path, "rb") as f:
                reader = PyPDF2.PdfReader(f)
                pages = [page.extract_text() for page in reader.pages if page.extract_text()]
                content = "\n".join(pages)
                logger.info(f"[NOTE-FLOW] Extracted {len(content)} characters from PDF")
                return content

        except Exception as e:
            logger.error(f"[NOTE-FLOW] PDF read failed: {e}")
            return None

    def _upload_note_to_s3(self, patient_name: str, date_of_service: str) -> Optional[str]:
        """Upload the note PDF to S3."""
        try:
            desktop_path = os.path.join(os.path.expanduser("~"), "Desktop")
            pdf_path = os.path.join(desktop_path, PDF_NOTE_FILENAME)

            if not os.path.exists(pdf_path) or os.path.getsize(pdf_path) == 0:
                logger.warning("[NOTE-FLOW] Note PDF not found or empty, skipping S3 upload")
                return None

            clean_name = (patient_name or "unknown").replace(",", "").replace(" ", "_").lower()
            clean_date = (date_of_service or "unknown").replace("/", "-")
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            s3_key = f"baptist/notes/{clean_name}_{clean_date}_{timestamp}.pdf"

            self.s3_client.upload_pdf(pdf_path, s3_key)
            logger.info(f"[NOTE-FLOW] Note PDF uploaded to S3: {s3_key}")
            return s3_key

        except Exception as e:
            logger.warning(f"[NOTE-FLOW] S3 upload failed: {e}")
            return None

    def _close_patient_detail(self):
        """Close patient detail window."""
        try:
            pydirectinput.keyDown("alt")
            pydirectinput.press("F4")
            pydirectinput.keyUp("alt")
            stoppable_sleep(15)
            logger.info("[NOTE-FLOW] Patient detail closed")
        except Exception:
            pass

    def _cleanup(self):
        """Close Baptist EMR and return to VDI."""
        try:
            self._baptist_flow.step_13_close_horizon()
            self._baptist_flow.step_14_accept_alert()
            self._baptist_flow.step_15_return_to_start()
            logger.info("[NOTE-FLOW] Cleanup complete")
        except Exception as e:
            logger.warning(f"[NOTE-FLOW] Cleanup error: {e}")
