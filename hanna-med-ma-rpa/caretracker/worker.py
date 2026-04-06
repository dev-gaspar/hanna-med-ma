"""
Worker function that executes the CareTracker registration logic
when a message is received from Redis.
"""

import json
import logging
import requests

from config import config
from caretracker.service import parse_registration_payload, run_registration

logger = logging.getLogger(__name__)


def send_caretracker_result(patient_id: int, result: dict):
    """Send execution result back to the server."""
    backend_url = config.BACKEND_URL
    if not backend_url:
        logger.warning("No BACKEND_URL configured, cannot send CareTracker result.")
        return

    url = f"{backend_url}/rpa/caretracker/result"
    
    payload = {
        "patientId": int(patient_id),
        "success": bool(result.get("success", False)),
        "status": result.get("status", "FAILED"),
        "patient_emr_id": result.get("patient_emr_id"),
        "message": result.get("message", ""),
        "details": {
            "saved": result.get("saved", False),
            "include_insurance": result.get("include_insurance", False),
            "filled_fields": result.get("filled_fields", {}),
            "search_result": result.get("search_result"),
            "login_result": result.get("login_result"),
        }
    }

    try:
        logger.info(f"Sending CareTracker result to {url} for patient {patient_id} (status={payload['status']})")
        resp = requests.post(url, json=payload, timeout=30)
        
        if resp.status_code in [200, 201]:
            logger.info(f"Successfully sent result for patient {patient_id}")
        else:
            logger.error(f"Server rejected result: {resp.status_code} - {resp.text}")
    except Exception as e:
        logger.error(f"Failed to send result to server: {e}")


def handle_caretracker_task(task_data: dict):
    """
    Callback function that executes the caretracker flow.
    CareTracker runs headless via Playwright — no GUI collision with pyautogui extraction.

    Expected task_data schema:
    {
        "patientId": <int>,
        "patientName": <str>,
        "payload": <dict>
    }
    """
    patient_id = task_data.get("patientId")
    patient_name = task_data.get("patientName", "Unknown")
    raw_payload = task_data.get("payload")
    
    if not patient_id or not raw_payload:
        logger.error("Received invalid CareTracker task (missing patientId or payload)")
        return

    logger.info(f"[CareTracker Worker] Processing task for {patient_name} (ID: {patient_id})")
    
    try:
        # Parse payload
        payload = parse_registration_payload(raw_payload)

        # Extract search_query (simplified name for search, separate from full registration name)
        search_query_data = raw_payload.get("search_query")

        # Execute registration flow in visual mode (Playwright)
        result = run_registration(payload=payload, search_query_data=search_query_data, headless=True)
        
        # Publish result to backend
        send_caretracker_result(patient_id, result)
        
    except Exception as e:
        logger.error(f"[CareTracker Worker] Flow failed for {patient_name}: {e}", exc_info=True)
        send_caretracker_result(patient_id, {
            "success": False,
            "status": "FAILED",
            "message": str(e)
        })
    
    logger.info(f"[CareTracker Worker] Done for {patient_name}")
