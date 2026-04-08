"""
Baptist Note Runner - Orchestrator for finding provider notes by encounter.

Same pattern as BaptistSummaryRunner but uses NoteFinderAgent instead of
ReportFinderAgent. Searches for notes matching a specific date, specialty,
and encounter type.
"""

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

import pyautogui

from config import config
from core.rpa_engine import RPABotBase
from logger import logger

from agentic.emr.baptist.patient_finder import PatientFinderAgent
from agentic.emr.baptist.note_finder import NoteFinderAgent
from agentic.emr.baptist import tools
from agentic.models import AgentStatus
from agentic.omniparser_client import get_omniparser_client
from agentic.screen_capturer import get_screen_capturer, get_agent_rois
from version import __version__


@dataclass
class NoteRunnerResult:
    """Result from BaptistNoteRunner."""

    status: AgentStatus
    execution_id: str
    steps_taken: int = 0
    error: Optional[str] = None
    history: List[Dict[str, Any]] = field(default_factory=list)
    patient_detail_open: bool = False


class BaptistNoteRunner:
    """
    Orchestrator for finding provider notes in Baptist EMR.

    Chains specialized agents:
    1. PatientFinderAgent - Finds patient across 4 hospital tabs
    2. RPA actions - Opens patient and Notes (with modal handling)
    3. NoteFinderAgent - Navigates notes tree to find the encounter note
    """

    MAX_HOSPITAL_TABS = 4

    def __init__(
        self,
        max_steps: int = 30,
        step_delay: float = 1.5,
        vdi_enhance: bool = True,
        doctor_specialty: str = None,
        encounter_type: str = "CONSULT",
        date_of_service: str = "",
        patient_name: str = "",
    ):
        self.max_steps = max_steps
        self.step_delay = step_delay
        self.vdi_enhance = vdi_enhance
        self.doctor_specialty = doctor_specialty

        # Components
        self.omniparser = get_omniparser_client()
        self.capturer = get_screen_capturer()
        self.patient_finder = PatientFinderAgent()
        self.note_finder = NoteFinderAgent(
            doctor_specialty=doctor_specialty,
            encounter_type=encounter_type,
            date_of_service=date_of_service,
            patient_name=patient_name,
        )

        self.rpa = RPABotBase()

        # State
        self.execution_id = ""
        self.history: List[Dict[str, Any]] = []
        self.current_step = 0

    def run(self, patient_name: str) -> NoteRunnerResult:
        """
        Run the full flow to find a provider note for the encounter.

        Args:
            patient_name: Name of patient to find

        Returns:
            NoteRunnerResult with outcome
        """
        self.execution_id = str(uuid.uuid4())[:8]
        self.history = []
        self.current_step = 0
        patient_detail_opened = False

        logger.info("=" * 70)
        logger.info(" BAPTIST NOTE RUNNER - STARTING")
        logger.info(f" VERSION: {__version__}")
        logger.info("=" * 70)
        logger.info(f"[NOTE-RUNNER] Execution ID: {self.execution_id}")
        logger.info(f"[NOTE-RUNNER] Patient: {patient_name}")
        logger.info(f"[NOTE-RUNNER] Specialty: {self.doctor_specialty}")
        logger.info(f"[NOTE-RUNNER] Encounter: {self.note_finder.encounter_type}")
        logger.info(f"[NOTE-RUNNER] Date: {self.note_finder.date_of_service}")
        logger.info("=" * 70)

        try:
            # === PHASE 1: Find Patient (across 4 hospital tabs) ===
            logger.info("[NOTE-RUNNER] Phase 1: Finding patient...")
            patient_result, phase1_elements = self._phase1_find_patient_with_tabs(
                patient_name
            )

            if patient_result.status == "not_found" or patient_result.status == "error":
                logger.warning("[NOTE-RUNNER] Patient not found in any hospital tab")
                return NoteRunnerResult(
                    status=AgentStatus.PATIENT_NOT_FOUND,
                    execution_id=self.execution_id,
                    steps_taken=self.current_step,
                    error=f"Patient '{patient_name}' not found in any hospital tab",
                    history=self.history,
                    patient_detail_open=False,
                )

            patient_element_id = patient_result.target_id
            logger.info(
                f"[NOTE-RUNNER] Phase 1 complete - Patient at element {patient_element_id}"
            )

            # === PHASE 2: Open Patient + Notes (RPA) ===
            logger.info("[NOTE-RUNNER] Phase 2: Opening patient record...")
            self._phase2_open_patient_and_notes(patient_element_id, phase1_elements)
            patient_detail_opened = True
            logger.info("[NOTE-RUNNER] Phase 2 complete - Notes view open")

            # === PHASE 3: Find Note (Agent Loop) ===
            logger.info("[NOTE-RUNNER] Phase 3: Searching for encounter note...")
            note_found = self._phase3_find_note()

            if not note_found:
                return NoteRunnerResult(
                    status=AgentStatus.ERROR,
                    execution_id=self.execution_id,
                    steps_taken=self.current_step,
                    error="Could not find encounter note within max steps",
                    history=self.history,
                    patient_detail_open=True,
                )

            logger.info("=" * 70)
            logger.info(" BAPTIST NOTE RUNNER - FINISHED")
            logger.info(f" Steps: {self.current_step}")
            logger.info("=" * 70)

            return NoteRunnerResult(
                status=AgentStatus.FINISHED,
                execution_id=self.execution_id,
                steps_taken=self.current_step,
                history=self.history,
                patient_detail_open=True,
            )

        except Exception as e:
            logger.error(f"[NOTE-RUNNER] Error: {e}", exc_info=True)
            return NoteRunnerResult(
                status=AgentStatus.ERROR,
                execution_id=self.execution_id,
                steps_taken=self.current_step,
                error=str(e),
                history=self.history,
                patient_detail_open=patient_detail_opened,
            )

    def _phase1_find_patient_with_tabs(self, patient_name: str):
        """Phase 1: Find patient across Baptist hospital tabs."""
        MAX_PATIENT_STEPS = 10
        checked_tabs: List[str] = []
        phase1_history: List[Dict[str, Any]] = []
        elements = []

        rois = get_agent_rois("baptist", "patient_finder")
        using_roi = len(rois) > 0
        if using_roi:
            logger.info(f"[NOTE-RUNNER] Phase 1 using ROI mask ({len(rois)} regions)")

        for step in range(1, MAX_PATIENT_STEPS + 1):
            self.rpa.check_stop()
            self.current_step += 1

            logger.info(f"[NOTE-RUNNER] Phase 1 Step {step}/{MAX_PATIENT_STEPS}")

            if using_roi:
                if self.vdi_enhance:
                    upscale_factor = 2.0
                    image_b64 = self.capturer.capture_with_mask_enhanced_base64(
                        rois,
                        enhance=True,
                        upscale_factor=upscale_factor,
                        contrast_factor=1.3,
                        sharpness_factor=1.5,
                    )
                    screen_size = self.capturer.get_screen_size()
                    upscaled_max = int(max(screen_size) * upscale_factor)
                    imgsz = min(upscaled_max, 1920)
                    parsed = self.omniparser.parse_image(
                        f"data:image/png;base64,{image_b64}",
                        screen_size,
                        imgsz_override=imgsz,
                    )
                else:
                    image_b64 = self.capturer.capture_with_mask_base64(rois)
                    parsed = self.omniparser.parse_image(
                        f"data:image/png;base64,{image_b64}",
                        self.capturer.get_screen_size(),
                    )
            else:
                parsed = self.omniparser.parse_screen()
                image_b64 = self._get_image_base64_from_parsed(parsed)

            elements = self._elements_to_dicts(parsed.elements)

            result = self.patient_finder.decide_action(
                patient_name=patient_name,
                image_base64=image_b64,
                ui_elements=elements,
                history=phase1_history,
                current_step=step,
                checked_tabs=checked_tabs,
            )

            phase1_history.append(
                {
                    "step": step,
                    "action": result.action or result.status,
                    "reasoning": result.reasoning,
                }
            )
            self._record_step(
                "patient_finder", result.action or result.status, result.reasoning
            )

            if result.status == "found":
                logger.info(f"[NOTE-RUNNER] Patient found! Element ID: {result.target_id}")

                class PatientFoundResult:
                    status = "found"
                    target_id = result.target_id

                return PatientFoundResult(), elements

            if result.status == "not_found":
                logger.warning("[NOTE-RUNNER] Patient not found after searching all tabs")

                class PatientNotFoundResult:
                    status = "not_found"
                    target_id = None

                return PatientNotFoundResult(), elements

            if result.status == "error":
                logger.error(f"[NOTE-RUNNER] Patient finder error: {result.reasoning}")

                class PatientErrorResult:
                    status = "error"
                    target_id = None

                return PatientErrorResult(), elements

            if result.status == "running":
                if result.action == "click_tab_1":
                    logger.info("[NOTE-RUNNER] Clicking Hospital Tab 1 (HH)")
                    tools.click_tab_hospital_1()
                    checked_tabs.append("HH")
                    self.rpa.stoppable_sleep(2.5)
                    continue
                elif result.action == "click_tab_2":
                    logger.info("[NOTE-RUNNER] Clicking Hospital Tab 2 (SMH)")
                    tools.click_tab_hospital_2()
                    checked_tabs.append("SMH")
                    self.rpa.stoppable_sleep(2.5)
                    continue
                elif result.action == "click_tab_3":
                    logger.info("[NOTE-RUNNER] Clicking Hospital Tab 3 (WKBH)")
                    tools.click_tab_hospital_3()
                    checked_tabs.append("WKBH")
                    self.rpa.stoppable_sleep(2.5)
                    continue
                elif result.action == "click_tab_4":
                    logger.info("[NOTE-RUNNER] Clicking Hospital Tab 4 (BHM)")
                    tools.click_tab_hospital_4()
                    checked_tabs.append("BHM")
                    self.rpa.stoppable_sleep(2.5)
                    continue
                elif result.action == "wait":
                    logger.info("[NOTE-RUNNER] Waiting for screen to load...")
                    self.rpa.stoppable_sleep(2)
                    continue

            self.rpa.stoppable_sleep(self.step_delay)

        logger.warning(f"[NOTE-RUNNER] Phase 1 exhausted {MAX_PATIENT_STEPS} steps")

        class PatientNotFoundResult:
            status = "not_found"
            target_id = None

        return PatientNotFoundResult(), elements

    def _phase2_open_patient_and_notes(self, element_id: int, elements: list):
        """Phase 2: Open patient detail and navigate to Notes view."""
        self.current_step += 1

        result = tools.click_element(element_id, elements, action="dblclick")
        self._record_step(
            "rpa",
            "dblclick_patient",
            f"Double-clicked patient element {element_id}: {result}",
        )

        logger.info("[NOTE-RUNNER] Waiting for patient detail (with modal handling)...")
        self._handle_patient_open_modals()
        self.rpa.check_stop()

        self.current_step += 1
        notes_found = self._click_notes_menu_with_modal_handling()

        if not notes_found:
            logger.warning("[NOTE-RUNNER] Notes menu not found")
            self._record_step("rpa", "click_notes", "Notes menu not found")
        else:
            logger.info("[NOTE-RUNNER] First click on Notes menu registered")
            self._record_step("rpa", "click_notes", "Notes menu clicked")

            logger.info("[NOTE-RUNNER] Waiting 5s for screen to stabilize...")
            self.rpa.stoppable_sleep(5)
            self.rpa.check_stop()

            logger.info("[NOTE-RUNNER] Confirmation click on Notes menu...")
            notes_image = config.get_rpa_setting("images.baptist_notes_menu")
            try:
                location = pyautogui.locateOnScreen(notes_image, confidence=0.8)
                if location:
                    self.rpa.safe_click(location, "Notes Menu (confirmation)")
                    logger.info("[NOTE-RUNNER] Confirmation click on Notes: success")
            except Exception:
                pass

        logger.info("[NOTE-RUNNER] Waiting 5s for notes tree to load...")
        self.rpa.stoppable_sleep(5)
        self.rpa.check_stop()

        self._click_by_type_sort()

    def _click_by_type_sort(self):
        """Click 'By Type' to sort notes if visible."""
        logger.info("[NOTE-RUNNER] Checking for 'By Type' sort option...")
        try:
            by_type_image = config.get_rpa_setting("images.baptist_by_type")
            if by_type_image:
                location = pyautogui.locateOnScreen(by_type_image, confidence=0.8)
                if location:
                    self.rpa.safe_click(location, "By Type (Sort)")
                    logger.info("[NOTE-RUNNER] Clicked 'By Type' sort option")
                    self.rpa.stoppable_sleep(2)
        except Exception as e:
            logger.warning(f"[NOTE-RUNNER] Error checking for 'By Type': {e}")

    def _handle_patient_open_modals(self):
        """Handle modals that appear after opening patient detail."""
        self.rpa.stoppable_sleep(3)
        max_modal_checks = 3

        for _ in range(max_modal_checks):
            modal_handled = False

            try:
                assign_ok = config.get_rpa_setting("images.baptist_assign_relationship_ok")
                location = pyautogui.locateOnScreen(assign_ok, confidence=0.8)
                if location:
                    logger.info("[NOTE-RUNNER] Assign Relationship modal - clicking OK")
                    self.rpa.safe_click(location, "Assign Relationship OK")
                    self.rpa.stoppable_sleep(2)
                    modal_handled = True
                    continue
            except Exception:
                pass

            try:
                ok_modal = config.get_rpa_setting("images.baptist_ok_modal")
                location = pyautogui.locateOnScreen(ok_modal, confidence=0.7)
                if location:
                    logger.info("[NOTE-RUNNER] OK modal detected - clicking OK")
                    self.rpa.safe_click(location, "OK Modal")
                    self.rpa.stoppable_sleep(2)
                    modal_handled = True
                    continue
            except Exception:
                pass

            if not modal_handled:
                break

        self.rpa.stoppable_sleep(2)
        logger.info("[NOTE-RUNNER] Modal handling complete")

    def _click_notes_menu_with_modal_handling(self) -> bool:
        """Click Notes menu with modal handlers."""
        notes_image = config.get_rpa_setting("images.baptist_notes_menu")
        if not notes_image:
            notes_image = config.get_rpa_setting("images.baptist_report_document")
        if not notes_image:
            logger.warning("[NOTE-RUNNER] No notes menu image configured")
            return False

        def handle_assign_relationship(loc):
            self.rpa.safe_click(loc, "Assign Relationship OK")
            self.rpa.stoppable_sleep(2)

        def handle_ok_modal(loc):
            self.rpa.safe_click(loc, "OK Modal")
            self.rpa.stoppable_sleep(2)

        handlers = {}
        try:
            assign_ok = config.get_rpa_setting("images.baptist_assign_relationship_ok")
            if assign_ok:
                handlers[assign_ok] = ("Assign Relationship", handle_assign_relationship)
        except Exception:
            pass
        try:
            ok_modal = config.get_rpa_setting("images.baptist_ok_modal")
            if ok_modal:
                handlers[ok_modal] = ("OK Modal", handle_ok_modal)
        except Exception:
            pass

        location = self.rpa.robust_wait_for_element(
            target_image_path=notes_image,
            target_description="Notes Menu",
            handlers=handlers,
            timeout=30,
            confidence=0.7,
            auto_click=True,
        )

        return location is not None

    def _phase3_find_note(self) -> bool:
        """Phase 3: Use NoteFinderAgent to find the encounter note."""
        rois = get_agent_rois("baptist", "report_finder")
        using_roi = len(rois) > 0
        if using_roi:
            logger.info(f"[NOTE-RUNNER] Phase 3 using ROI mask ({len(rois)} regions)")

        while self.current_step < self.max_steps:
            self.rpa.check_stop()
            self.current_step += 1

            logger.info(f"[NOTE-RUNNER] Step {self.current_step}/{self.max_steps}")

            if using_roi:
                if self.vdi_enhance:
                    upscale_factor = 2.0
                    image_b64 = self.capturer.capture_with_mask_enhanced_base64(
                        rois,
                        enhance=True,
                        upscale_factor=upscale_factor,
                        contrast_factor=1.3,
                        sharpness_factor=1.5,
                    )
                    screen_size = self.capturer.get_screen_size()
                    upscaled_max = int(max(screen_size) * upscale_factor)
                    imgsz = min(upscaled_max, 1920)
                    parsed = self.omniparser.parse_image(
                        f"data:image/png;base64,{image_b64}",
                        screen_size,
                        imgsz_override=imgsz,
                    )
                else:
                    image_b64 = self.capturer.capture_with_mask_base64(rois)
                    parsed = self.omniparser.parse_image(
                        f"data:image/png;base64,{image_b64}",
                        self.capturer.get_screen_size(),
                    )
            else:
                parsed = self.omniparser.parse_screen()
                image_b64 = self._get_image_base64_from_parsed(parsed)
            elements = self._elements_to_dicts(parsed.elements)

            result = self.note_finder.decide_action(
                image_base64=image_b64,
                ui_elements=elements,
                history=self.history,
                current_step=self.current_step,
            )

            self._record_step(
                "note_finder", result.action or result.status, result.reasoning
            )

            if result.status == "finished":
                logger.info("[NOTE-RUNNER] Encounter note found!")
                return True

            if result.status == "error":
                logger.error(f"[NOTE-RUNNER] Agent error: {result.reasoning}")
                return False

            repeat = getattr(result, "repeat", 1) or 1
            self._execute_action(result.action, result.target_id, elements, repeat=repeat)

            self.rpa.stoppable_sleep(self.step_delay)

        logger.warning("[NOTE-RUNNER] Max steps reached without finding note")
        return False

    def _execute_action(
        self, action: str, target_id: Optional[int], elements: list, repeat: int = 1
    ):
        """Execute the action decided by the agent."""
        if action == "nav_up":
            tools.nav_up(times=repeat)
        elif action == "nav_down":
            tools.nav_down(times=repeat)
        elif action == "scroll_up":
            tools.scroll_tree_up(clicks=repeat)
        elif action == "scroll_down":
            tools.scroll_tree_down(clicks=repeat)
        elif action == "click" and target_id is not None:
            tools.click_element(target_id, elements, action="click")
        elif action == "dblclick" and target_id is not None:
            tools.click_element(target_id, elements, action="dblclick")
        elif action == "wait":
            logger.info("[NOTE-RUNNER] Waiting...")
            self.rpa.stoppable_sleep(1)
        else:
            logger.warning(f"[NOTE-RUNNER] Unknown action: {action}")

    def _record_step(self, agent: str, action: str, reasoning: str):
        """Record a step in history."""
        self.history.append(
            {
                "step": self.current_step,
                "agent": agent,
                "action": action,
                "reasoning": reasoning,
                "timestamp": datetime.now().isoformat(),
            }
        )

    def _get_image_base64_from_parsed(self, parsed) -> str:
        """Extract base64 image from parsed screen."""
        if parsed.labeled_image_url and parsed.labeled_image_url.startswith("data:"):
            parts = parsed.labeled_image_url.split(",", 1)
            if len(parts) == 2:
                return parts[1]
        return self.capturer.capture_base64()

    def _elements_to_dicts(self, elements) -> List[Dict]:
        """Convert UIElement objects to dicts for agent consumption."""
        return [
            {
                "id": el.id,
                "type": el.type,
                "content": el.content,
                "center": list(el.center) if el.center else [0, 0],
                "bbox": list(el.bbox) if el.bbox else [0, 0, 0, 0],
            }
            for el in elements
        ]
