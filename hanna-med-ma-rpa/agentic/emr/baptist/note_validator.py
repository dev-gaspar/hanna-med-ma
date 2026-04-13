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

## HOW TO READ A CERNER PDF — IMPORTANT

A Cerner note lists a lot of embedded content (labs, radiology orders,
medications, past procedures). Those embedded sections have their OWN authors
and dates (e.g. radiologist who read a pre-op X-ray on the day of admission).

**Those embedded items are NOT the author or date of this document.**

The real author and date of THIS note live in the note's metadata block,
which typically appears near the END of the PDF as lines like:

    Signature Line
    Electronically Signed on 07/07/2024 09:55
    _____________________________________
    Hanna, Peter H. DPM

    Result type:    Podiatry Consultation
    Result date:    July 07, 2024 9:46 EDT
    Result status:  Modified
    Result title:   Consult Note
    Performed by:   Hanna, Peter H DPM on July 07, 2024 9:55 EDT
    Verified by:    Hanna, Peter H DPM on July 07, 2024 9:55 EDT

When judging doctor + date, anchor ONLY on these metadata lines
(Result date / Performed by / Verified by / Signature Line). Ignore authors
and dates of embedded radiology / lab / medication / history items.

## WHAT TO CHECK

1. **Doctor match** — The note must be authored by the target doctor. Look at:
   - "Performed by:" / "Verified by:" / Signature Line near the end of the PDF
   - Last-name match is sufficient (e.g. "Hanna, Peter H DPM" matches "Peter Hanna")
   - Specialty must be consistent (e.g. Result type "Podiatry Consultation" for Podiatry)

2. **Date match** — Use the note's "Result date" / "Performed by <date>" /
   "Electronically Signed on <date>" fields. Accept these as the same day:
   - "07/07/2024", "7/7/2024", "07-07-2024"
   - "July 7, 2024", "Jul 7 2024", "2024-07-07"
   - A note signed the morning after (±1 day) is ACCEPTABLE. Anything further
     off is a mismatch.

3. **Type consistency**:
   - CONSULT → "Consultation Note" / "Consult Note" / admission "H&P"
   - PROGRESS → "Progress Note" / "Follow-up"

## RULES

- If doctor AND date both match the note's own metadata → valid=true.
- If the metadata clearly refers to a different encounter → valid=false with a
  concise reason quoting the mismatching metadata value.
- If you cannot find a signature / "Performed by" / "Result date" block in the
  provided text → valid=false, reason "metadata block not in extract".
- NEVER use an embedded radiologist / lab tech / prior-encounter author as the
  note's author. They are references, not signers.
"""


USER_PROMPT = """The extracted PDF is split in two slices so the signature / metadata block
near the end is always visible even when the PDF is long.

=== PDF HEAD (start of the document) ===
{head_text}

=== PDF TAIL (end of the document — contains signature / Result date / Performed by) ===
{tail_text}

=== END ===

Decide whether this note matches the target encounter:
- Doctor: {doctor_name} ({doctor_specialty})
- Date of Service: {date_of_service}
- Encounter Type: {encounter_type}

Anchor your decision on "Performed by" / "Verified by" / "Result date" /
"Signature Line" lines from the TAIL section. Return `valid=true` only if
both doctor and date match. Otherwise return `valid=false` with a concise
`reason` (under 30 words) quoting the actual metadata you found.
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

    # Feed the validator two slices so Cerner's signature / metadata block
    # (which lives at the very end of the PDF) is always visible regardless
    # of how long the embedded radiology / labs / history sections are.
    HEAD_CHARS = 6000
    TAIL_CHARS = 8000

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

    def _split_head_tail(self, note_text: str) -> tuple[str, str]:
        """
        Split the note into HEAD (start) and TAIL (end).
        Cerner's document metadata (Result type / Result date / Performed by /
        Signature Line) always sits at the very end of the PDF. If the PDF is
        short enough, HEAD covers everything and TAIL is the same content.
        """
        text = note_text or ""
        total = len(text)

        if total == 0:
            return "(empty PDF)", "(empty PDF)"

        if total <= self.HEAD_CHARS + self.TAIL_CHARS:
            return text, text

        head = text[: self.HEAD_CHARS]
        tail = text[-self.TAIL_CHARS :]
        return head, tail

    def get_user_prompt(self, note_text: str = "", **kwargs) -> str:
        head, tail = self._split_head_tail(note_text or "")
        return USER_PROMPT.format(
            head_text=head,
            tail_text=tail,
            doctor_name=self.doctor_name or "Unknown",
            doctor_specialty=self.doctor_specialty,
            date_of_service=self.date_of_service or "Unknown",
            encounter_type=self.encounter_type,
        )

    def validate(self, note_text: str) -> NoteValidationResult:
        """Run the validator on the extracted PDF text."""
        return self.invoke(image_base64=None, note_text=note_text)
