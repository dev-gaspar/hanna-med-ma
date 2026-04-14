"""
Note Execution Summarizer — Produces a long-form narrative summary of what
the NoteFinder agent did during a single note-search attempt.

Called at the end of each attempt in `baptist_note_flow.py`. The narrative
is persisted on `Encounter.noteAgentSummary` and later used as context for
doctor-facing notifications (outside the scope of this plan).
"""

from typing import Any, Dict, List, Type

from pydantic import BaseModel, Field

from agentic.core.base_agent import BaseAgent


SYSTEM_PROMPT = """You are writing an audit-style narrative of a single
attempt by an RPA agent to find a clinical note inside Baptist Health /
Cerner PowerChart.

Your reader is a clinician or technical lead reviewing what happened for
that attempt. Your job is to produce a clear, complete, human-readable
paragraph (or a few paragraphs) describing:
  - What the agent was looking for (doctor, date of service, encounter type).
  - The actions it took in order (alphabet-jump, scrolls, folder expansions,
    document navigations).
  - What it observed at each meaningful step.
  - What the validator concluded (if the flow reached validation).
  - The final outcome for this attempt (found_signed, found_unsigned,
    not_found) and why.

## STYLE

- Narrative, past tense, plain English.
- Do NOT use bullet lists. Write in prose paragraphs.
- Do NOT truncate. Preserve every salient reasoning step from the agent's
  history, even if the narrative gets long. This is an audit log — verbosity
  is valuable.
- Reference the target encounter explicitly (doctor name, date, type).
- If the validator rejected the note, quote the rejection reason verbatim.
- End the narrative with a single final sentence beginning with "Outcome: "
  that restates the result (e.g. "Outcome: note found and signed — uploaded
  to S3." / "Outcome: note not yet signed; another attempt will run in a
  few hours." / "Outcome: no matching document in the provider's folder.").

## WHAT NOT TO INVENT

Stick strictly to what is in the agent's history and the validator result.
Do not guess at document IDs, dates, or signer names that do not appear in
the inputs. If something is unclear, say so honestly ("the agent's log did
not make it clear whether...").
"""


USER_PROMPT = """=== TARGET ENCOUNTER ===
Doctor: {doctor_name}
Specialty: {doctor_specialty}
Encounter type: {encounter_type}
Date of service: {date_of_service}
Patient: {patient_name}
Attempt number: {attempt} of {max_attempts}

=== OUTCOME OF THIS ATTEMPT ===
{outcome}

=== NOTEFINDER AGENT STEP HISTORY (full, do not truncate) ===
{agent_history}

=== VALIDATOR RESULT (if the flow reached validation) ===
{validator_result}

=== YOUR TASK ===
Write the narrative as described in the system prompt. Do not add bullets or
lists — prose only. Do not cap the length. Remember to finish with an
"Outcome: ..." sentence.
"""


class NoteExecutionSummary(BaseModel):
    summary: str = Field(
        description=(
            "Long-form narrative of what the agent did during this attempt. "
            "Prose only, no bullets, ends with an 'Outcome: ...' sentence."
        )
    )


class NoteExecutionSummarizer(BaseAgent):
    """Builds the human-readable audit summary of a single note-search attempt."""

    emr_type = "baptist"
    agent_name = "note_summarizer"
    max_steps = 1
    temperature = 0.2

    def __init__(
        self,
        doctor_name: str = "",
        doctor_specialty: str = "",
        encounter_type: str = "CONSULT",
        date_of_service: str = "",
        patient_name: str = "",
    ):
        super().__init__()
        self.doctor_name = doctor_name
        self.doctor_specialty = doctor_specialty or "Unknown"
        self.encounter_type = encounter_type
        self.date_of_service = date_of_service
        self.patient_name = patient_name

    def get_output_schema(self) -> Type[BaseModel]:
        return NoteExecutionSummary

    def get_system_prompt(self, **kwargs) -> str:
        return SYSTEM_PROMPT

    def get_user_prompt(
        self,
        outcome: str = "unknown",
        agent_history: str = "",
        validator_result: str = "(validator was not reached)",
        attempt: int = 1,
        max_attempts: int = 6,
        **kwargs,
    ) -> str:
        return USER_PROMPT.format(
            doctor_name=self.doctor_name or "Unknown",
            doctor_specialty=self.doctor_specialty,
            encounter_type=self.encounter_type,
            date_of_service=self.date_of_service or "Unknown",
            patient_name=self.patient_name or "Unknown",
            attempt=attempt,
            max_attempts=max_attempts,
            outcome=outcome,
            agent_history=agent_history or "(no steps recorded)",
            validator_result=validator_result,
        )

    @staticmethod
    def format_history(history: List[Dict[str, Any]]) -> str:
        """Render the NoteFinder history as readable step-by-step text."""
        if not history:
            return "(empty)"
        lines = []
        for entry in history:
            step = entry.get("step", "?")
            agent = entry.get("agent", "agent")
            action = entry.get("action", "?")
            reasoning = entry.get("reasoning", "")
            lines.append(f"Step {step} ({agent}) action={action}: {reasoning}")
        return "\n".join(lines)

    def summarize(
        self,
        outcome: str,
        agent_history: List[Dict[str, Any]],
        validator_result: str = "(validator was not reached)",
        attempt: int = 1,
        max_attempts: int = 6,
    ) -> str:
        """Produce the narrative and return it as a plain string."""
        history_text = self.format_history(agent_history)
        result = self.invoke(
            image_base64=None,
            outcome=outcome,
            agent_history=history_text,
            validator_result=validator_result,
            attempt=attempt,
            max_attempts=max_attempts,
        )
        return result.summary
