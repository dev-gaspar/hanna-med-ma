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

**Navigation inside Phase A (choose the right tool):**
- If the current view could contain the folder (near it alphabetically) →
  use **scroll_down / scroll_up** to inspect nearby rows.
- **If after 2 scrolls you have not reached the doctor's alphabetical
  section**, use **press_key** with the first letter of the doctor's LAST NAME
  (e.g. `key="H"` for "Hanna"). The tree will jump directly to the first
  folder starting with that letter. This is much faster than scrolling from
  A through the whole tree. After the jump, continue with small scrolls if
  needed to find the exact folder.
- Once you SEE the folder → use **dblclick** on its row to expand it.

### Phase B — Navigate documents inside the folder
Inside the doctor's folder you will see a list of document entries (e.g.
"Podiatry Consultation", "Podiatry Progress Note"). Each doctor usually has
only a handful of notes.

**IMPORTANT — document ordering inside the folder:**
Documents inside a provider folder are ordered **newest first**. The document
that auto-opens when you expand the folder is the MOST RECENT note. If the
target encounter date is months or years in the past, you will likely need
several `nav_down` steps to reach it. Accept that and walk downward through
the list; the validator will decide if the currently-open document matches.

If you `nav_down` past the last document in this doctor's folder, the
selection will leave the folder and enter a different provider's folder.
When that happens, return `status="error"` with a reasoning explicitly
saying "no matching document found in <doctor>'s folder".

**IMPORTANT — how to navigate documents:**
- Use **nav_down / nav_up** to step through documents one by one.
  Each nav_down/nav_up AUTO-OPENS the next/previous document in the right pane.
- **DO NOT use click** on individual documents — clicking just selects without
  opening. Use ONLY nav_down/nav_up to move between and auto-open documents.
- If the first document is not visible as "selected", use nav_down once to
  open the first document of the folder.

For each document, look at its TITLE in the tree and the content summary in
the right pane to decide if its TYPE plausibly matches the encounter type
(e.g. "Podiatry Consultation" for CONSULT, "Podiatry Progress Note" for
PROGRESS).

**DO NOT try to confirm the date of service visually.**
- The result date (e.g. "July 7, 2024") lives at the very END of the document
  PDF, NOT in the tree view and NOT in the first part of the right pane.
- Trying to scroll the right pane to find the date is a waste of steps and
  leads to loops. The post-extraction validator will read the full PDF and
  confirm the date authoritatively.

- If the document's TITLE / TYPE plausibly matches the encounter type →
  status="finished". Stop here. The validator will verify date + doctor from
  the PDF content.
- If the folder has several plausible candidates, pick the one whose type
  matches best and return finished; if the validator rejects it, the flow
  will automatically call back and you can nav_down to the next one.
- If you've exhausted every document in the folder and none has a plausible
  type → status="error".

### Encounter type mapping (tree-side only)
- CONSULT → first-visit consult — a document titled "Consultation",
  "Consult Note", "<Specialty> Consultation", etc.
- PROGRESS → follow-up — a document titled "Progress Note",
  "<Specialty> Progress Note", "Follow-up".
- **Do NOT treat admission H&P / Intake H&P as a consult match.** Those are
  internal medicine documents, not the target doctor's consult.

## RESPONSE RULES

1. **Folders vs documents**:
   - scroll_down/scroll_up → find FOLDERS (Phase A)
   - press_key → jump to alphabetical section in Phase A (use LAST-NAME letter)
   - dblclick → expand a folder (Phase A, once folder is visible)
   - nav_down/nav_up → navigate DOCUMENTS inside an open folder (Phase B)

2. **Never**:
   - Use nav_down to find folders (Phase A)
   - Use click on documents — use nav_down/nav_up instead (Phase B)
   - Scroll the right pane looking for the date — it is NOT shown there
   - Return to Phase A once you have already expanded the doctor's folder
     (the folder stays expanded; do not press_key or scroll_down again to
     re-find it)

3. **Finishing criteria (keep it simple)**:
   - You are inside the correct doctor's expanded folder, AND
   - A document whose TITLE/TYPE plausibly matches the encounter type is
     ALREADY SELECTED AND AUTO-OPENED in the RIGHT PANE (you can see its
     content — not just its title in the tree)
   - → return status="finished". Trust the post-extraction validator for
     the date + signature check.
   - **If the candidate document is visible in the tree but NOT YET auto-opened
     in the right pane**, DO NOT finish yet. Return status="running" with
     action="nav_down" so the document gets selected, then on the next step
     confirm the right pane shows it and return finished.
   - The PDF extraction captures WHATEVER is currently shown in the right
     pane. Finishing too early (before nav_down moves the selection) causes
     the extractor to capture the default document Cerner auto-opened on
     load (usually a recent admission H&P by Internal Medicine).

4. **Error criteria**:
   - Doctor's folder not found after alphabet-jumping AND a couple of scrolls
   - Doctor's folder contains NO document of a plausible type (e.g. only
     H&Ps when we need a Progress Note)
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
            "press_key",
            "wait",
        ]
    ] = Field(default=None, description="Action to execute")
    target_id: Optional[int] = Field(
        default=None, description="Element ID for click/dblclick"
    )
    repeat: Optional[int] = Field(
        default=1, description="Repeat count for scroll/nav (1-5)"
    )
    key: Optional[str] = Field(
        default=None,
        description="Single letter for press_key action (e.g. 'H' for Hanna)",
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
            "First visit — look for a Consultation / Consult Note"
            if self.encounter_type == "CONSULT"
            else "Follow-up visit — look for a Progress Note"
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
        lowered = history.lower()
        nav_down_count = lowered.count("nav_down")
        nav_up_count = lowered.count("nav_up")
        scroll_down_count = lowered.count("scroll_down")
        scroll_up_count = lowered.count("scroll_up")
        scroll_count = scroll_down_count + scroll_up_count
        press_key_count = lowered.count("press_key")

        if scroll_count >= 2 and press_key_count == 0:
            return (
                f"WARNING: You have scrolled {scroll_count} times without finding "
                "the doctor's folder. STOP scrolling and use press_key with the "
                "first letter of the doctor's LAST NAME to jump to that section."
            )
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
