"""
Baptist Note Finder Agent — Finds provider notes by date, specialty and encounter type.

Same pattern as ReportFinderAgent but with a prompt focused on finding
billing-relevant clinical notes for a specific encounter.
"""

from typing import Any, Dict, List, Literal, Optional, Type

from pydantic import BaseModel, Field

from agentic.core.base_agent import BaseAgent
from logger import logger


SYSTEM_PROMPT = """You are an RPA assistant navigating a Cerner EMR Notes tree view for Baptist Health.

## YOUR TASK
Find the **provider's clinical note** for a specific patient encounter.

You are looking for a note that matches ALL of these criteria:
- **Date:** Written on or near the date of service provided
- **Specialty:** Written by a provider of the specified specialty
- **Type:** Matches the encounter type (Consultation Note OR Progress Note)

## ENCOUNTER DETAILS (provided in user prompt)
- Doctor Specialty (e.g. "Podiatry")
- Encounter Type: CONSULT (first visit) or PROGRESS (follow-up)
- Date of Service (the date the doctor saw the patient)

## NOTE PRIORITY (by encounter type)

### If CONSULT (first visit):
1. "Consultation Notes" folder → Specialty sub-folder (e.g. "Podiatry Cons")
2. "History and Physical Notes" folder (H&P from admission)
3. "Progress Notes" folder → Specialty sub-folder

### If PROGRESS (follow-up):
1. "Progress Notes" folder → Specialty sub-folder (e.g. "Podiatry Progress")
2. "Consultation Notes" folder → Specialty sub-folder
3. "History and Physical Notes" folder

## NAVIGATION RULES

### Folder Navigation
- **DBLCLICK** parent folders to expand/collapse them
- **CLICK** sub-folders to select, then **DBLCLICK** to expand
- **NAV_DOWN** to browse documents WITHIN an expanded sub-folder
- **SCROLL_DOWN/UP** to find folders in the tree (Phase 1 scanning)

### Critical Rules
1. scroll_down/up = Find FOLDERS (scanning the tree)
2. nav_down/up = Browse DOCUMENTS inside a folder
3. NEVER use nav_down to find folders
4. Once you SEE a folder → CLICK it, don't nav towards it
5. nav_down/up AUTO-OPEN documents in the right pane

### Date Matching
- The note date should match or be within 1 day of the date of service
- Dates in the tree are formatted as MM/DD/YYYY or M/D/YYYY
- Look at the date column next to the document name

### Specialty Matching
- Look for sub-folders matching the doctor's specialty
- Example: Podiatry → "Podiatry Cons", "Podiatry Progress"
- If no exact specialty folder, check the document content in the right pane

### What to SKIP
- "23 Hour History and Physical Update Note"
- "Nurse Progress Note" (unless absolute last resort)
- Notes from other specialties (unless matching date and no specialty-specific note exists)
- Notes from dates that don't match the encounter

### Folder Exploration
- Mark exhausted folders mentally
- NEVER return to a folder already checked
- After 2 scroll actions, if folder not visible → skip to next priority

## SUCCESS CRITERIA
Return status="finished" when the RIGHT PANE shows a clinical note that:
1. Matches the encounter date (within 1 day)
2. Is from the correct specialty (or a comprehensive H&P)
3. Contains valid clinical content (Chief Complaint, HPI, Assessment, Plan, etc.)

## ERROR CONDITIONS
- NOT in Notes tree view
- All priority folders tried with no matching notes
- Past step 28 with no valid document

## RESPONSE FORMAT
Always explain your reasoning as: "Phase X: What I see → What I'm doing → Why"
"""


USER_PROMPT = """
=== ENCOUNTER DETAILS ===
Doctor Specialty: {doctor_specialty}
Encounter Type: {encounter_type} ({encounter_type_description})
Date of Service: {date_of_service}
Patient: {patient_name}

=== CURRENT STATUS ===
Step: {current_step}/30
Steps remaining: {steps_remaining}

=== UI ELEMENTS DETECTED ===
{elements_text}

=== YOUR RECENT ACTIONS ===
{history}

=== LOOP WARNING ===
{loop_warning}

Decide your next action.
"""


