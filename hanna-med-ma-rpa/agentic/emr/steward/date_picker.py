"""
DatePickerAgent for Steward EMR (Meditech).
Selects start and end dates on the lab results date-range modal.

The agent sees three ROI regions:
1. lab_date_selected  - Currently selected start/end dates
2. lab_month_header   - Month/year shown in the calendar
3. lab_calendar_days  - Grid of day numbers

It clicks on the start date (1 week before today) and end date (today),
navigating months if needed.
"""

from datetime import datetime, timedelta
from typing import Any, Dict, List, Literal, Optional, Type

from pydantic import BaseModel, Field

from agentic.core.base_agent import BaseAgent
from logger import logger


SYSTEM_PROMPT = """You are DatePickerAgent for Steward Health System (Meditech EMR).

TASK: Select a date range on the calendar modal for lab results.

=== TARGET DATE RANGE ===
- START DATE: {start_date_display} (day {start_day})
- END DATE:   {end_date_display} (day {end_day})

=== HOW THIS DATE PICKER WORKS ===

This is a RANGE date picker. It works like this:
- The 1st click sets the START date of the range.
- The 2nd click sets the END date of the range.
- If you click a 3rd time, it RESETS and starts a new range (that click becomes the new start).
- The top region shows "From: MM/DD/YY Thru: MM/DD/YY" with the currently selected range.

=== WHAT YOU SEE ===

Three visible regions:

1. HEADER (top): Shows the currently selected range.
   Format: "From: MM/DD/YY Thru: MM/DD/YY"
   READ THIS CAREFULLY to know what dates are currently selected.

2. MONTH LABEL (middle): Shows the current month and year (e.g., "March 2026").
   May have arrows (<, >) to navigate between months.

3. CALENDAR GRID (bottom): Day numbers for the current month.
   Each day number is a clickable UI element with its own ID.

=== CRITICAL: HOW TO IDENTIFY DAY NUMBERS ===

Each UI element has a 'content' field that contains the TEXT shown on screen.
To find a specific day:
1. Look at the UI_ELEMENTS list below.
2. Find the element whose 'content' field EXACTLY matches the day number you need.
3. For example, to click day 12, find the element where content='12'.
4. Use THAT element's ID as target_id.

DO NOT try to calculate grid positions or guess which element is which day.
ALWAYS match by the element's 'content' text.

If multiple elements have the same day number text (e.g., from adjacent months),
pick the one that is within the main calendar grid area (not grayed out).

=== STEP-BY-STEP PROCESS ===

1. READ the header to see what dates are currently selected.
2. If the header already shows "From: {start_mm_dd} Thru: {end_mm_dd}" -> return status="finished".
3. If the header shows the wrong dates or no selection:
   a. Find the element whose content='{start_day}' (for start date) or content='{end_day}' (for end date).
   b. Click it.
   c. After clicking, wait for the UI to update (use action="wait").
   d. On the next step, READ the header again to verify.

=== AVAILABLE ACTIONS ===

| Status     | Action   | When to use                                        |
|------------|----------|----------------------------------------------------|
| running    | click    | Click on a day number element (by content match)    |
| running    | wait     | Wait for UI to update after a click                 |
| finished   | -        | Header shows correct From/Thru dates                |
| error      | -        | Cannot complete after many attempts                 |

=== RULES ===

1. ALWAYS verify the header FIRST before clicking anything.
2. ALWAYS identify days by their element CONTENT text, not by position.
3. After each click, use action="wait" so the header updates.
4. If the start date is wrong but end date is correct, you need to click start day
   (this will RESET the range), then click end day again.
5. target_id MUST be a valid ID from the UI_ELEMENTS list.
6. Maximum {max_steps} steps - be efficient!
7. If the calendar shows the wrong month, click the left/right arrow to navigate."""


USER_PROMPT = """Analyze this screenshot of the Meditech date-range calendar modal.

=== GOAL ===
Select range: From {start_date_display} Thru {end_date_display}
Start day number: {start_day}
End day number: {end_day}

Step: {current_step}/{max_steps}

=== UI ELEMENTS DETECTED ===
{elements_text}

=== YOUR PREVIOUS ACTIONS ===
{history}

=== WHAT TO DO ===

1. FIRST: Read the header region to see what dates are currently selected.
   - If it shows "From: {start_mm_dd} Thru: {end_mm_dd}" (or equivalent) -> return status="finished"

2. If dates are NOT correct:
   - Determine what needs to be clicked next.
   - Find the element whose 'content' field matches the day number you need.
   - For day {start_day}: find element with content='{start_day}'
   - For day {end_day}: find element with content='{end_day}'
   - Return the element's ID as target_id.

3. If you just clicked a day, use action="wait" to let the header update.

REMEMBER:
- 1st click = start date, 2nd click = end date, 3rd click = RESET
- Match days by element CONTENT text, not by grid position
- Verify the header after each click

Decide your response."""


