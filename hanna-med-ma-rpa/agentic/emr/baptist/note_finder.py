"""
Baptist Note Finder Agent — Finds a provider's note for a specific encounter.

The notes tree is organized by "Performed By" (grouped by author).
The agent's strategy is:
  1. Find the doctor's folder by name
  2. Expand that folder
  3. Navigate documents inside, checking the content in the right pane
     for a match on date + encounter type
"""

from typing import Any, Dict, List, Literal, Optional, Type

from pydantic import BaseModel, Field

from agentic.core.base_agent import BaseAgent
from logger import logger


SYSTEM_PROMPT = """You are an RPA assistant navigating a Cerner EMR Notes tree view for Baptist Health.

The notes tree is organized by "Performed By" — each folder is named after the provider
who wrote the notes inside it. Your job is to find a specific clinical note for one doctor.

## WHAT YOU ARE LOOKING FOR
A clinical note written by **{doctor_name}** ({doctor_specialty}) on or near
**{date_of_service}** for an encounter of type **{encounter_type}**.

## NAVIGATION STRATEGY

### Phase A — Find the doctor's folder
- The tree is ordered alphabetically by provider name (last name).
- Look at the visible folder names for one matching the doctor. Match can be by:
  - Last name (e.g. "Hanna")
  - First + last name (e.g. "Peter Hanna", "Hanna, Peter")
  - Partial OCR of the name (e.g. "Han..." — use reasoning to confirm)
- Notes from the doctor may also be split across variants of their name
  (with credentials like "DPM", "MD", etc.). Check carefully.
- Use **scroll_down / scroll_up** to find the folder if it's not visible.
- Once you SEE the folder → use **dblclick** on its row to expand it.

### Phase B — Navigate documents inside the folder
Inside the doctor's folder you will see a list of document entries.
**Document names do NOT always show the date.** You MUST click each document
(or use nav_down) and check the right pane content to determine its date and type.

- Use **nav_down / nav_up** to step through documents one by one.
  Each nav auto-loads the document content in the right pane.
- For each document shown in the right pane, look for:
  - **Date** at the top (e.g. "Result date: March 19, 2026 23:18 EDT")
  - **Document type** (e.g. "History and Physical", "Consultation Note", "Progress Note")
  - **Provider signature** at the bottom
- If the document's date matches the encounter date AND the type matches the
  encounter type → status="finished".

### Encounter type mapping
- CONSULT → First visit — expect "Consultation Note"
- PROGRESS → Follow-up — expect "Progress Note"
- An H&P (History and Physical) from admission day can also match if it's the
  doctor's first encounter (CONSULT) with this patient.

## RESPONSE RULES

1. **Folders vs documents**:
   - scroll_down/scroll_up → find FOLDERS (Phase A)
   - dblclick → expand a folder
   - nav_down/nav_up → navigate DOCUMENTS inside an open folder (Phase B)

2. **Never**:
   - Use nav_down to find folders
   - Skip reading the right pane to confirm the document

3. **Finishing criteria**:
   - RIGHT PANE shows a note from {doctor_name} (or matching specialty)
   - Date visible in right pane matches {date_of_service} (within 1 day)
   - Type matches {encounter_type}
   - Return status="finished"

4. **Error criteria**:
   - Doctor's folder not found after scrolling through the whole tree
   - Doctor's folder has no documents matching the date
   - Exhausted max steps
   - Return status="error" with clear reasoning

## RESPONSE FORMAT
Always explain your reasoning as: "Phase X: What I see → What I'm doing → Why"
"""


USER_PROMPT = """
=== ENCOUNTER DETAILS ===
Doctor: {doctor_name}
Specialty: {doctor_specialty}
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

Decide your next action. Remember: the tree is sorted by Performed By,
so folders are provider names — find the folder for {doctor_name}, expand it,
and navigate its documents checking the right pane for a match on date and type.
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
    """Agent that finds a provider's note by doctor folder + encounter match."""

    emr_type = "baptist"
    agent_name = "note_finder"
    max_steps = 30
    temperature = 0.3

    def __init__(
        self,
        doctor_name: str = "",
        doctor_specialty: str = None,
        encounter_type: str = "CONSULT",
        date_of_service: str = "",
        patient_name: str = "",
    ):
        super().__init__()
        self.doctor_name = doctor_name
        self.doctor_specialty = doctor_specialty
        self.encounter_type = encounter_type
        self.date_of_service = date_of_service
        self.patient_name = patient_name

    def get_output_schema(self) -> Type[BaseModel]:
        return NoteFinderResult

    def get_system_prompt(self, **kwargs) -> str:
        return SYSTEM_PROMPT.format(
            doctor_name=self.doctor_name or "Unknown",
            doctor_specialty=self.doctor_specialty or "Unknown",
            date_of_service=self.date_of_service or "Unknown",
            encounter_type=self.encounter_type,
        )

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
            "First visit — look for Consultation Note or admission H&P"
            if self.encounter_type == "CONSULT"
            else "Follow-up visit — look for Progress Note"
        )

        return USER_PROMPT.format(
            doctor_name=self.doctor_name or "Unknown",
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
                "If you're inside a folder with no match, exit and try another folder."
            )
        if nav_up_count >= 3:
            return (
                f"WARNING: You have used nav_up {nav_up_count} times. "
                "Consider exiting this folder or trying a different approach."
            )
        if nav_down_count >= 2 and nav_up_count >= 2:
            return (
                "WARNING: You are alternating between nav_up and nav_down. "
                "This suggests a loop. Try a different folder."
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
