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
from agentic.emr.baptist.note_validator import NoteValidatorAgent
from agentic.emr.baptist.note_summarizer import NoteExecutionSummarizer
from agentic.models import AgentStatus


PDF_NOTE_FILENAME = "baptis report.pdf"
MAX_VALIDATION_ATTEMPTS = 3

# Markers in the validator's reason that mean the note exists but is not
# signed yet. In that case the flow reports outcome=found_unsigned so the
# worker re-enqueues with a 4h delay (waiting for the doctor to sign).
_UNSIGNED_MARKERS = (
    "not yet signed",
    "not signed",
    "draft",
    "in progress",
)


def _classify_validation_reason(reason: str) -> str:
    """Return 'found_unsigned' if the reason describes a draft note, else 'not_found'."""
    if not reason:
        return "not_found"
    lowered = reason.lower()
    return "found_unsigned" if any(m in lowered for m in _UNSIGNED_MARKERS) else "not_found"


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
                doctor_name=doctor_name,
                doctor_specialty=doctor_specialty,
                encounter_type=encounter_type,
                date_of_service=date_of_service,
                patient_name=patient_name,
            )

            validator = NoteValidatorAgent(
                doctor_name=doctor_name,
                doctor_specialty=doctor_specialty,
                encounter_type=encounter_type,
                date_of_service=date_of_service,
            )

            summarizer = NoteExecutionSummarizer(
                doctor_name=doctor_name,
                doctor_specialty=doctor_specialty,
                encounter_type=encounter_type,
                date_of_service=date_of_service,
                patient_name=patient_name,
            )

            # Step 4: Search + validate loop
            note_content: Optional[str] = None
            runner_result: Optional[NoteRunnerResult] = None
            validation_failures: list = []
            last_validator_reason = ""
            outcome = "not_found"
            s3_key: Optional[str] = None

            for attempt in range(1, MAX_VALIDATION_ATTEMPTS + 1):
                logger.info(
                    f"[NOTE-FLOW] Search attempt {attempt}/{MAX_VALIDATION_ATTEMPTS}"
                )

                if attempt == 1:
                    runner_result = runner.run(patient_name=patient_name)
                else:
                    runner_result = runner.continue_search()

                if runner_result.status != AgentStatus.FINISHED:
                    logger.warning(
                        f"[NOTE-FLOW] Runner did not finish on attempt {attempt}: "
                        f"{runner_result.error or 'unknown'}"
                    )
                    break

                logger.info("[NOTE-FLOW] Candidate note found. Extracting content...")
                note_content = self._extract_note_content()

                if not note_content:
                    logger.warning(
                        f"[NOTE-FLOW] Attempt {attempt}: PDF extraction returned empty"
                    )
                    validation_failures.append("empty PDF content")
                    continue

                logger.info(
                    f"[NOTE-FLOW] Validating extracted content ({len(note_content)} chars)..."
                )
                validation = validator.validate(note_content)
                last_validator_reason = (
                    f"valid={validation.valid} "
                    f"reason='{validation.reason}' "
                    f"detected_doctor='{validation.detected_doctor}' "
                    f"detected_date='{validation.detected_date}'"
                )

                logger.info(f"[NOTE-FLOW] Validation result: {last_validator_reason}")

                if validation.valid:
                    # Valid signed note — upload to S3 and finish
                    s3_key = self._upload_note_to_s3(patient_name, date_of_service)
                    outcome = "found_signed"
                    break

                validation_failures.append(validation.reason)
                # If the rejection says "not signed", we've already located the
                # right document; no need to keep searching other candidates in
                # this attempt — stop, report found_unsigned so the worker can
                # re-enqueue later when the doctor has signed.
                if _classify_validation_reason(validation.reason) == "found_unsigned":
                    outcome = "found_unsigned"
                    logger.info(
                        "[NOTE-FLOW] Candidate note is not signed yet — "
                        "stopping attempts so the worker can retry later."
                    )
                    break

                logger.warning(
                    f"[NOTE-FLOW] Attempt {attempt} rejected: {validation.reason}. "
                    "Continuing search..."
                )

            # Always try to produce a narrative summary of what happened.
            agent_history = runner_result.history if runner_result else []
            validator_summary = (
                last_validator_reason
                or "(validator did not run — runner did not reach a candidate)"
            )
            try:
                agent_summary = summarizer.summarize(
                    outcome=outcome,
                    agent_history=agent_history,
                    validator_result=validator_summary,
                )
            except Exception as e:
                logger.warning(f"[NOTE-FLOW] Summarizer failed: {e}")
                agent_summary = (
                    f"Outcome: {outcome}. Validator: {validator_summary}. "
                    f"Runner steps: {runner_result.steps_taken if runner_result else 0}."
                )

            # Cleanup VDI regardless of outcome
            if runner_result and runner_result.patient_detail_open:
                self._close_patient_detail()
            self._cleanup()

            if outcome == "found_signed":
                logger.info("=" * 70)
                logger.info(" BAPTIST NOTE FLOW - SUCCESS")
                logger.info(f" Content: {len(note_content or '')} chars")
                logger.info(f" S3 Key: {s3_key or 'none'}")
                logger.info("=" * 70)
                return {
                    "success": True,
                    "outcome": "found_signed",
                    "message": f"Note extracted ({len(note_content or '')} chars)",
                    "note_content": note_content,
                    "s3_key": s3_key,
                    "agent_summary": agent_summary,
                    "validator_reason": last_validator_reason,
                    "steps": runner_result.steps_taken if runner_result else 0,
                }

            reason_summary = "; ".join(validation_failures) or (
                runner_result.error if runner_result else "note not found"
            )
            logger.warning(f"[NOTE-FLOW] Final outcome={outcome}: {reason_summary}")
            return {
                "success": False,
                "outcome": outcome,
                "message": f"Outcome {outcome}: {reason_summary}",
                "note_content": None,
                "s3_key": None,
                "agent_summary": agent_summary,
                "validator_reason": last_validator_reason,
                "steps": runner_result.steps_taken if runner_result else 0,
            }

        except Exception as e:
            logger.error(f"[NOTE-FLOW] Error: {e}", exc_info=True)
            try:
                self._cleanup()
            except Exception:
                pass
            return {
                "success": False,
                "outcome": "not_found",
                "message": str(e),
                "note_content": None,
                "s3_key": None,
                "agent_summary": f"Outcome: not_found. Unhandled error during note search: {e}",
                "validator_reason": "",
                "steps": 0,
            }

    def _navigate_to_patient_list(self) -> bool:
        """Login to Baptist EMR and navigate to patient list."""
        try:
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

            # Click patient list button
            patient_list_btn = self._baptist_flow.wait_for_element(
                config.get_rpa_setting("images.patient_list"),
                timeout=10,
                description="Patient List button",
                auto_click=True,
            )
            if not patient_list_btn:
                raise Exception("Patient List button not found")
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

            # Click the PDF file to overwrite.
            # HIGH confidence (0.95) is required here because the save dialog
            # also shows the Baptist insurance PDF icon on Desktop, which is
            # visually almost identical to the note PDF icon. The default 0.8
            # confidence matches the insurance file and overwrites IT instead
            # of the note file, silently corrupting the S3 insurance key.
            report_pdf_img = config.get_rpa_setting("images.baptist_report_pdf")
            location = self.rpa.wait_for_element(
                report_pdf_img,
                timeout=10,
                confidence=0.95,
                description="Report PDF file",
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