class NoteFinderResult(BaseModel):
    status: Literal["running", "finished", "error"] = Field(
        description="Current status of the search"
    )
    action: Optional[
        Literal[
            "click",
            "dblclick",
            "nav_up",
            "nav_down",
            "scroll_up",
            "scroll_down",
            "wait",
        ]
    ] = Field(default=None, description="Action to execute")
    target_id: Optional[int] = Field(
        default=None, description="Element ID for click/dblclick"
    )
    repeat: Optional[int] = Field(
        default=1, description="Repeat count for scroll/nav (1-5)"
    )
    reasoning: str = Field(
        description="Phase X: What I see → What I'm doing → Why"
    )


class NoteFinderAgent(BaseAgent):
    """Agent that finds provider notes by encounter date, specialty and type."""

    emr_type = "baptist"
    agent_name = "note_finder"
    max_steps = 30
    temperature = 0.3

    def __init__(
        self,
        doctor_specialty: str = None,
        encounter_type: str = "CONSULT",
        date_of_service: str = "",
        patient_name: str = "",
    ):
        super().__init__()
        self.doctor_specialty = doctor_specialty
        self.encounter_type = encounter_type
        self.date_of_service = date_of_service
        self.patient_name = patient_name

    def get_output_schema(self) -> Type[BaseModel]:
        return NoteFinderResult

    def get_system_prompt(self, **kwargs) -> str:
        return SYSTEM_PROMPT

    def get_user_prompt(
        self,
        elements_text: str = "",
        current_step: int = 0,
        history: str = "",
        **kwargs,
    ) -> str:
        steps_remaining = self.max_steps - current_step
        loop_warning = self._detect_loop_from_text(history)

        encounter_type_description = (
            "First visit — look for Consultation Note"
            if self.encounter_type == "CONSULT"
            else "Follow-up visit — look for Progress Note"
        )

        return USER_PROMPT.format(
            doctor_specialty=self.doctor_specialty or "Unknown",
            encounter_type=self.encounter_type,
            encounter_type_description=encounter_type_description,
            date_of_service=self.date_of_service or "Unknown",
            patient_name=self.patient_name or "Unknown",
            current_step=current_step,
            steps_remaining=steps_remaining,
            elements_text=elements_text,
            history=history,
            loop_warning=loop_warning,
        )

    def _detect_loop_from_text(self, history: str) -> str:
        if not history:
            return "No loop detected."
        nav_down_count = history.lower().count("nav_down")
        nav_up_count = history.lower().count("nav_up")
        scroll_count = history.lower().count("scroll")
        if nav_down_count >= 3 and scroll_count == 0:
            return (
                f"WARNING: You have used nav_down {nav_down_count} times without scrolling. "
                "If you're not finding the note, try scrolling or checking a different folder."
            )
        if nav_up_count >= 3:
            return (
                f"WARNING: You have used nav_up {nav_up_count} times. "
                "Consider moving to a different folder instead."
            )
        if nav_down_count >= 2 and nav_up_count >= 2:
            return (
                "WARNING: You are alternating between nav_up and nav_down. "
                "This suggests a loop. Move to a different folder."
            )
        return "No loop detected."

    def _format_history(self, history: List[Dict]) -> str:
        if not history:
            return "No actions taken yet."
        recent = history[-10:]
        lines = []
        for entry in recent:
            step = entry.get("step", "?")
            action = entry.get("action", "unknown")
            reasoning = entry.get("reasoning", "")[:500]
            lines.append(f"Step {step}: {action} - {reasoning}")
        return "\n".join(lines)

    def decide_action(
        self,
        image_base64: str,
        ui_elements: List[Dict],
        history: List[Dict],
        current_step: int,
        **kwargs,
    ) -> NoteFinderResult:
        elements_text = self.format_ui_elements(ui_elements)
        history_text = self._format_history(history)

        result = self.invoke(
            image_base64=image_base64,
            elements_text=elements_text,
            current_step=current_step,
            history=history_text,
        )

        logger.info(
            f"[NOTE_FINDER] Response: status='{result.status}' action={result.action} "
            f"target_id={result.target_id} repeat={result.repeat} "
            f"reasoning='{result.reasoning[:120]}'"
        )

        return result
