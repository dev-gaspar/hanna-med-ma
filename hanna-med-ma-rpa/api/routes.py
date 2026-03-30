"""
API Routes - FastAPI endpoint definitions.
Only CareTracker endpoint is exposed.
"""

from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool

from caretracker.service import parse_registration_payload, run_registration

from .models import CareTrackerRunRequest, CareTrackerRunResponse

router = APIRouter()


@router.post("/caretracker/run", response_model=CareTrackerRunResponse)
async def run_caretracker_flow(body: CareTrackerRunRequest):
    """
    Execute CareTracker flow with payload received over HTTP.

    The request payload must include:
    - patient_details
    - insurance_periods (optional, can be empty array)
    """

    def _execute():
        payload = parse_registration_payload(body.payload)
        return run_registration(payload=payload, headless=body.headless)

    result = await run_in_threadpool(_execute)
    return result
