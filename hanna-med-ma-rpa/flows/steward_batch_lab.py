"""
Steward Batch Lab Flow - Batch patient lab results extraction for Steward Health.

Processes multiple patients in a single EMR session, extracting lab results
from the Diagnostics section with date-range selection.
Uses StewardLabRunner for patient finding.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

import pyautogui
import pydirectinput
import pyperclip

from config import config
from core.rpa_engine import RPABotBase
from core.vdi_input import stoppable_sleep
from logger import logger

from .base_flow import BaseFlow
from .steward import StewardFlow
from agentic.models import AgentStatus
from agentic.omniparser_client import start_warmup_async, get_omniparser_client
from agentic.runners import StewardLabRunner
from agentic.emr.steward.date_picker import DatePickerAgent
from agentic.emr.steward import tools
from agentic.screen_capturer import get_screen_capturer, get_agent_rois


class StewardBatchLabFlow(BaseFlow):
    """
    Batch lab flow for Steward Health.

    Keeps the Steward EMR session open while processing multiple patients,
    extracting lab results content from Diagnostics section,
    returning consolidated results.

    Flow:
    1. Navigate to patient list (Rounds Patients)
    2. For each patient:
       - Find patient using StewardLabRunner (agentic)
       - Navigate to Diagnostics > select dates > copy lab results
    3. Cleanup (close EMR, return to VDI)
    """

    FLOW_NAME = "Steward Batch Lab"
    FLOW_TYPE = "steward_batch_lab"
    EMR_TYPE = "steward"

    def __init__(self):
        super().__init__()
        self._steward_flow = StewardFlow()
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
        self.hospital_type = hospital_type or "STEWARD"
        self.results = []

        self._steward_flow.setup(
            doctor_id=self.doctor_id,
            doctor_name=self.doctor_name,
            credentials=self.credentials,
        )

        logger.info(f"[STEWARD-BATCH-LAB] Setup for {len(self.patient_names)} patients")

    def execute(self):
        """
        Execute batch lab extraction.

        1. Navigate to patient list (once)
        2. For each patient: find, extract lab results
        3. Cleanup (once)
        """
        logger.info("=" * 70)
        logger.info(" STEWARD BATCH LAB - STARTING")
        logger.info("=" * 70)
        logger.info(f"[STEWARD-BATCH-LAB] Patients to process: {self.patient_names}")
        logger.info("=" * 70)

        # Phase 1: Navigate to patient list (once)
        if not self._navigate_to_patient_list():
            logger.error("[STEWARD-BATCH-LAB] Failed to navigate to patient list")
            return {
                "patients": [],
                "hospital": self.hospital_type,
                "error": "Navigation failed",
            }

        # Phase 2: Process each patient
        total_patients = len(self.patient_names)
        for idx, patient in enumerate(self.patient_names, 1):
            self.current_patient = patient
            self.current_content = None

            logger.info(
                f"[STEWARD-BATCH-LAB] Processing patient {idx}/{total_patients}: {patient}"
            )

            try:
                found = self._find_patient(patient)

                if found:
                    self.current_content = self._extract_lab()
                    logger.info(
                        f"[STEWARD-BATCH-LAB] Extracted lab results for {patient}"
                    )

                    self._return_to_patient_list()
                else:
                    logger.warning(
                        f"[STEWARD-BATCH-LAB] Patient not found: {patient}"
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
                    f"[STEWARD-BATCH-LAB] Error processing {patient}: {str(e)}"
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
                    try:
                        self._return_to_patient_list()
                    except Exception:
                        pass

        # Phase 3: Cleanup
        logger.info("[STEWARD-BATCH-LAB] Cleanup phase")
        self._cleanup()

        logger.info("=" * 70)
        logger.info(" STEWARD BATCH LAB - COMPLETE")
        logger.info(f" Processed: {total_patients} patients")
        logger.info(f" Found: {sum(1 for r in self.results if r.get('found'))}")
        logger.info("=" * 70)

        return {
            "patients": self.results,
            "hospital": self.hospital_type,
            "total": len(self.patient_names),
            "found_count": sum(1 for r in self.results if r.get("found")),
        }

    def _navigate_to_patient_list(self) -> bool:
        """Navigate to Steward patient list. Reuses steps 1-6."""
        self.set_step("NAVIGATE_TO_PATIENT_LIST")
        logger.info("[STEWARD-BATCH-LAB] Navigating to patient list...")

        try:
            start_warmup_async()

            self._steward_flow.step_1_tab()
            self._steward_flow.step_2_favorite()
            self._steward_flow.step_3_meditech()
            self._steward_flow.step_4_login()
            self._steward_flow.step_5_open_session()
            self._steward_flow.step_6_navigate_menu_5()

            logger.info("[STEWARD-BATCH-LAB] Waiting for patient list to load...")
            menu = self._steward_flow.robust_wait_for_element(
                config.get_rpa_setting("images.steward_load_menu_6"),
                target_description="Menu (step 6) - Patient list visible",
                handlers=self._steward_flow._get_sign_list_handlers(),
                timeout=config.get_timeout("steward.menu"),
            )

            if not menu:
                raise Exception("Patient list not visible")

            stoppable_sleep(2)
            logger.info("[STEWARD-BATCH-LAB] Patient list visible")
            return True

        except Exception as e:
            logger.error(f"[STEWARD-BATCH-LAB] Navigation failed: {e}")
            return False

    def _find_patient(self, patient_name: str) -> bool:
        """
        Find a patient using the StewardLabRunner.

        Returns:
            True if patient found and clicked, False otherwise.
        """
        self.set_step(f"FIND_PATIENT_{patient_name}")
        logger.info(f"[STEWARD-BATCH-LAB] Finding patient: {patient_name}")

        runner = StewardLabRunner(
            max_steps=15,
            step_delay=1.5,
        )

        result = runner.run(patient_name=patient_name)

        self._patient_detail_open = getattr(result, "patient_detail_open", False)

        if result.status == AgentStatus.PATIENT_NOT_FOUND:
            logger.warning(
                f"[STEWARD-BATCH-LAB] Patient not found: {patient_name}"
            )
            return False

        if result.status != AgentStatus.FINISHED:
            error_msg = result.error or "Agent did not complete"
            logger.error(
                f"[STEWARD-BATCH-LAB] Agent error for {patient_name}: {error_msg}"
            )
            return False

        self._patient_detail_open = True
        logger.info(
            f"[STEWARD-BATCH-LAB] Patient found in {result.steps_taken} steps"
        )
        stoppable_sleep(2)
        return True

    def _extract_lab(self) -> str:
        """
        Extract lab content from Diagnostics section.

        Steps:
        1. Click Diagnostics
        2. Click Print icon
        3. Click Select All
        4. Click Diagnostics Print button
        5. Select dates with DatePickerAgent
        6. Click Save button
        7. Click OK button
        8. Click Laboratory Results
        9. Ctrl+A + Ctrl+C to copy content
        10. Right-click tab document button
        11. Click close tab document button
        """
        self.set_step("EXTRACT_LAB")
        logger.info(
            f"[STEWARD-BATCH-LAB] Extracting lab for: {self.current_patient}"
        )

        # Step 1: Click Diagnostics
        logger.info("[STEWARD-BATCH-LAB] Step 1: Clicking Diagnostics...")
        diagnostics_img = config.get_rpa_setting("images.steward_diagnostics")
        location = self.wait_for_element(
            diagnostics_img, timeout=15, confidence=0.8, description="Diagnostics"
        )
        if not location:
            raise Exception("Diagnostics button not found")
        self.safe_click(location, "Diagnostics")
        stoppable_sleep(2)

        # Step 2: Click Print icon
        logger.info("[STEWARD-BATCH-LAB] Step 2: Clicking Print icon...")
        print_ico_img = config.get_rpa_setting("images.steward_print_ico")
        location = self.wait_for_element(
            print_ico_img, timeout=15, confidence=0.8, description="Print icon"
        )
        if not location:
            raise Exception("Print icon not found")
        self.safe_click(location, "Print icon")
        stoppable_sleep(2)

        # Step 3: Click Select All
        logger.info("[STEWARD-BATCH-LAB] Step 3: Clicking Select All...")
        select_all_img = config.get_rpa_setting("images.steward_select_all")
        location = self.wait_for_element(
            select_all_img, timeout=15, confidence=0.8, description="Select All"
        )
        if not location:
            raise Exception("Select All button not found")
        self.safe_click(location, "Select All")
        stoppable_sleep(2)

        # Step 4: Click Diagnostics Print button
        logger.info("[STEWARD-BATCH-LAB] Step 4: Clicking Diagnostics Print button...")
        diag_print_img = config.get_rpa_setting("images.steward_diagnostics_print_btn")
        location = self.wait_for_element(
            diag_print_img, timeout=15, confidence=0.8,
            description="Diagnostics Print button",
        )
        if not location:
            raise Exception("Diagnostics Print button not found")
        self.safe_click(location, "Diagnostics Print button")
        stoppable_sleep(3)

        # Step 5: Select dates with DatePickerAgent
        logger.info("[STEWARD-BATCH-LAB] Step 5: Selecting date range...")
        self._select_dates_with_agent()

        # Step 6: Click Save button
        logger.info("[STEWARD-BATCH-LAB] Step 6: Clicking Save button...")
        save_btn_img = config.get_rpa_setting("images.steward_save_btn")
        location = self.wait_for_element(
            save_btn_img, timeout=15, confidence=0.8, description="Save button"
        )
        if not location:
            raise Exception("Save button not found")
        self.safe_click(location, "Save button")
        stoppable_sleep(3)

        # Step 6b: Check for "No results" error modal
        no_result_img = config.get_rpa_setting("images.steward_lab_no_result")
        no_result_location = self.wait_for_element(
            no_result_img,
            timeout=5,
            confidence=0.8,
            description="No results modal",
        )
        if no_result_location:
            logger.warning(
                f"[STEWARD-BATCH-LAB] No lab results for {self.current_patient} "
                "- dismissing modal"
            )
            center = pyautogui.center(no_result_location)
            pyautogui.click(center.x + 110, center.y + 50)
            stoppable_sleep(2)
            logger.info("[STEWARD-BATCH-LAB] No results - skipping extraction")
            return ""

        # Step 7: Click OK button
        logger.info("[STEWARD-BATCH-LAB] Step 7: Clicking OK button...")
        ok_btn_img = config.get_rpa_setting("images.steward_ok_btn")
        location = self.wait_for_element(
            ok_btn_img, timeout=15, confidence=0.8, description="OK button"
        )
        if not location:
            raise Exception("OK button not found")
        self.safe_click(location, "OK button")
        stoppable_sleep(3)

        # Step 8: Click Laboratory Results
        logger.info("[STEWARD-BATCH-LAB] Step 8: Clicking Laboratory Results...")
        lab_results_img = config.get_rpa_setting("images.steward_laboratory_results")
        location = self.wait_for_element(
            lab_results_img, timeout=15, confidence=0.8,
            description="Laboratory Results",
        )
        if not location:
            raise Exception("Laboratory Results button not found")
        self.safe_click(location, "Laboratory Results")
        stoppable_sleep(3)

        # Step 9: Copy content with Ctrl+A + Ctrl+C
        logger.info("[STEWARD-BATCH-LAB] Step 9: Copying lab content...")
        screen_w, screen_h = pyautogui.size()
        pyautogui.click(screen_w // 2, screen_h // 2)
        stoppable_sleep(0.5)

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
        logger.info(f"[STEWARD-BATCH-LAB] Copied {len(content)} characters")

        # Step 10: Right-click on document tab
        logger.info("[STEWARD-BATCH-LAB] Step 10: Right-clicking document tab...")
        tab_btn = config.get_rpa_setting("images.steward_tab_document_btn")
        location = self.wait_for_element(
            tab_btn, timeout=5, confidence=0.8,
            description="Document tab (right-click)",
        )
        if location:
            center = pyautogui.center(location)
            pyautogui.rightClick(center.x, center.y)
            stoppable_sleep(1)
        else:
            logger.warning(
                "[STEWARD-BATCH-LAB] Could not find tab for right-click"
            )
            pyautogui.rightClick(screen_w // 2, 50)
            stoppable_sleep(1)

        # Step 11: Click Close Tab Document button
        logger.info("[STEWARD-BATCH-LAB] Step 11: Clicking close tab button...")
        close_tab_btn = config.get_rpa_setting("images.steward_close_tab_document_btn")
        location = self.wait_for_element(
            close_tab_btn, timeout=5, confidence=0.7,
            description="Close tab button",
        )
        if location:
            self.safe_click(location, "Close tab button")
            stoppable_sleep(2)
        else:
            logger.warning(
                "[STEWARD-BATCH-LAB] Close tab button not found, trying Escape"
            )
            pydirectinput.press("escape")
            stoppable_sleep(1)

        logger.info("[STEWARD-BATCH-LAB] Lab content extraction complete")
        return content or ""

    def _select_dates_with_agent(self):
        """
        Select start and end dates in the calendar modal using DatePickerAgent.

        Uses enhanced capture (upscale 2x + contrast + sharpness) with imgsz_override=1920
        so OmniParser can reliably read the small calendar day numbers.
        """
        MAX_DATE_STEPS = 20
        agent = DatePickerAgent()
        omniparser = get_omniparser_client()
        capturer = get_screen_capturer()
        rpa = RPABotBase()

        rois = get_agent_rois("steward", "date_picker")
        if not rois:
            logger.warning("[DATE_PICKER] No ROI configured for steward date_picker")

        screen_size = capturer.get_screen_size()
        upscale_factor = 2.0
        upscaled_max = int(max(screen_size) * upscale_factor)
        imgsz = min(upscaled_max, 1920)

        logger.info(
            f"[DATE_PICKER] Enhanced capture: upscale={upscale_factor}x, imgsz={imgsz}, "
            f"ROI regions={len(rois)}"
        )

        date_history: List[Dict[str, Any]] = []

        for step in range(1, MAX_DATE_STEPS + 1):
            rpa.check_stop()
            logger.info(f"[DATE_PICKER] Step {step}/{MAX_DATE_STEPS}")

            if rois:
                image_b64 = capturer.capture_with_mask_enhanced_base64(
                    rois,
                    enhance=True,
                    upscale_factor=upscale_factor,
                    contrast_factor=1.3,
                    sharpness_factor=1.5,
                )
                parsed = omniparser.parse_image(
                    f"data:image/png;base64,{image_b64}",
                    screen_size,
                    imgsz_override=imgsz,
                )
            else:
                parsed = omniparser.parse_screen()
                image_b64 = self._get_image_base64(parsed)

            elements = self._elements_to_dicts(parsed.elements) if parsed else []

            result = agent.decide_action(
                image_base64=image_b64,
                ui_elements=elements,
                history=date_history,
                current_step=step,
            )

            date_history.append({
                "step": step,
                "action": result.action or result.status,
                "status": result.status,
                "reasoning": result.reasoning,
                "target_id": result.target_id,
            })

            if result.status == "finished":
                logger.info("[DATE_PICKER] Both dates selected successfully")
                return

            if result.status == "error":
                logger.error(f"[DATE_PICKER] Agent error: {result.reasoning}")
                raise Exception(f"DatePickerAgent failed: {result.reasoning}")

            if result.action == "click" and result.target_id is not None:
                logger.info(f"[DATE_PICKER] Clicking element {result.target_id}")
                tools.click_element(result.target_id, elements, action="click")
                stoppable_sleep(1.5)
            elif result.action == "wait":
                logger.info("[DATE_PICKER] Waiting for UI to update...")
                stoppable_sleep(2)

            stoppable_sleep(1)

        raise Exception(
            f"DatePickerAgent exhausted {MAX_DATE_STEPS} steps without completing"
        )

    def _return_to_patient_list(self):
        """
        Close current patient and return to patient list.
        Uses single click on Close Meditech (acting as Return).
        Same pattern as StewardBatchInsuranceFlow.
        """
        self.set_step("RETURN_TO_PATIENT_LIST")
        logger.info("[STEWARD-BATCH-LAB] Returning to patient list...")

        try:
            screen_w, screen_h = pyautogui.size()
            pyautogui.click(screen_w // 2, screen_h // 2)
            stoppable_sleep(0.5)

            logger.info(
                "[STEWARD-BATCH-LAB] Clicking Close Meditech (once) to return..."
            )
            close_btn = self.wait_for_element(
                config.get_rpa_setting("images.steward_close_meditech"),
                timeout=config.get_timeout("steward.close_meditech"),
                description="Close Meditech (Return)",
            )

            if close_btn:
                self.safe_click(close_btn, "Close Meditech (Return)")
                pyautogui.moveTo(screen_w // 2, screen_h // 2)
                stoppable_sleep(2)
            else:
                logger.warning("[STEWARD-BATCH-LAB] Close button not found!")

            menu = self._steward_flow.robust_wait_for_element(
                config.get_rpa_setting("images.steward_load_menu_6"),
                target_description="Menu (step 6) - Patient list",
                handlers=self._steward_flow._get_sign_list_handlers(),
                timeout=15,
            )

            if menu:
                logger.info("[STEWARD-BATCH-LAB] OK - Back at patient list")
                self._patient_detail_open = False
            else:
                logger.warning(
                    "[STEWARD-BATCH-LAB] Could not confirm patient list visibility"
                )

        except Exception as e:
            logger.warning(f"[STEWARD-BATCH-LAB] Return to list error: {e}")

    def _cleanup(self):
        """Close Steward EMR session completely."""
        self.set_step("CLEANUP")
        logger.info("[STEWARD-BATCH-LAB] Cleanup - closing EMR...")

        try:
            self._steward_flow.step_15_close_meditech()
            self._steward_flow.step_16_tab_logged_out()
            self._steward_flow.step_17_close_tab_final()
            self._steward_flow.step_18_url()
            self._steward_flow.step_19_vdi_tab()

        except Exception as e:
            logger.warning(f"[STEWARD-BATCH-LAB] Cleanup error: {e}")
            self.verify_lobby()

        logger.info("[STEWARD-BATCH-LAB] Cleanup complete")

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

    # =========================================================================
    # HELPERS
    # =========================================================================

    def _get_image_base64(self, parsed) -> str:
        """Extract base64 image from parsed result."""
        if hasattr(parsed, "labeled_image_url") and parsed.labeled_image_url:
            if parsed.labeled_image_url.startswith("data:"):
                parts = parsed.labeled_image_url.split(",", 1)
                if len(parts) == 2:
                    return parts[1]
        capturer = get_screen_capturer()
        return capturer.capture_base64()

    def _elements_to_dicts(self, elements) -> List[Dict[str, Any]]:
        """Convert UIElement objects to dictionaries."""
        return [
            {
                "id": el.id,
                "type": el.type,
                "content": el.content,
                "center": list(el.center),
                "bbox": el.bbox,
            }
            for el in elements
        ]