class DatePickerResult(BaseModel):
    """Structured output for DatePickerAgent."""

    status: Literal["running", "finished", "error"] = Field(
        description="'finished' when header shows correct From/Thru dates, 'running' to continue, 'error' if stuck"
    )
    action: Optional[Literal["click", "wait"]] = Field(
        default=None,
        description="Action to perform when status='running'.",
    )
    target_id: Optional[int] = Field(
        default=None,
        description="Element ID to click. Must match by element content text. Required when action='click'.",
    )
    reasoning: str = Field(
        description="1) What the header currently shows. 2) What you need to do. 3) Which element content matches."
    )


class DatePickerAgent(BaseAgent):
    """
    Agent that selects start and end dates on Steward's lab results calendar modal.
    Uses ROI masking to see the date selection area, month header, and day grid.
    """

    emr_type = "steward"
    agent_name = "date_picker"
    max_steps = 20
    temperature = 0.1

    def __init__(self):
        super().__init__()
        today = datetime.now()
        self.end_date = today
        start_candidate = today - timedelta(days=7)
        if start_candidate.month < today.month or start_candidate.year < today.year:
            self.start_date = today.replace(day=1)
        else:
            self.start_date = start_candidate

    def get_output_schema(self) -> Type[BaseModel]:
        return DatePickerResult

    def get_system_prompt(self, **kwargs) -> str:
        return SYSTEM_PROMPT.format(
            start_date_display=self.start_date.strftime("%m/%d/%Y"),
            end_date_display=self.end_date.strftime("%m/%d/%Y"),
            start_day=self.start_date.day,
            end_day=self.end_date.day,
            start_mm_dd=self.start_date.strftime("%m/%d"),
            end_mm_dd=self.end_date.strftime("%m/%d"),
            max_steps=self.max_steps,
        )

    def get_user_prompt(
        self,
        elements_text: str = "",
        current_step: int = 1,
        history: str = "",
        **kwargs,
    ) -> str:
        return USER_PROMPT.format(
            elements_text=elements_text,
            current_step=current_step,
            max_steps=self.max_steps,
            start_date_display=self.start_date.strftime("%m/%d/%Y"),
            end_date_display=self.end_date.strftime("%m/%d/%Y"),
            start_day=self.start_date.day,
            end_day=self.end_date.day,
            start_mm_dd=self.start_date.strftime("%m/%d"),
            end_mm_dd=self.end_date.strftime("%m/%d"),
            history=history,
        )

    def decide_action(
        self,
        image_base64: str,
        ui_elements: List[Dict[str, Any]],
        history: List[Dict[str, Any]],
        current_step: int,
    ) -> DatePickerResult:
        """
        Decide the next action to select dates.

        Args:
            image_base64: Base64-encoded screenshot (ROI masked)
            ui_elements: List of UI elements from OmniParser
            history: List of previous action records
            current_step: Current step number

        Returns:
            DatePickerResult with action to take
        """
        logger.info(
            f"[DATE_PICKER] Step {current_step} - "
            f"selecting {self.start_date.strftime('%m/%d')} to {self.end_date.strftime('%m/%d')}..."
        )

        elements_text = self.format_ui_elements(ui_elements)
        history_text = self._format_history(history)

        result = self.invoke(
            image_base64=image_base64,
            elements_text=elements_text,
            current_step=current_step,
            history=history_text,
        )

        logger.info(
            f"[DATE_PICKER] Decision: status={result.status}, action={result.action}, "
            f"target_id={result.target_id}"
        )
        return result

    def reset(self):
        """Reset the agent state for a new patient."""
        today = datetime.now()
        self.end_date = today
        start_candidate = today - timedelta(days=7)
        if start_candidate.month < today.month or start_candidate.year < today.year:
            self.start_date = today.replace(day=1)
        else:
            self.start_date = start_candidate

    def _format_history(self, history: List[Dict[str, Any]]) -> str:
        """Format action history for the prompt."""
        if not history:
            return "No previous actions (this is step 1)."

        lines = []
        for h in history[-10:]:
            step = h.get("step", "?")
            action = h.get("action", "?")
            reasoning = h.get("reasoning", "")[:400]
            lines.append(f"Step {step}: {action} - {reasoning}")

        return "\n".join(lines)
