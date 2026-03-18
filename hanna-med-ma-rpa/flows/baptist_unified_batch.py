"""
Baptist Unified Batch Flow — Single-session extraction.

ONE Cerner/PowerChart login performs ALL four tasks:
  1. Capture patient list census  (screenshot each hospital tab → OCR → send patient_list)
  2. For each patient, open detail ONCE and extract:
     - Clinical summary  (find report → print to PDF → extract text)
     - Insurance info    (Provider Face Sheet → print to PDF → extract text)
     - Lab results       (Results Review → Group → Print to PDF → extract text)
  3. Close Horizon and return to VDI

Sends FOUR payloads to the backend (patient_list, patient_summary,
patient_insurance, patient_lab) so the contract remains 100 % backward-compatible.
"""

import os
from datetime import datetime
from typing import List, Optional

import pyautogui
import pydirectinput

from config import config
from core.s3_client import get_s3_client
from core.vdi_input import stoppable_sleep
from logger import logger

from .base_flow import BaseFlow
from .baptist import BaptistFlow
from agentic.models import AgentStatus
from agentic.omniparser_client import start_warmup_async
from agentic.runners import BaptistSummaryRunner, BaptistLabRunner


class BaptistUnifiedBatchFlow(BaseFlow):
    """
    Fully unified Baptist flow — login once, do everything, close once.

    Flow:
      1. Navigate to patient list  (login → steps 1-10 + click patient list)
      2. Capture patient list screenshots → OCR + LLM → structured patients
      3. Send patient_list payload to backend
      4. Enter fullscreen (stays for capture + batch processing)
      5. For each patient:
         a. Find patient and navigate to report  (BaptistSummaryRunner)
         b. Extract summary content              (print to PDF → extract text)
         c. Navigate to Provider Face Sheet
         d. Extract insurance content            (print to PDF → extract text)
         e. Extract lab results                  (Results Review → Group → Print PDF → extract text)
         f. Close patient detail → return to list (Alt+F4)
      6. Exit fullscreen
      7. Cleanup  (close Horizon, accept alert, return to VDI)
    """

    FLOW_NAME = "Baptist Unified Batch"
    FLOW_TYPE = "baptist_unified_batch"
    EMR_TYPE = "BAPTIST"

    PDF_SUMMARY_FILENAME = "baptis report.pdf"
    PDF_INSURANCE_FILENAME = "baptis insurance.pdf"
    PDF_LAB_FILENAME = "lab baptis.pdf"

    def __init__(self):
        super().__init__()
        self._baptist_flow = BaptistFlow()
        self._patient_detail_open = False
        self.patient_names: List[str] = []
        self.structured_patients: list = []
        self.hospital_type: str = ""
        self.doctor_specialty: Optional[str] = None
        self.summary_results: List[dict] = []
        self.insurance_results: List[dict] = []
        self.lab_results: List[dict] = []
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
        self.hospital_type = hospital_type or "BAPTIST"
        self.doctor_specialty = doctor_specialty
        self.summary_results = []
        self.insurance_results = []
        self.lab_results = []

        # Also setup the internal Baptist flow reference
        self._baptist_flow.setup(
            doctor_id=self.doctor_id,
            doctor_name=self.doctor_name,
            credentials=self.credentials,
        )
        if doctor_specialty:
            logger.info(f"[BAPTIST-UNIFIED] Doctor specialty: {doctor_specialty}")

    # ------------------------------------------------------------------
    # Execute
    # ------------------------------------------------------------------

    def execute(self):
        """
        Main execution — ONE login, patient list + summary + insurance + lab.
        """
        logger.info("=" * 70)
        logger.info(" BAPTIST UNIFIED BATCH - STARTING (single session)")
        logger.info("=" * 70)

        # Read skip flags from config
        skip_patient_list = config.get_rpa_setting("skip_patient_list", False)
        skip_summaries = config.get_rpa_setting("skip_batch_summaries", False)
        skip_insurance = config.get_rpa_setting("skip_batch_insurance", False)
        skip_lab = config.get_rpa_setting("skip_batch_lab", False)

        logger.info(
            f"[BAPTIST-UNIFIED] Skip flags — list={skip_patient_list}, "
            f"summaries={skip_summaries}, insurance={skip_insurance}, lab={skip_lab}"
        )

        # Phase 1: Navigate to patient list (login once — steps 1-10 + click patient list)
        if not self._navigate_to_patient_list():
            logger.error("[BAPTIST-UNIFIED] Failed to navigate to patient list")
            return {
                "structured_patients": [],
                "summary_patients": [],
                "insurance_patients": [],
                "lab_patients": [],
                "hospital": self.hospital_type,
                "error": "Navigation failed",
            }

        # Phase 2: Capture patient list census
        if not skip_patient_list:
            logger.info("[BAPTIST-UNIFIED] Phase 2 — Capturing patient list census...")
            self.structured_patients = self._capture_patient_list()
            patient_count = len(self.structured_patients)
            logger.info(
                f"[BAPTIST-UNIFIED] Census captured: {patient_count} patient(s)"
            )

            # Send patient_list payload to backend immediately
            self._send_patient_list_to_backend(self.structured_patients)
        else:
            logger.info("[BAPTIST-UNIFIED] Phase 2 — SKIPPED (skip_patient_list=true)")
            patient_count = 0
            # Enter fullscreen since _capture_patient_list would have done it
            if not self._click_fullscreen():
                raise Exception("Failed to enter fullscreen mode")
            stoppable_sleep(3)

        # Derive patient names for batch processing
        if not self.patient_names:
            self.patient_names = [
                p.get("name", "")
                for p in self.structured_patients
                if isinstance(p, dict) and p.get("name")
            ]
            logger.info(
                f"[BAPTIST-UNIFIED] Extracted {len(self.patient_names)} patient "
                "name(s) from census"
            )

        # Check if there is any per-patient work to do
        need_per_patient = not (skip_summaries and skip_insurance and skip_lab)

        if not self.patient_names or not need_per_patient:
            if not self.patient_names:
                logger.warning("[BAPTIST-UNIFIED] No patients to process — cleaning up")
            else:
                logger.info(
                    "[BAPTIST-UNIFIED] All per-patient tasks skipped "
                    "(summaries, insurance, lab) — skipping patient loop"
                )
            self._click_normalscreen()
            stoppable_sleep(3)
            self._cleanup()
            return {
                "structured_patients": self.structured_patients,
                "summary_patients": [],
                "insurance_patients": [],
                "lab_patients": [],
                "hospital": self.hospital_type,
            }

        logger.info(
            f"[BAPTIST-UNIFIED] Phase 3 — Processing {len(self.patient_names)} "
            "patient(s) for summary + insurance + lab"
        )

        # Already in fullscreen from patient list capture — proceed directly

        # Phase 3: Process each patient (summary + insurance + lab)
        total = len(self.patient_names)
        for idx, patient in enumerate(self.patient_names, 1):
            is_last = idx == total

            logger.info(
                f"[BAPTIST-UNIFIED] Processing patient {idx}/{total}: {patient}"
            )

            summary_content = None
            insurance_content = None
            lab_content = None
            patient_found = False

            try:
                # Step A: Find patient + navigate to report
                # Only navigate to Notes/Report if summaries are needed
                need_report = not skip_summaries
                runner_result = self._find_patient_and_report(
                    patient, need_report=need_report
                )

                if runner_result.status == AgentStatus.FINISHED:
                    # Report found — extract summary then insurance then lab
                    patient_found = True
                    self._patient_detail_open = True

                    # Step B: Extract summary via PDF
                    if not skip_summaries:
                        summary_content = self._extract_summary()
                        logger.info(
                            f"[BAPTIST-UNIFIED] Summary extracted for {patient}"
                        )
                    else:
                        logger.info(f"[BAPTIST-UNIFIED] Summary SKIPPED for {patient}")

                    # Step C: Navigate to Face Sheet and extract insurance
                    if not skip_insurance:
                        try:
                            self._navigate_to_face_sheet()
                            insurance_content = self._extract_insurance()
                            logger.info(
                                f"[BAPTIST-UNIFIED] Insurance extracted for {patient}"
                            )
                        except Exception as ins_err:
                            logger.error(
                                f"[BAPTIST-UNIFIED] Insurance failed for {patient}: "
                                f"{ins_err}"
                            )
                    else:
                        logger.info(
                            f"[BAPTIST-UNIFIED] Insurance SKIPPED for {patient}"
                        )

                    # Step D: Extract lab results
                    if not skip_lab:
                        try:
                            lab_content = self._extract_lab()
                            logger.info(
                                f"[BAPTIST-UNIFIED] Lab extracted for {patient}"
                            )
                        except Exception as lab_err:
                            logger.error(
                                f"[BAPTIST-UNIFIED] Lab failed for {patient}: "
                                f"{lab_err}"
                            )
                    else:
                        logger.info(f"[BAPTIST-UNIFIED] Lab SKIPPED for {patient}")

                    # Step E: Return to patient list
                    if not is_last:
                        self._return_to_patient_list()
                    else:
                        self._patient_detail_open = True
                        logger.info(
                            "[BAPTIST-UNIFIED] Last patient — detail stays open "
                            "for cleanup"
                        )

                elif runner_result.patient_detail_open:
                    # Patient detail open but report not found — still try
                    # insurance + lab
                    patient_found = True
                    self._patient_detail_open = True
                    logger.warning(
                        f"[BAPTIST-UNIFIED] Report not found for {patient}, "
                        "trying insurance/lab anyway..."
                    )

                    if not skip_insurance:
                        try:
                            self._navigate_to_face_sheet()
                            insurance_content = self._extract_insurance()
                            logger.info(
                                f"[BAPTIST-UNIFIED] Insurance extracted for "
                                f"{patient} (no summary)"
                            )
                        except Exception as ins_err:
                            logger.error(
                                f"[BAPTIST-UNIFIED] Insurance also failed for "
                                f"{patient}: {ins_err}"
                            )

                    if not skip_lab:
                        try:
                            lab_content = self._extract_lab()
                            logger.info(
                                f"[BAPTIST-UNIFIED] Lab extracted for "
                                f"{patient} (no summary)"
                            )
                        except Exception as lab_err:
                            logger.error(
                                f"[BAPTIST-UNIFIED] Lab also failed for "
                                f"{patient}: {lab_err}"
                            )

                    if not is_last:
                        self._return_to_patient_list()
                    else:
                        self._patient_detail_open = True

                else:
                    # Patient not found in list
                    logger.warning(f"[BAPTIST-UNIFIED] Patient not found: {patient}")

            except Exception as e:
                logger.error(f"[BAPTIST-UNIFIED] Error processing {patient}: {str(e)}")
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
            self.lab_results.append(
                {
                    "patient": patient,
                    "found": patient_found,
                    "content": lab_content,
                }
            )

        # Exit fullscreen before cleanup
        logger.info("[BAPTIST-UNIFIED] Exiting fullscreen mode...")
        self._click_normalscreen()
        stoppable_sleep(3)

        # Phase 4: Cleanup (close Horizon, return to VDI)
        logger.info("[BAPTIST-UNIFIED] Cleanup phase")
        self._cleanup()

        summary_ok = sum(1 for r in self.summary_results if r.get("content"))
        insurance_ok = sum(1 for r in self.insurance_results if r.get("content"))
        lab_ok = sum(1 for r in self.lab_results if r.get("content"))

        logger.info("=" * 70)
        logger.info(" BAPTIST UNIFIED BATCH - COMPLETE")
        logger.info(f" Census: {patient_count} patient(s)")
        logger.info(f" Processed: {total} patient(s)")
        logger.info(f" Summaries extracted: {summary_ok}")
        logger.info(f" Insurance extracted: {insurance_ok}")
        logger.info(f" Lab results extracted: {lab_ok}")
        logger.info("=" * 70)

        return {
            "structured_patients": self.structured_patients,
            "summary_patients": self.summary_results,
            "insurance_patients": self.insurance_results,
            "lab_patients": self.lab_results,
            "hospital": self.hospital_type,
            "total": total,
            "summary_found_count": sum(
                1 for r in self.summary_results if r.get("found")
            ),
            "insurance_found_count": sum(
                1 for r in self.insurance_results if r.get("found")
            ),
            "lab_found_count": sum(1 for r in self.lab_results if r.get("found")),
        }

    # ------------------------------------------------------------------
    # Navigation  (from BaptistBatchSummaryFlow)
    # ------------------------------------------------------------------

    def _navigate_to_patient_list(self) -> bool:
        """Navigate to Baptist patient list. Reuses BaptistFlow steps 1-10."""
        self.set_step("NAVIGATE_TO_PATIENT_LIST")
        logger.info("[BAPTIST-UNIFIED] Navigating to patient list...")

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

            # Click patient list button
            logger.info("[BAPTIST-UNIFIED] Clicking patient list button...")
            patient_list_btn = self._baptist_flow.wait_for_element(
                config.get_rpa_setting("images.patient_list"),
                timeout=10,
                description="Patient List button",
                auto_click=True,
            )
            if not patient_list_btn:
                raise Exception("Patient List not found")
            stoppable_sleep(3)

            logger.info("[BAPTIST-UNIFIED] Patient list visible")
            return True

        except Exception as e:
            logger.error(f"[BAPTIST-UNIFIED] Navigation failed: {e}")
            return False

    # ------------------------------------------------------------------
    # Patient List Capture  (replaces separate BaptistFlow execution)
    # ------------------------------------------------------------------

    def _capture_patient_list(self) -> list:
        """
        Capture patient list census from the currently-visible patient list.

        Captures screenshots from all configured hospital tabs (Baptist has
        up to 4 hospital tabs), then extracts structured patients via OCR + LLM.

        Enters fullscreen for screenshot capture and STAYS in fullscreen
        for batch processing afterwards.

        Returns:
            List of structured patient dicts [{name, location, reason, admittedDate, facility}]
        """
        self.set_step("CAPTURE_PATIENT_LIST")
        logger.info("[BAPTIST-UNIFIED] Capturing patient list census...")

        # Load ROIs and hospital config
        rois = self._get_rois("patient_finder")
        hospitals = config.get_hospitals()

        # Enter fullscreen for ROI screenshot
        if not self._click_fullscreen():
            raise Exception("Failed to enter fullscreen mode for patient list capture")
        stoppable_sleep(2)

        screenshots = []
        for idx, hospital in enumerate(hospitals, 1):
            hospital_full_name = hospital.get("name", f"Unknown Hospital {idx}")
            display_name = hospital.get("display_name", f"Hospital_{idx}")
            hospital_index = hospital.get("index", idx)
            tab_image = hospital.get("tab_image")

            logger.info(
                f"[BAPTIST-UNIFIED] Capturing {display_name} - {hospital_full_name}"
            )

            # For hospitals 2+, click on the tab
            if idx > 1:
                if tab_image:
                    hospital_tab = self.wait_for_element(
                        tab_image,
                        timeout=10,
                        confidence=0.9,
                        description=f"{display_name} tab",
                    )
                    if hospital_tab:
                        self.safe_click(hospital_tab, f"{display_name} tab")
                        stoppable_sleep(2)
                    else:
                        logger.warning(
                            f"[BAPTIST-UNIFIED] {display_name} tab not found, skipping"
                        )
                        continue
                else:
                    logger.warning(
                        f"[BAPTIST-UNIFIED] No tab image configured for {display_name}, skipping"
                    )
                    continue

            # Capture screenshot with ROI mask + VDI enhancement
            screenshot_data = self.s3_client.capture_screenshot_with_processing(
                hospital_full_name,
                display_name,
                hospital_index,
                self.doctor_id or "unknown",
                rois=rois,
                enhance=True,  # Baptist: mask + VDI enhancement
            )
            screenshot_data["display_name"] = display_name
            screenshots.append(screenshot_data)

        # Stay in fullscreen — batch patient processing continues here

        # Extract structured patients from screenshots via OCR + LLM
        # Use BaptistFlow's override which tags patients with facility
        structured_patients = self._baptist_flow._extract_patients_from_screenshots(
            screenshots
        )

        logger.info(
            f"[BAPTIST-UNIFIED] Census: {len(structured_patients)} patient(s) extracted"
        )
        return structured_patients

    def _send_patient_list_to_backend(self, structured_patients: list):
        """
        Send patient_list payload to backend — identical to BaptistFlow.notify_completion().
        """
        payload = {
            "status": "completed",
            "type": "baptist_health_patient_list_capture",
            "total_patients": len(structured_patients),
            "patients": structured_patients,
            "timestamp": datetime.now().strftime("%Y%m%d_%H%M%S"),
            "doctor_name": self.doctor_name,
        }
        logger.info(
            f"[BAPTIST-UNIFIED] Sending patient_list to backend "
            f"({len(structured_patients)} patient(s))..."
        )
        response = self._send_to_list_webhook_n8n(payload)
        if response:
            logger.info(
                f"[BAPTIST-UNIFIED] patient_list backend response: {response.status_code}"
            )
        else:
            logger.error("[BAPTIST-UNIFIED] Failed to send patient_list to backend")

    # ------------------------------------------------------------------
    # Patient Finding  (uses BaptistSummaryRunner)
    # ------------------------------------------------------------------

    def _find_patient_and_report(self, patient_name: str, need_report: bool = True):
        """
        Find patient in the list and optionally navigate to their clinical report.

        When need_report=True, uses BaptistSummaryRunner which chains:
          PatientFinder (across 4 hospital tabs) → open patient + Notes → ReportFinder

        When need_report=False, uses BaptistLabRunner which only:
          PatientFinder (across 4 hospital tabs) → open patient detail

        Args:
            patient_name: Name of the patient to find.
            need_report: If True, navigate all the way to the report (Notes + tree).
                If False, only open the patient detail (for lab/insurance-only).
        """
        self.set_step(f"FIND_PATIENT_{patient_name}")
        logger.info(f"[BAPTIST-UNIFIED] Finding patient: {patient_name}")

        if need_report:
            runner = BaptistSummaryRunner(
                max_steps=30,
                step_delay=1.0,
                doctor_specialty=self.doctor_specialty,
            )
        else:
            runner = BaptistLabRunner(
                max_steps=15,
                step_delay=1.0,
                vdi_enhance=True,
            )

        result = runner.run(patient_name=patient_name)
        self._patient_detail_open = result.patient_detail_open

        if result.status == AgentStatus.PATIENT_NOT_FOUND:
            logger.warning(f"[BAPTIST-UNIFIED] Patient not found: {patient_name}")
        elif result.status == AgentStatus.FINISHED:
            logger.info(
                f"[BAPTIST-UNIFIED] Patient found in {result.steps_taken} steps"
            )
            stoppable_sleep(2)
        else:
            error_msg = result.error or "Agent did not find the report"
            logger.error(
                f"[BAPTIST-UNIFIED] Agent error for {patient_name}: {error_msg}"
            )
            if self._patient_detail_open:
                logger.info(
                    "[BAPTIST-UNIFIED] Patient detail open — will try insurance"
                )

        return result

    # ------------------------------------------------------------------
    # Summary Extraction  (from BaptistBatchSummaryFlow.extract_content)
    # ------------------------------------------------------------------

    def _extract_summary(self) -> str:
        """
        Extract summary content by printing report to PDF and reading text.

        Steps:
          1. Click report document to focus
          2. Click print button
          3. Enter x2 (confirm print dialogs)
          4. Ctrl+Alt (exit VDI focus — save dialog is on local machine)
          5. Click existing PDF file to overwrite
          6. Enter, Left, Enter (save with overwrite)
          7. Extract text from PDF
        """
        self.set_step("EXTRACT_SUMMARY")
        logger.info("[BAPTIST-UNIFIED] Extracting summary content via PDF...")

        # Step 1: Click report document to focus
        report_element = self.wait_for_element(
            config.get_rpa_setting("images.baptist_report_document"),
            timeout=10,
            description="Report Document",
        )
        if report_element:
            self.safe_click(report_element, "Report Document")
        else:
            screen_w, screen_h = pyautogui.size()
            pyautogui.click(screen_w // 2, screen_h // 2)
        stoppable_sleep(2)

        # Step 2: Click print button
        print_element = self.wait_for_element(
            config.get_rpa_setting("images.baptist_print_powerchart"),
            timeout=10,
            description="Print PowerChart",
        )
        if print_element:
            self.safe_click(print_element, "Print PowerChart")
        else:
            raise Exception("Print button not found")
        stoppable_sleep(2)

        # Step 3: Enter x2 to confirm print dialogs
        pydirectinput.press("enter")
        stoppable_sleep(2)
        pydirectinput.press("enter")
        stoppable_sleep(4)

        # Step 4: Ctrl+Alt to exit VDI focus (save dialog is on local machine)
        pydirectinput.keyDown("ctrl")
        pydirectinput.keyDown("alt")
        pydirectinput.keyUp("alt")
        pydirectinput.keyUp("ctrl")
        stoppable_sleep(2)

        # Step 5: Click existing PDF file to select
        pdf_file_element = self.wait_for_element(
            config.get_rpa_setting("images.baptist_report_pdf"),
            timeout=10,
            confidence=0.95,
            description="Baptist Report PDF file",
        )
        if pdf_file_element:
            self.safe_click(pdf_file_element, "Baptist Report PDF file")
        stoppable_sleep(2)

        # Step 6: Enter to confirm file selection
        pydirectinput.press("enter")
        stoppable_sleep(2)

        # Step 7: Left arrow to select Replace
        pydirectinput.press("left")
        stoppable_sleep(2)

        # Step 8: Enter to confirm replacement
        pydirectinput.press("enter")
        stoppable_sleep(5)

        # Step 9: Extract text from PDF
        return self._extract_pdf_content(self.PDF_SUMMARY_FILENAME, "summary")

    # ------------------------------------------------------------------
    # Face Sheet Navigation
    # ------------------------------------------------------------------

    def _navigate_to_face_sheet(self):
        """
        Navigate to Provider Face Sheet from the current patient detail.

        After summary PDF extraction, VDI keyboard focus was released (Ctrl+Alt).
        Clicking on the screen re-engages VDI focus before looking for
        the Face Sheet button.
        """
        self.set_step("NAVIGATE_TO_FACE_SHEET")
        logger.info("[BAPTIST-UNIFIED] Navigating to Provider Face Sheet...")

        # Click center to re-engage VDI focus
        screen_w, screen_h = pyautogui.size()
        pyautogui.click(screen_w // 2, screen_h // 2)
        stoppable_sleep(1)

        # Find and click Provider Face Sheet button
        face_sheet_image = config.get_rpa_setting("images.baptist_provider_face_sheet")
        if not face_sheet_image:
            raise Exception("Provider Face Sheet image not configured")

        face_sheet = self.wait_for_element(
            face_sheet_image,
            timeout=30,
            confidence=0.8,
            description="Provider Face Sheet",
        )
        if not face_sheet:
            raise Exception("Provider Face Sheet button not found")

        self.safe_click(face_sheet, "Provider Face Sheet")
        stoppable_sleep(3)
        logger.info("[BAPTIST-UNIFIED] Provider Face Sheet opened")

    # ------------------------------------------------------------------
    # Insurance Extraction  (from BaptistBatchInsuranceFlow._extract_insurance)
    # ------------------------------------------------------------------

    def _extract_insurance(self) -> str:
        """
        Extract insurance content by printing Face Sheet to PDF.

        Steps:
          1. Click print button
          2. Enter (confirm print)
          3. Ctrl+Alt (exit VDI focus)
          4. Click insurance PDF file to overwrite
          5. Enter, Left, Enter (save with overwrite)
          6. Extract text from PDF
        """
        self.set_step("EXTRACT_INSURANCE")
        logger.info("[BAPTIST-UNIFIED] Extracting insurance content via PDF...")

        # Step 1: Click print button
        print_element = self.wait_for_element(
            config.get_rpa_setting("images.baptist_print_powerchart"),
            timeout=10,
            description="Print PowerChart",
        )
        if print_element:
            self.safe_click(print_element, "Print PowerChart")
        else:
            raise Exception("Print button not found")
        stoppable_sleep(2)

        # Step 2: Enter to confirm print
        pydirectinput.press("enter")
        stoppable_sleep(3)

        # Step 3: Ctrl+Alt to exit VDI focus
        pydirectinput.keyDown("ctrl")
        pydirectinput.keyDown("alt")
        pydirectinput.keyUp("alt")
        pydirectinput.keyUp("ctrl")
        stoppable_sleep(2)

        # Step 4: Click insurance PDF file
        insurance_img = config.get_rpa_setting("images.baptist_insurance_btn")
        insurance_element = self.wait_for_element(
            insurance_img,
            timeout=10,
            confidence=0.95,
            description="Baptist Insurance document",
        )
        if insurance_element:
            self.safe_click(insurance_element, "Baptist Insurance document")
        else:
            logger.warning(
                "[BAPTIST-UNIFIED] Baptist Insurance document not found, continuing..."
            )
        stoppable_sleep(2)

        # Step 5: Enter to confirm
        pydirectinput.press("enter")
        stoppable_sleep(2)

        # Step 6: Left arrow to select Replace
        pydirectinput.press("left")
        stoppable_sleep(2)

        # Step 7: Enter to confirm replacement
        pydirectinput.press("enter")
        stoppable_sleep(5)

        # Step 8: Extract text from PDF
        return self._extract_pdf_content(self.PDF_INSURANCE_FILENAME, "insurance")

    # ------------------------------------------------------------------
    # Lab Extraction  (Results Review → Group → Print PDF → extract text)
    # ------------------------------------------------------------------

    def _extract_lab(self) -> str:
        """
        Extract lab results via Results Review → Group → Print to PDF → extract text.

        Steps:
          1. Click center to re-engage VDI focus (may have been released)
          2. Click 'Results Review' tab
          3. Click 'Group' radiobutton (if visible — already in view if not)
          4. Click Print button
          5. Press Enter (confirm print dialog)
          6. Ctrl+Alt (exit VDI focus — save dialog is on local machine)
          7. Click 'lab baptis' file
          8. Enter, Left, Enter (save with overwrite)
          9. Extract text from PDF
        """
        self.set_step("EXTRACT_LAB")
        logger.info("[BAPTIST-UNIFIED] Extracting lab results...")

        # Re-engage VDI focus (may have been released by insurance Ctrl+Alt)
        screen_w, screen_h = pyautogui.size()
        pyautogui.click(screen_w // 2, screen_h // 2)
        stoppable_sleep(1)

        # Step 1: Click Results Review
        logger.info("[BAPTIST-UNIFIED] Clicking 'Results Review'...")
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
        logger.info("[BAPTIST-UNIFIED] Looking for 'Group' radiobutton...")
        group_img = config.get_rpa_setting("images.baptist_group")
        location = self.wait_for_element(
            group_img,
            timeout=5,
            confidence=0.8,
            description="Group",
        )
        if location:
            logger.info("[BAPTIST-UNIFIED] Group found - clicking...")
            self.safe_click(location, "Group")
            stoppable_sleep(2)
        else:
            logger.info("[BAPTIST-UNIFIED] Group not visible - already in correct view")

        # Step 3: Click Print button (shared with report/insurance)
        logger.info("[BAPTIST-UNIFIED] Clicking Print button...")
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
        logger.info("[BAPTIST-UNIFIED] Confirming print dialog (Enter)...")
        pydirectinput.press("enter")
        stoppable_sleep(3)

        # Step 5: Ctrl+Alt to exit VDI focus (save dialog is on local machine)
        logger.info("[BAPTIST-UNIFIED] Exiting VDI focus (Ctrl+Alt)...")
        pydirectinput.keyDown("ctrl")
        pydirectinput.keyDown("alt")
        pydirectinput.keyUp("alt")
        pydirectinput.keyUp("ctrl")
        stoppable_sleep(2)

        # Step 6: Click 'lab baptis' file
        logger.info("[BAPTIST-UNIFIED] Clicking 'lab baptis' file...")
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
            logger.warning("[BAPTIST-UNIFIED] Lab Baptis file not found, continuing...")
        stoppable_sleep(2)

        # Step 7: Enter to confirm file selection
        pydirectinput.press("enter")
        stoppable_sleep(2)

        # Step 8: Left arrow to select Replace
        pydirectinput.press("left")
        stoppable_sleep(2)

        # Step 9: Enter to confirm replacement
        pydirectinput.press("enter")
        stoppable_sleep(5)

        # Step 10: Extract text from PDF
        content = self._extract_pdf_content(self.PDF_LAB_FILENAME, "lab")
        logger.info(f"[BAPTIST-UNIFIED] Lab: {len(content)} characters")
        return content

    # ------------------------------------------------------------------
    # PDF Extraction Helper
    # ------------------------------------------------------------------

    def _extract_pdf_content(self, pdf_filename: str, label: str) -> str:
        """Extract text from saved PDF with retry logic."""
        try:
            import PyPDF2

            desktop_path = os.path.join(os.path.expanduser("~"), "Desktop")
            pdf_path = os.path.join(desktop_path, pdf_filename)

            if not os.path.exists(pdf_path):
                logger.error(f"[BAPTIST-UNIFIED] PDF not found: {pdf_path}")
                return f"[ERROR] PDF file not found ({label})"

            # Retry loop: wait for PDF to have content
            max_attempts = 5
            for attempt in range(1, max_attempts + 1):
                file_size = os.path.getsize(pdf_path)
                if file_size > 0:
                    logger.info(f"[BAPTIST-UNIFIED] PDF ready ({file_size} bytes)")
                    break
                logger.warning(
                    f"[BAPTIST-UNIFIED] PDF empty, waiting... ({attempt}/{max_attempts})"
                )
                stoppable_sleep(1)
            else:
                logger.error("[BAPTIST-UNIFIED] PDF still empty after max attempts")
                return f"[ERROR] PDF file is empty ({label})"

            with open(pdf_path, "rb") as pdf_file:
                pdf_reader = PyPDF2.PdfReader(pdf_file)
                text_content = []

                for page in pdf_reader.pages:
                    page_text = page.extract_text()
                    if page_text:
                        text_content.append(page_text)

                content = "\n".join(text_content)
                logger.info(
                    f"[BAPTIST-UNIFIED] Extracted {len(content)} characters ({label})"
                )
                return content

        except ImportError:
            return f"[ERROR] PyPDF2 not installed ({label})"
        except Exception as e:
            return f"[ERROR] PDF extraction failed ({label}): {e}"

    # ------------------------------------------------------------------
    # Return to Patient List
    # ------------------------------------------------------------------

    def _return_to_patient_list(self):
        """
        Close patient detail and return to patient list.
        Uses Alt+F4 + conservative patience wait.
        Does NOT retry Alt+F4 to avoid race conditions.
        """
        self.set_step("RETURN_TO_PATIENT_LIST")
        logger.info("[BAPTIST-UNIFIED] Returning to patient list...")

        screen_w, screen_h = pyautogui.size()
        pyautogui.click(screen_w // 2, screen_h // 2)
        stoppable_sleep(0.5)

        # Close patient detail with Alt+F4
        logger.info("[BAPTIST-UNIFIED] Sending Alt+F4 to close patient detail...")
        pydirectinput.keyDown("alt")
        stoppable_sleep(0.1)
        pydirectinput.press("f4")
        stoppable_sleep(0.1)
        pydirectinput.keyUp("alt")

        logger.info("[BAPTIST-UNIFIED] Waiting 15s for system to process close...")
        stoppable_sleep(15)

        patient_list_header_img = config.get_rpa_setting(
            "images.baptist_patient_list_header"
        )

        header_found = self._wait_for_patient_list_with_patience(
            patient_list_header_img,
            max_attempts=3,
            attempt_timeout=15,
        )

        if header_found:
            logger.info("[BAPTIST-UNIFIED] OK — Patient list confirmed")
        else:
            logger.warning(
                "[BAPTIST-UNIFIED] Patient list header not detected after patience "
                "wait. Continuing anyway to avoid race condition."
            )

        self._patient_detail_open = False
        logger.info("[BAPTIST-UNIFIED] Back at patient list")

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
        logger.info("[BAPTIST-UNIFIED] Patient detail closed")

    # ------------------------------------------------------------------
    # Cleanup
    # ------------------------------------------------------------------

    def _cleanup(self):
        """Close Baptist EMR session completely and return to VDI lobby."""
        self.set_step("CLEANUP")
        logger.info("[BAPTIST-UNIFIED] Cleanup — closing EMR...")

        # If patient detail is still open (last patient), close it first
        if self._patient_detail_open:
            logger.info("[BAPTIST-UNIFIED] Closing last patient detail...")
            self._close_patient_detail()

        # Close Horizon session
        try:
            self._baptist_flow.step_13_close_horizon()
            self._baptist_flow.step_14_accept_alert()
            self._baptist_flow.step_15_return_to_start()
        except Exception as e:
            logger.warning(f"[BAPTIST-UNIFIED] Cleanup error: {e}")

        # Verify we're back at the lobby
        self.verify_lobby()
        logger.info("[BAPTIST-UNIFIED] Cleanup complete")

    # ------------------------------------------------------------------
    # Backend Notification
    # ------------------------------------------------------------------

    def notify_completion(self, result):
        """
        Send summary + insurance + lab payloads to the backend.

        patient_list was already sent during execute() right after capture,
        so we only send the batch results here.

        Respects skip flags: if a task was skipped, its payload is NOT sent
        to avoid overwriting real data with empty lists.
        """
        skip_summaries = config.get_rpa_setting("skip_batch_summaries", False)
        skip_insurance = config.get_rpa_setting("skip_batch_insurance", False)
        skip_lab = config.get_rpa_setting("skip_batch_lab", False)

        # 1. Summary payload
        if not skip_summaries:
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
            logger.info("[BAPTIST-UNIFIED] Sending summary results to backend...")
            resp = self._send_to_summary_webhook_n8n(summary_payload)
            if resp:
                logger.info(
                    f"[BAPTIST-UNIFIED] Summary backend response: {resp.status_code}"
                )
            else:
                logger.error("[BAPTIST-UNIFIED] Failed to send summary to backend")
        else:
            logger.info("[BAPTIST-UNIFIED] Summary SKIPPED — not sending to backend")

        # 2. Insurance payload
        if not skip_insurance:
            insurance_payload = {
                "status": "completed",
                "type": "baptist_batch_insurance",
                "doctor_name": self.doctor_name,
                "hospital": self.hospital_type,
                "patients": result.get("insurance_patients", []),
                "total": result.get("total", 0),
                "found_count": result.get("insurance_found_count", 0),
                "timestamp": datetime.now().strftime("%Y%m%d_%H%M%S"),
            }
            logger.info("[BAPTIST-UNIFIED] Sending insurance results to backend...")
            resp = self._send_to_batch_insurance_webhook_n8n(insurance_payload)
            if resp:
                logger.info(
                    f"[BAPTIST-UNIFIED] Insurance backend response: "
                    f"{resp.status_code}"
                )
            else:
                logger.error("[BAPTIST-UNIFIED] Failed to send insurance to backend")
        else:
            logger.info("[BAPTIST-UNIFIED] Insurance SKIPPED — not sending to backend")

        # 3. Lab payload
        if not skip_lab:
            lab_payload = {
                "status": "completed",
                "type": "baptist_batch_lab",
                "doctor_name": self.doctor_name,
                "hospital": self.hospital_type,
                "patients": result.get("lab_patients", []),
                "total": result.get("total", 0),
                "found_count": result.get("lab_found_count", 0),
                "timestamp": datetime.now().strftime("%Y%m%d_%H%M%S"),
            }
            logger.info("[BAPTIST-UNIFIED] Sending lab results to backend...")
            resp = self._send_to_lab_webhook_n8n(lab_payload)
            if resp:
                logger.info(
                    f"[BAPTIST-UNIFIED] Lab backend response: {resp.status_code}"
                )
            else:
                logger.error("[BAPTIST-UNIFIED] Failed to send lab to backend")
        else:
            logger.info("[BAPTIST-UNIFIED] Lab SKIPPED — not sending to backend")
