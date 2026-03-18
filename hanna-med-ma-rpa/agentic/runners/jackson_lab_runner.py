"""
Jackson Lab Runner - Local orchestrator for patient lab results extraction.

Follows the same pattern as JacksonInsuranceRunner:
1. PatientFinderAgent - Find patient in list
2. RPA - Open patient detail (with modal handling)

The runner only opens the patient detail. Lab extraction steps
(Results Review, Group, Print, PDF) are handled by the flow.
"""

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

import pyautogui

from config import config
from core.rpa_engine import RPABotBase
from logger import logger

from agentic.emr.jackson.patient_finder import PatientFinderAgent
from agentic.emr.jackson import tools
from agentic.models import AgentStatus
from agentic.omniparser_client import get_omniparser_client
from agentic.screen_capturer import get_screen_capturer, get_agent_rois
from version import __version__


@dataclass
class LabRunnerResult:
    """Result from JacksonLabRunner."""

    status: AgentStatus
    execution_id: str
    steps_taken: int = 0
    error: Optional[str] = None
    history: List[Dict[str, Any]] = field(default_factory=list)
    patient_detail_open: bool = False


class JacksonLabRunner:
    """
    Local orchestrator for Jackson patient lab flow.

    Chains specialized agents:
    1. PatientFinderAgent - Finds patient element
    2. RPA actions - Opens patient detail (with modal handling)

    Only opens patient detail. The lab extraction steps (Results Review,
    Unpin, Labs Group, Print to PDF, text extraction) are handled by the
    calling flow.
    """

    def __init__(
        self,
        max_steps: int = 15,
        step_delay: float = 1.5,
    ):
        self.max_steps = max_steps
        self.step_delay = step_delay

        # Components
        self.omniparser = get_omniparser_client()
        self.capturer = get_screen_capturer()
        self.patient_finder = PatientFinderAgent()

        # RPA Bot instance for robust modal handling
        self.rpa = RPABotBase()

        # State
        self.execution_id = ""
        self.history: List[Dict[str, Any]] = []
        self.current_step = 0

    def run(self, patient_name: str) -> LabRunnerResult:
        """
        Run the flow to find and open patient detail.

        Args:
            patient_name: Name of patient to find

        Returns:
            LabRunnerResult with outcome
        """
        self.execution_id = str(uuid.uuid4())[:8]
        self.history = []
        self.current_step = 0
        patient_detail_opened = False

        logger.info("=" * 70)
        logger.info(" LOCAL JACKSON LAB RUNNER - STARTING")
        logger.info(f" VERSION: {__version__}")
        logger.info("=" * 70)
        logger.info(f"[LAB-RUNNER] Execution ID: {self.execution_id}")
        logger.info(f"[LAB-RUNNER] Patient: {patient_name}")
        logger.info("=" * 70)

        try:
            # === PHASE 1: Find Patient (with retry for OCR failures) ===
            logger.info("[LAB-RUNNER] Phase 1: Finding patient...")
            max_retries = 3
            patient_result = None
            phase1_elements = None

            for attempt in range(1, max_retries + 1):
                patient_result, phase1_elements = self._phase1_find_patient(
                    patient_name
                )

                if patient_result.status == "found":
                    break
                elif patient_result.status == "retry":
                    logger.info(
                        f"[LAB-RUNNER] Retry {attempt}/{max_retries} - "
                        "OCR didn't detect patient, retrying..."
                    )
                    self.rpa.stoppable_sleep(1.5)
                    continue
                else:  # not_found
                    break

            if patient_result.status == "not_found" or (
                patient_result.status == "retry" and attempt == max_retries
            ):
                logger.warning("[LAB-RUNNER] Patient not found in list")
                return LabRunnerResult(
                    status=AgentStatus.PATIENT_NOT_FOUND,
                    execution_id=self.execution_id,
                    steps_taken=self.current_step,
                    error=f"Patient '{patient_name}' not found",
                    history=self.history,
                    patient_detail_open=False,
                )

            patient_element_id = patient_result.element_id
            logger.info(
                f"[LAB-RUNNER] Phase 1 complete - Patient at element "
                f"{patient_element_id}"
            )

            # === PHASE 2: Open Patient Detail (RPA) ===
            logger.info("[LAB-RUNNER] Phase 2: Opening patient detail...")
            self._phase2_open_patient(patient_element_id, phase1_elements)
            patient_detail_opened = True
            logger.info("[LAB-RUNNER] Phase 2 complete - Patient detail open")

            logger.info("=" * 70)
            logger.info(" LOCAL JACKSON LAB RUNNER - FINISHED")
            logger.info(f" Steps: {self.current_step}")
            logger.info("=" * 70)

            return LabRunnerResult(
                status=AgentStatus.FINISHED,
                execution_id=self.execution_id,
                steps_taken=self.current_step,
                history=self.history,
                patient_detail_open=True,
            )

        except Exception as e:
            logger.error(f"[LAB-RUNNER] Error: {e}", exc_info=True)
            return LabRunnerResult(
                status=AgentStatus.ERROR,
                execution_id=self.execution_id,
                steps_taken=self.current_step,
                error=str(e),
                history=self.history,
                patient_detail_open=patient_detail_opened,
            )

    def _phase1_find_patient(self, patient_name: str):
        """
        Phase 1: Use PatientFinderAgent to locate patient.

        Returns:
            Tuple of (agent_result, elements_list)
        """
        self.current_step += 1

        rois = get_agent_rois("jackson", "patient_finder")
        if rois:
            image_b64 = self.capturer.capture_with_mask_base64(rois)
            parsed = self.omniparser.parse_image(
                f"data:image/png;base64,{image_b64}",
                self.capturer.get_screen_size(),
            )
            logger.info(
                f"[LAB-RUNNER] Phase 1 using ROI mask ({len(rois)} regions)"
            )
        else:
            parsed = self.omniparser.parse_screen()
            image_b64 = self._get_image_base64_from_parsed(parsed)
        elements = self._elements_to_dicts(parsed.elements)

        result = self.patient_finder.find_patient(
            patient_name=patient_name,
            image_base64=image_b64,
            ui_elements=elements,
        )

        self._record_step("patient_finder", result.status, result.reasoning)
        return result, elements

    def _phase2_open_patient(self, element_id: int, elements: list):
        """
        Phase 2: RPA to open patient detail.
        Uses robust modal handling for Same Name Alert and
        Assign Relationship modals.

        Args:
            element_id: ID of patient element from Phase 1
            elements: Elements list from Phase 1 (SAME IDs)
        """
        self.current_step += 1

        result = tools.click_element(element_id, elements, action="dblclick")
        self._record_step(
            "rpa",
            "dblclick_patient",
            f"Double-clicked patient element {element_id}: {result}",
        )

        logger.info(
            "[LAB-RUNNER] Waiting for patient detail (with modal handling)..."
        )
        self._handle_patient_open_modals()
        self.rpa.check_stop()

        logger.info("[LAB-RUNNER] Waiting 5s for screen to stabilize...")
        self.rpa.stoppable_sleep(5)

    def _handle_patient_open_modals(self):
        """
        Handle modals that may appear after double-clicking a patient:
        - Same Name Alert: Just click OK
        - Assign a Relationship: Click OK
        - Info Modal: Press Enter
        """
        self.rpa.stoppable_sleep(3)

        max_modal_checks = 3
        for _ in range(max_modal_checks):
            modal_handled = False

            try:
                same_name_ok = config.get_rpa_setting(
                    "images.jackson_same_name_alert_ok"
                )
                location = pyautogui.locateOnScreen(same_name_ok, confidence=0.8)
                if location:
                    logger.info(
                        "[LAB-RUNNER] Same Name Alert detected - clicking OK"
                    )
                    self.rpa.safe_click(location, "Same Name Alert OK")
                    self._record_step(
                        "rpa", "handle_modal", "Same Name Alert - clicked OK"
                    )
                    self.rpa.stoppable_sleep(2)
                    modal_handled = True
                    continue
            except Exception:
                pass

            try:
                assign_ok = config.get_rpa_setting(
                    "images.jackson_assign_relationship_ok"
                )
                location = pyautogui.locateOnScreen(assign_ok, confidence=0.8)
                if location:
                    logger.info(
                        "[LAB-RUNNER] Assign Relationship modal - clicking OK"
                    )
                    self.rpa.safe_click(location, "Assign Relationship OK")
                    self._record_step(
                        "rpa", "handle_modal",
                        "Assign Relationship - clicked OK",
                    )
                    self.rpa.stoppable_sleep(2)
                    modal_handled = True
                    continue
            except Exception:
                pass

            try:
                info_modal = config.get_rpa_setting("images.jackson_info_modal")
                location = pyautogui.locateOnScreen(info_modal, confidence=0.8)
                if location:
                    logger.info(
                        "[LAB-RUNNER] Info modal detected - pressing Enter"
                    )
                    pyautogui.press("enter")
                    self._record_step(
                        "rpa", "handle_modal", "Info Modal - pressed Enter"
                    )
                    self.rpa.stoppable_sleep(2)
                    modal_handled = True
                    continue
            except Exception:
                pass

            if not modal_handled:
                break

        self.rpa.stoppable_sleep(2)
        logger.info("[LAB-RUNNER] Modal handling complete")

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
        """Extract base64 image from parsed screen or capture new one."""
        if parsed.labeled_image_url and parsed.labeled_image_url.startswith("data:"):
            parts = parsed.labeled_image_url.split(",", 1)
            if len(parts) == 2:
                return parts[1]
        return self.capturer.capture_base64()

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
