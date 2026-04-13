"""
Baptist Note Validator Agent — Validates that an extracted PDF note actually
corresponds to the target encounter (doctor + date + type).

Sub-agent called after the NoteFinderAgent returns "finished" and the PDF has
been saved and read. The agent reviews the PDF text and decides if it matches
the expected doctor and date of service. If not, the flow continues searching.
"""

from typing import Type

from pydantic import BaseModel, Field

from agentic.core.base_agent import BaseAgent


SYSTEM_PROMPT = """You are validating whether a clinical note PDF matches a specific
encounter. You will receive the full text of a Baptist Health / Cerner note and
must decide if it corresponds to the target encounter.

## TARGET ENCOUNTER
- Doctor: {doctor_name} (specialty: {doctor_specialty})
- Date of Service: {date_of_service}
- Encounter Type: {encounter_type}

## WHAT TO CHECK

1. **Doctor match** — The note must be authored by the target doctor. Look for:
   - The doctor's last name in the signature block, header, or "Performed by" line.
   - Credentials variants are acceptable (e.g. "Hanna, Peter DPM" matches "Peter Hanna").
   - The specialty must be consistent (e.g. "Podiatry" appearing in the header/section).

2. **Date match** — The note must be from the expected date of service. Accept
   any of these date formats (all referring to the same day):
   - "07/07/2024", "7/7/2024", "07-07-2024"
   - "July 7, 2024", "Jul 7 2024", "2024-07-07"
   - Dates differing by at most ±1 day are ACCEPTABLE (notes can be signed the
     next morning). Anything else is a mismatch.

3. **Type consistency** — The note type should be plausible for the encounter:
   - CONSULT → "Consultation Note", "Consult", or "H&P" from admission day
   - PROGRESS → "Progress Note", "Follow-up"
   A minor type variant is OK as long as doctor + date match.

## RULES

- If BOTH doctor AND date match (with the tolerances above) → valid=true.
- If either doctor OR date clearly refers to a different encounter → valid=false
  with a short reason naming what mismatches (e.g. "doctor is Rosales MD, not Hanna",
  "date is 03/19/2024, not 07/07/2024").
- If the PDF text is empty, gibberish, or clearly truncated → valid=false, reason
  "PDF content unreadable".
- Do NOT require exact phrase matches. The PDF is machine-extracted — accept
  reasonable variations.
"""


USER_PROMPT = """=== PDF TEXT (extracted from Baptist EMR) ===
{note_text}

=== END OF PDF TEXT ===

Decide whether this note matches the target encounter:
- Doctor: {doctor_name} ({doctor_specialty})
- Date of Service: {date_of_service}
- Encounter Type: {encounter_type}

Return `valid=true` only if both doctor and date clearly match. Otherwise
return `valid=false` with a concise `reason` (under 30 words) naming the
specific mismatch.
"""


class NoteValidationResult(BaseModel):
    valid: bool = Field(
        description="True only if the PDF matches the expected doctor AND date"
    )
    reason: str = Field(
        description="Concise explanation (under 30 words) of match or mismatch"
    )
    detected_doctor: str = Field(
        default="",
        description="Doctor name as it appears in the PDF (signature / header)",
    )
    detected_date: str = Field(
        default="",
        description="Date of service as it appears in the PDF",
    )


class NoteValidatorAgent(BaseAgent):
    """Validates that an extracted note PDF matches the target encounter."""

    emr_type = "baptist"
    agent_name = "note_validator"
    max_steps = 1
    temperature = 0.1

    MAX_PDF_CHARS = 12000

    def __init__(
        self,
        doctor_name: str = "",
        doctor_specialty: str = "",
        encounter_type: str = "CONSULT",
        date_of_service: str = "",
    ):
        super().__init__()
        self.doctor_name = doctor_name
        self.doctor_specialty = doctor_specialty or "Unknown"
        self.encounter_type = encounter_type
        self.date_of_service = date_of_service

    def get_output_schema(self) -> Type[BaseModel]:
        return NoteValidationResult

    def get_system_prompt(self, **kwargs) -> str:
        return SYSTEM_PROMPT.format(
            doctor_name=self.doctor_name or "Unknown",
            doctor_specialty=self.doctor_specialty,
            date_of_service=self.date_of_service or "Unknown",
            encounter_type=self.encounter_type,
        )

    def get_user_prompt(self, note_text: str = "", **kwargs) -> str:
        truncated = (note_text or "")[: self.MAX_PDF_CHARS]
        if not truncated:
            truncated = "(empty PDF)"
        return USER_PROMPT.format(
            note_text=truncated,
            doctor_name=self.doctor_name or "Unknown",
            doctor_specialty=self.doctor_specialty,
            date_of_service=self.date_of_service or "Unknown",
            encounter_type=self.encounter_type,
        )

    def validate(self, note_text: str) -> NoteValidationResult:
        """Run the validator on the extracted PDF text."""
        return self.invoke(image_base64=None, note_text=note_text)
