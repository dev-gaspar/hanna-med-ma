"""
API Models - Pydantic request/response models.
Only CareTracker endpoint models are kept.
"""

from typing import Any, Dict

from pydantic import BaseModel, Field


class CareTrackerRunRequest(BaseModel):
    """Request body for running CareTracker flow."""

    payload: Dict[str, Any] = Field(
        ...,
        description="CareTracker payload JSON (patient_details + insurance_periods)",
    )
    headless: bool = Field(
        default=True,
        description="Run browser in headless mode. Set false to see browser.",
    )


class CareTrackerRunResponse(BaseModel):
    """Response model for CareTracker run endpoint."""

    success: bool
    message: str
    status: str | None = None
    include_insurance: bool | None = None
    insurance_period_count: int | None = None
    filled_fields: Dict[str, Any] | None = None
    screenshot: str | None = None
    saved: bool | None = None
    search_result: Dict[str, Any] | None = None
    login_result: Dict[str, Any] | None = None
