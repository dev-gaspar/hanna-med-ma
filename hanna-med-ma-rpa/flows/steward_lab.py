"""
Steward Lab Flow - RPA + Agentic flow for patient lab results extraction.

Phases:
- Phase 1 (RPA): Navigate to patient list using Steward flow steps
- Phase 2 (Agentic Runner): Find patient and click to open detail
- Phase 3 (RPA + Agentic): Navigate to Diagnostics, select date range,
  then copy lab results content
- Phase 4 (RPA): Cleanup and return to lobby

This follows the same structural pattern as StewardInsuranceFlow.
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


class StewardLabFlow(BaseFlow):
    """
    RPA flow for extracting patient lab results from Steward Health (Meditech).

    Workflow:
    1. Warmup: Pre-heat OmniParser API in background
    2. Phase 1 (RPA): Navigate to patient list using existing Steward flow steps
    3. Phase 2 (Agentic + RPA): Use PatientFinder to locate patient, then click
    4. Phase 3 (RPA + Agentic): Navigate to Diagnostics, select dates via agent,
       then copy lab results content
    5. Phase 4 (RPA): Cleanup - close Meditech session and return to lobby
    """

    FLOW_NAME = "Steward Patient Lab"
    FLOW_TYPE = "steward_patient_lab"
    EMR_TYPE = "steward"

    def __init__(self):
        super().__init__()
        self.patient_name: Optional[str] = None
        self.copied_content: Optional[str] = None

        self._steward_flow = StewardFlow()

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

        self._steward_flow.setup(
            doctor_id=self.doctor_id,
            doctor_name=self.doctor_name,
            credentials=self.credentials,
        )

        logger.info(f"[STEWARD LAB] Patient to find: {patient_name}")

    def execute(self):
        """Execute the flow for patient lab results extraction."""
        if not self.patient_name:
            raise ValueError("Patient name is required for lab flow")

        start_warmup_async()

        # Phase 1: Navigate to patient list
        logger.info("[STEWARD LAB] Phase 1: Navigating to patient list...")
        self._phase1_navigate_to_patient_list()
        logger.info("[STEWARD LAB] Phase 1: Complete - Patient list visible")

        # Phase 2: Find patient and click
        logger.info(
            f"[STEWARD LAB] Phase 2: Finding patient '{self.patient_name}'..."
        )
        phase2_status, phase2_error, patient_detail_open = (
            self._phase2_agentic_find_and_click_patient()
        )

        if phase2_status == "patient_not_found":
            logger.warning(
                f"[STEWARD LAB] Patient '{self.patient_name}' NOT FOUND - cleaning up..."
            )
            self._cleanup_and_return_to_lobby()

            result = {
                "patient_name": self.patient_name,
                "content": None,
                "patient_found": False,
                "error": f"Patient '{self.patient_name}' not found in patient list",
            }
            self.notify_completion(result)
            return result

        if phase2_status == "error":
            error_msg = f"Agent failed: {phase2_error}"
            logger.error(
                f"[STEWARD LAB] Agent FAILED for '{self.patient_name}' - cleaning up..."
            )
            self.notify_error(error_msg)

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

        logger.info("[STEWARD LAB] Phase 2: Complete - Patient clicked")

        # Phase 3: Navigate to diagnostics, select dates, extract lab content
        logger.info("[STEWARD LAB] Phase 3: Extracting lab results content...")
        self._phase3_extract_lab_content()
        logger.info("[STEWARD LAB] Phase 3: Complete - Content extracted")

        # Phase 4: Cleanup
        logger.info("[STEWARD LAB] Phase 4: Cleanup...")
        self._phase4_cleanup()
        logger.info("[STEWARD LAB] Phase 4: Complete")

        logger.info("[STEWARD LAB] Flow complete")

        return {
            "patient_name": self.patient_name,
            "content": self.copied_content or "[ERROR] No content extracted",
            "patient_found": True,
        }

    # =========================================================================
    # PHASE 1: RPA Navigation
    # =========================================================================

    def _phase1_navigate_to_patient_list(self):
        """
        Phase 1: Use traditional RPA to navigate to the patient list.
        Same pattern as StewardInsuranceFlow Phase 1.
        """
        self.set_step("PHASE1_NAVIGATE_TO_PATIENT_LIST")

        self._steward_flow.step_1_tab()
        self._steward_flow.step_2_favorite()
        self._steward_flow.step_3_meditech()
        self._steward_flow.step_4_login()
        self._steward_flow.step_5_open_session()
        self._steward_flow.step_6_navigate_menu_5()

        logger.info("[PHASE 1] Waiting for step6_load_menu (patient list visible)...")

        menu = self._steward_flow.robust_wait_for_element(
            config.get_rpa_setting("images.steward_load_menu_6"),
            target_description="Menu (step 6) - Patient list visible",
            handlers=self._steward_flow._get_sign_list_handlers(),
            timeout=config.get_timeout("steward.menu"),
        )

        if not menu:
            raise Exception("step6_load_menu not found - patient list not visible")

        logger.info("[PHASE 1] step6_load_menu visible - Patient list is ready")
        stoppable_sleep(2)

    # =========================================================================
    # PHASE 2: Agentic - Find patient and click
    # =========================================================================

    def _phase2_agentic_find_and_click_patient(self) -> tuple:
        """
        Phase 2: Use StewardLabRunner to find and click patient.

        Returns:
            Tuple of (status, error_message, patient_detail_open)
        """
        self.set_step("PHASE2_AGENTIC_FIND_AND_CLICK_PATIENT")

        runner = StewardLabRunner(
            max_steps=15,
            step_delay=1.5,
        )

        result = runner.run(patient_name=self.patient_name)

        if result.status == AgentStatus.PATIENT_NOT_FOUND:
            logger.warning(
                f"[STEWARD LAB] Agent signaled patient not found: {result.error}"
            )
            return ("patient_not_found", result.error, result.patient_detail_open)

        if result.status != AgentStatus.FINISHED:
            error_msg = (
                result.error or "Agent did not complete (max steps reached or error)"
            )
            logger.error(f"[STEWARD LAB] Agent failed: {error_msg}")
            return ("error", error_msg, result.patient_detail_open)

        logger.info(
            f"[STEWARD LAB] Agent completed in {result.steps_taken} steps"
        )
        stoppable_sleep(2)
        return ("success", None, True)

    # =========================================================================
    # PHASE 3: Extract Lab Content
    # =========================================================================

    def _phase3_extract_lab_content(self):
        """
        Phase 3: Navigate to Diagnostics, select date range, copy lab results.

        Steps:
        1. Click Diagnostics
        2. Click Print icon
        3. Click Select All
        4. Click Diagnostics Print button
        5. Use DatePickerAgent to select start/end dates
        6. Click Save button
        7. Click OK button
        8. Click Laboratory Results
        9. Ctrl+A + Ctrl+C to copy content
        10. Right-click tab document button
        11. Click close tab document button
        """
        self.set_step("PHASE3_EXTRACT_LAB_CONTENT")

        # Step 1: Click Diagnostics
        logger.info("[PHASE 3] Step 1: Clicking Diagnostics...")
        diagnostics_img = config.get_rpa_setting("images.steward_diagnostics")
        location = self.wait_for_element(
            diagnostics_img,
            timeout=15,
            confidence=0.8,
            description="Diagnostics",
        )
        if not location:
            raise Exception("Diagnostics button not found")
        self.safe_click(location, "Diagnostics")
        stoppable_sleep(2)

        # Step 2: Click Print icon
        logger.info("[PHASE 3] Step 2: Clicking Print icon...")
        print_ico_img = config.get_rpa_setting("images.steward_print_ico")
        location = self.wait_for_element(
            print_ico_img,
            timeout=15,
            confidence=0.8,
            description="Print icon",
        )
        if not location:
            raise Exception("Print icon not found")
        self.safe_click(location, "Print icon")
        stoppable_sleep(2)

        # Step 3: Click Select All
        logger.info("[PHASE 3] Step 3: Clicking Select All...")
        select_all_img = config.get_rpa_setting("images.steward_select_all")
        location = self.wait_for_element(
            select_all_img,
            timeout=15,
            confidence=0.8,
            description="Select All",
        )
        if not location:
            raise Exception("Select All button not found")
        self.safe_click(location, "Select All")
        stoppable_sleep(2)

        # Step 4: Click Diagnostics Print button
        logger.info("[PHASE 3] Step 4: Clicking Diagnostics Print button...")
        diag_print_img = config.get_rpa_setting("images.steward_diagnostics_print_btn")
        location = self.wait_for_element(
            diag_print_img,
            timeout=15,
            confidence=0.8,
            description="Diagnostics Print button",
        )
        if not location:
            raise Exception("Diagnostics Print button not found")
        self.safe_click(location, "Diagnostics Print button")
        stoppable_sleep(3)

        # Step 5: Use DatePickerAgent to select dates
        logger.info("[PHASE 3] Step 5: Selecting date range with DatePickerAgent...")
        self._select_dates_with_agent()

        # Step 6: Click Save button
        logger.info("[PHASE 3] Step 6: Clicking Save button...")
        save_btn_img = config.get_rpa_setting("images.steward_save_btn")
        location = self.wait_for_element(
            save_btn_img,
            timeout=15,
            confidence=0.8,
            description="Save button",
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
                "[PHASE 3] No lab results found for selected date range - dismissing modal"
            )
            center = pyautogui.center(no_result_location)
            pyautogui.click(center.x + 110, center.y + 50)
            stoppable_sleep(2)
            self.copied_content = None
            logger.info("[PHASE 3] No results - skipping extraction")
            return

        # Step 7: Click OK button
        logger.info("[PHASE 3] Step 7: Clicking OK button...")
        ok_btn_img = config.get_rpa_setting("images.steward_ok_btn")
        location = self.wait_for_element(
            ok_btn_img,
            timeout=15,
            confidence=0.8,
            description="OK button",
        )
        if not location:
            raise Exception("OK button not found")
        self.safe_click(location, "OK button")
        stoppable_sleep(3)

        # Step 8: Click Laboratory Results
        logger.info("[PHASE 3] Step 8: Clicking Laboratory Results...")
        lab_results_img = config.get_rpa_setting("images.steward_laboratory_results")
        location = self.wait_for_element(
            lab_results_img,
            timeout=15,
            confidence=0.8,
            description="Laboratory Results",
        )
        if not location:
            raise Exception("Laboratory Results button not found")
        self.safe_click(location, "Laboratory Results")
        stoppable_sleep(3)

        # Step 9: Copy content with Ctrl+A + Ctrl+C
        logger.info("[PHASE 3] Step 9: Copying lab results content...")
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

        self.copied_content = pyperclip.paste()
        logger.info(f"[PHASE 3] Copied {len(self.copied_content)} characters")

        # Step 10: Right-click on document tab
        logger.info("[PHASE 3] Step 10: Right-clicking on document tab...")
        tab_btn = config.get_rpa_setting("images.steward_tab_document_btn")
        location = self.wait_for_element(
            tab_btn,
            timeout=5,
            confidence=0.8,
            description="Document tab (right-click)",
        )
        if location:
            center = pyautogui.center(location)
            pyautogui.rightClick(center.x, center.y)
            stoppable_sleep(1)
        else:
            logger.warning(
                "[PHASE 3] Could not find tab for right-click, trying center"
            )
            pyautogui.rightClick(screen_w // 2, 50)
            stoppable_sleep(1)

        # Step 11: Click Close Tab Document button
        logger.info("[PHASE 3] Step 11: Clicking close tab button...")
        close_tab_btn = config.get_rpa_setting("images.steward_close_tab_document_btn")
        location = self.wait_for_element(
            close_tab_btn, timeout=5, confidence=0.7, description="Close tab button"
        )
        if location:
            self.safe_click(location, "Close tab button")
            stoppable_sleep(2)
        else:
            logger.warning("[PHASE 3] Close tab button not found, trying Escape")
            pydirectinput.press("escape")
            stoppable_sleep(1)

        logger.info("[PHASE 3] Lab content extraction complete")

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

    # =========================================================================
    # PHASE 4: Cleanup
    # =========================================================================

    def _phase4_cleanup(self):
        """Phase 4: Close Meditech session and return to lobby."""
        self.set_step("PHASE4_CLEANUP")
        self._cleanup_with_patient_detail_open()
        logger.info("[STEWARD LAB] Cleanup complete")

    # =========================================================================
    # CLEANUP METHODS
    # =========================================================================

    def _cleanup_and_return_to_lobby(self):
        """Cleanup Meditech session and return to lobby."""
        logger.info("[STEWARD LAB] Cleaning up and returning to lobby...")
        try:
            self._steward_flow.step_15_close_meditech()
            self._steward_flow.step_16_tab_logged_out()
            self._steward_flow.step_17_close_tab_final()
            self._steward_flow.step_18_url()
            self._steward_flow.step_19_vdi_tab()
            logger.info("[STEWARD LAB] Cleanup completed successfully")
        except Exception as e:
            logger.warning(f"[STEWARD LAB] Cleanup error (continuing): {e}")
            self.verify_lobby()

    def _cleanup_with_patient_detail_open(self):
        """Cleanup when patient detail window is open."""
        logger.info("[STEWARD LAB] Cleaning up with patient detail open...")
        try:
            self._steward_flow.step_15_close_meditech()
            self._steward_flow.step_16_tab_logged_out()
            self._steward_flow.step_17_close_tab_final()
            self._steward_flow.step_18_url()
            self._steward_flow.step_19_vdi_tab()
            logger.info(
                "[STEWARD LAB] Cleanup (patient open) completed successfully"
            )
        except Exception as e:
            logger.warning(f"[STEWARD LAB] Cleanup error (continuing): {e}")
            self.verify_lobby()

    # =========================================================================
    # NOTIFICATION
    # =========================================================================

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
        logger.info(
            f"[BACKEND] Lab notification sent - Status: {response.status_code}"
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
