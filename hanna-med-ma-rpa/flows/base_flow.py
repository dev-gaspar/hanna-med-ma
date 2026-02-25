"""
Base Flow - Abstract base class for all RPA flows.
Provides common flow lifecycle and error handling.
"""

import json
import os
from abc import ABC, abstractmethod
from datetime import datetime
from pathlib import Path

import pyautogui
import pydirectinput
import requests

from config import config
from core.rpa_engine import RPABotBase, rpa_state, set_should_stop
from core.system_utils import keep_system_awake, allow_system_sleep
from core.vdi_input import stoppable_sleep, type_with_clipboard, press_key_vdi
from logger import logger
from services.modal_watcher_service import start_modal_watcher, stop_modal_watcher


def _load_uuid() -> str:
    """Load UUID from rpa_uuid.json."""
    uuid_file = Path("rpa_uuid.json")
    try:
        if uuid_file.exists():
            data = json.loads(uuid_file.read_text())
            if "uuid" in data:
                return data["uuid"]
    except Exception:
        pass
    return "unknown"


class BaseFlow(RPABotBase, ABC):
    """
    Abstract base class for hospital-specific RPA flows.
    Provides common lifecycle management and error handling.
    """

    # Override in subclasses
    FLOW_NAME = "base"
    FLOW_TYPE = "base_flow"
    EMR_TYPE = "base"  # Override: "jackson", "baptist", "steward"

    # Backend URL for data ingestion (replaces n8n webhooks)
    BACKEND_URL = config.BACKEND_URL

    def __init__(self):
        super().__init__()
        self.doctor_id = None
        self.doctor_name = None
        self.credentials = []  # List of credential dicts

    def setup(
        self,
        doctor_id=None,
        doctor_name=None,
        credentials=None,
        **kwargs,
    ):
        """
        Setup flow with execution context.
        Subclasses can override to handle additional kwargs (e.g., patient_name).
        """
        self.doctor_id = doctor_id
        self.doctor_name = doctor_name
        self.credentials = credentials or []

        # Update global state
        rpa_state["doctor_id"] = doctor_id
        rpa_state["doctor_name"] = doctor_name
        rpa_state["status"] = "running"

    def get_credentials_for_system(self, system_key: str) -> dict:
        """
        Get credentials fields for a specific system from the credentials array.
        Returns the fields dict or raises Exception if not found.
        """
        for cred in self.credentials:
            # Handle both dict and Pydantic model
            if hasattr(cred, "systemKey"):
                key = (
                    cred.systemKey.value
                    if hasattr(cred.systemKey, "value")
                    else cred.systemKey
                )
                fields = cred.fields
            else:
                key = cred.get("systemKey", "")
                fields = cred.get("fields", {})

            if key == system_key:
                return fields

        raise Exception(
            f"Credentials for system '{system_key}' not found in doctor configuration"
        )

    def teardown(self):
        """Cleanup after flow execution."""
        rpa_state["status"] = "idle"
        rpa_state["current_step"] = None
        rpa_state["doctor_name"] = None
        rpa_state["doctor_id"] = None
        set_should_stop(False)
        print("[INFO] RPA status: idle")

    def set_step(self, step_name):
        """Set current step in global state."""
        rpa_state["current_step"] = step_name

    @abstractmethod
    def execute(self):
        """
        Execute the flow-specific steps.
        Must be implemented by subclasses.

        Returns:
            Result data (screenshots, pdf_data, etc.)
        """
        pass

    @abstractmethod
    def notify_completion(self, result):
        """
        Notify backend of successful completion.
        Must be implemented by subclasses.
        """
        pass

    # Lobby URL for VDI Desktops
    LOBBY_URL = "https://baptist-health-south-florida.workspaceair.com/catalog-portal/ui#/apps/categories/VDI%2520Desktops"

    def verify_lobby(self):
        """
        Verify we are on the lobby screen. If not, navigate to lobby.
        Also dismisses any blocking OK modal if present.
        """
        logger.info("[LOBBY] Verifying lobby screen...")

        # First, check for and dismiss the OK modal if present
        self._dismiss_ok_modal()

        # Check if we're on the lobby screen
        lobby_visible = self._check_lobby_visible()

        if not lobby_visible:
            logger.info("[LOBBY] Not on lobby screen - navigating...")
            self._navigate_to_lobby()

            # Wait and verify we arrived
            stoppable_sleep(5)

            # Check again for OK modal after navigation
            self._dismiss_ok_modal()

            # Final verification
            if not self._check_lobby_visible():
                logger.warning("[LOBBY] Could not verify lobby after navigation")
            else:
                logger.info("[LOBBY] Successfully navigated to lobby")
        else:
            logger.info("[LOBBY] Already on lobby screen")

    def _check_lobby_visible(self):
        """Check if lobby screen is visible."""
        try:
            location = pyautogui.locateOnScreen(
                config.get_rpa_setting("images.lobby"), confidence=self.confidence
            )
            return location is not None
        except pyautogui.ImageNotFoundException:
            return False
        except Exception:
            return False

    def _dismiss_ok_modal(self):
        """Dismiss the OK modal if it appears (click twice with delay)."""
        try:
            ok_modal = pyautogui.locateOnScreen(
                config.get_rpa_setting("images.ok_modal"), confidence=self.confidence
            )
            if ok_modal:
                logger.info("[LOBBY] OK modal detected - dismissing...")
                center = pyautogui.center(ok_modal)
                pyautogui.click(center)
                stoppable_sleep(2)
                pyautogui.click(center)
                stoppable_sleep(1)
                logger.info("[LOBBY] OK modal dismissed")
        except pyautogui.ImageNotFoundException:
            pass
        except Exception as e:
            logger.warning(f"[LOBBY] Error checking OK modal: {e}")

    def _navigate_to_lobby(self):
        """Navigate to the lobby URL using Ctrl+L."""
        # Focus on URL bar with Ctrl+L
        pydirectinput.keyDown("ctrl")
        stoppable_sleep(0.2)
        pydirectinput.press("l")
        stoppable_sleep(0.2)
        pydirectinput.keyUp("ctrl")
        stoppable_sleep(1)

        # Type the lobby URL
        type_with_clipboard(self.LOBBY_URL)
        stoppable_sleep(0.5)

        # Press Enter to navigate
        press_key_vdi("enter")
        logger.info("[LOBBY] Navigating to lobby URL...")

    def run(
        self,
        doctor_id=None,
        doctor_name=None,
        credentials=None,
        **kwargs,
    ):
        """
        Main entry point - runs the complete flow with error handling.
        Accepts **kwargs for flow-specific parameters (e.g., patient_name).
        """
        logger.info(f"[FLOW] >>> run() started for {self.FLOW_NAME}")

        set_should_stop(False)
        self.setup(
            doctor_id=doctor_id,
            doctor_name=doctor_name,
            credentials=credentials,
            **kwargs,
        )

        logger.info("=" * 70)
        logger.info(f" STARTING {self.FLOW_NAME.upper()}")
        logger.info("=" * 70)
        logger.info(f"[INFO] Doctor ID: {doctor_id} | Doctor: {doctor_name}")
        logger.info(f"[INFO] Credentials loaded: {len(credentials or [])}")
        logger.info(f"[INFO] Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        logger.info("=" * 70)

        keep_system_awake()

        # Start modal watcher to handle unexpected modals during flow execution
        start_modal_watcher()

        # NOTE: verify_lobby() is intentionally NOT called here.
        # Each flow's execute() method opens the browser via step_1 / step_2,
        # and verifies the lobby only AFTER the browser session is established.
        # Calling it here would try to detect a lobby that isn't open yet.

        result = None
        try:
            result = self.execute()

            # Only notify completion if result doesn't have an error
            # (errors are already notified by notify_error() in execute())
            # Note: Baptist returns list of screenshots, summary flows return dict
            has_error = isinstance(result, dict) and result.get("error")
            if result and not has_error:
                self.notify_completion(result)

            print("\n" + "=" * 70)
            print(f" {self.FLOW_NAME.upper()} COMPLETED SUCCESSFULLY")
            print("=" * 70 + "\n")

        except KeyboardInterrupt:
            print(f"\n[STOP] {self.FLOW_NAME} Stopped by User")
            self.notify_error("RPA stopped by user")

        except Exception as e:
            print(f"\n[ERROR] {self.FLOW_NAME} Failed: {e}")
            self.notify_error(str(e))

        finally:
            # Stop modal watcher as flow execution is complete
            stop_modal_watcher()
            allow_system_sleep()
            self.teardown()
            print("[INFO] System ready for new execution\n")

        return result

    def notify_error(self, error_message):
        """Notify backend of an error with screenshot."""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        screenshot_url = None

        # Capture and upload error screenshot
        try:
            screenshot_url = self._capture_error_screenshot(timestamp)
            logger.info(f"[ERROR] Screenshot captured and uploaded: {screenshot_url}")
        except Exception as screenshot_error:
            logger.warning(
                f"[ERROR] Failed to capture error screenshot: {screenshot_error}"
            )

        payload = {
            "uuid": _load_uuid(),
            "hospitalType": self.EMR_TYPE.upper(),
            "error": error_message,
            "screenshotUrl": screenshot_url,
        }
        try:
            response = requests.post(
                f"{self.BACKEND_URL}/rpa/error", json=payload, timeout=15
            )
            logger.info(f"[BACKEND] Error notified - Status: {response.status_code}")
            return response
        except Exception as e:
            logger.error(f"[BACKEND] Failed to notify error: {e}")
            return None

    def _capture_error_screenshot(self, timestamp):
        """Capture screenshot on error and upload to S3."""
        from core.s3_client import get_s3_client

        s3_client = get_s3_client()
        img_buffer = s3_client.take_screenshot()

        # Generate error screenshot filename
        failed_step = rpa_state.get("current_step", "unknown_step")
        filename = f"{self.FLOW_TYPE}/{self.doctor_id or 'unknown'}/error_{failed_step}_{timestamp}.png"

        s3_client.upload_image(img_buffer, filename)
        screenshot_url = s3_client.generate_presigned_url(filename)

        return screenshot_url

    # =========================================================================
    # Fullscreen Toggle Methods (EMR-agnostic)
    # =========================================================================

    def _click_fullscreen(self, max_retries: int = 3) -> bool:
        """
        Click fullscreen button and verify it worked by checking if normalscreen is visible.
        Uses EMR_TYPE to find the correct image in config.

        Args:
            max_retries: Maximum number of retry attempts (default: 3)

        Returns:
            True if fullscreen mode was confirmed, False otherwise
        """
        fullscreen_img_key = f"images.{self.EMR_TYPE.lower()}_fullscreen_btn"
        normalscreen_img_key = f"images.{self.EMR_TYPE.lower()}_normalscreen_btn"

        fullscreen_img = config.get_rpa_setting(fullscreen_img_key)
        normalscreen_img = config.get_rpa_setting(normalscreen_img_key)

        if not fullscreen_img:
            logger.warning(f"[{self.EMR_TYPE.upper()}] Fullscreen image not configured")
            return False

        if not normalscreen_img:
            logger.warning(
                f"[{self.EMR_TYPE.upper()}] Normalscreen image not configured for verification"
            )
            return False

        for attempt in range(max_retries):
            try:
                # Try to click fullscreen button
                location = pyautogui.locateOnScreen(fullscreen_img, confidence=0.8)
                if location:
                    pyautogui.click(pyautogui.center(location))
                    logger.info(
                        f"[{self.EMR_TYPE.upper()}] Clicked fullscreen button (attempt {attempt + 1})"
                    )

                    # Move mouse to screen center to avoid hover interference
                    screen_w, screen_h = pyautogui.size()
                    pyautogui.moveTo(screen_w // 2, screen_h // 2)
                    stoppable_sleep(2)  # Wait for UI to transition

                    # Verify fullscreen by checking if normalscreen button is now visible
                    normalscreen_location = pyautogui.locateOnScreen(
                        normalscreen_img, confidence=0.8
                    )
                    if normalscreen_location:
                        logger.info(
                            f"[{self.EMR_TYPE.upper()}] Fullscreen mode confirmed (normalscreen button visible)"
                        )
                        return True
                    else:
                        logger.warning(
                            f"[{self.EMR_TYPE.upper()}] Fullscreen not confirmed - normalscreen button not visible "
                            f"(attempt {attempt + 1}/{max_retries})"
                        )
                        if attempt < max_retries - 1:
                            stoppable_sleep(1)
                            continue
                else:
                    # Check if already in fullscreen (normalscreen visible means already fullscreen)
                    normalscreen_location = pyautogui.locateOnScreen(
                        normalscreen_img, confidence=0.8
                    )
                    if normalscreen_location:
                        logger.info(
                            f"[{self.EMR_TYPE.upper()}] Already in fullscreen mode"
                        )
                        return True
                    else:
                        logger.warning(
                            f"[{self.EMR_TYPE.upper()}] Fullscreen button not found (attempt {attempt + 1}/{max_retries})"
                        )
                        if attempt < max_retries - 1:
                            stoppable_sleep(1)
                            continue

            except Exception as e:
                logger.warning(
                    f"[{self.EMR_TYPE.upper()}] Error clicking fullscreen (attempt {attempt + 1}): {e}"
                )
                if attempt < max_retries - 1:
                    stoppable_sleep(1)
                    continue

        logger.error(
            f"[{self.EMR_TYPE.upper()}] Failed to enter fullscreen after {max_retries} attempts"
        )
        return False

    def _click_normalscreen(self):
        """
        Click normalscreen button to restore view.
        Uses EMR_TYPE to find the correct image in config.
        """
        img_key = f"images.{self.EMR_TYPE.lower()}_normalscreen_btn"
        normalscreen_img = config.get_rpa_setting(img_key)
        if not normalscreen_img:
            logger.warning(
                f"[{self.EMR_TYPE.upper()}] Normalscreen image not configured"
            )
            return
        try:
            location = pyautogui.locateOnScreen(normalscreen_img, confidence=0.8)
            if location:
                pyautogui.click(pyautogui.center(location))
                logger.info(f"[{self.EMR_TYPE.upper()}] Clicked normalscreen button")

                # Move mouse to screen center to avoid hover interference
                screen_w, screen_h = pyautogui.size()
                pyautogui.moveTo(screen_w // 2, screen_h // 2)
                stoppable_sleep(1)
            else:
                logger.warning(
                    f"[{self.EMR_TYPE.upper()}] Normalscreen button not found"
                )
        except Exception as e:
            logger.warning(
                f"[{self.EMR_TYPE.upper()}] Error clicking normalscreen: {e}"
            )

    def _wait_for_patient_list_with_patience(
        self,
        patient_list_header_img: str,
        max_attempts: int = 3,
        attempt_timeout: int = 10,
        max_alt_f4_retries: int = 1,
    ) -> bool:
        """
        Wait patiently for Patient List Header to appear.
        Uses multiple short attempts with center clicks to wake up frozen systems.

        Hybrid approach:
        1. First try: Wait patiently (3 attempts × 10s with center clicks)
        2. If still not found: Send Alt+F4 rescue and wait again (3 more attempts)
        3. Max 1 Alt+F4 retry to prevent race conditions

        Args:
            patient_list_header_img: Path to the header image for detection
            max_attempts: Number of 10-second attempts per cycle (default: 3 = 30s)
            attempt_timeout: Timeout per attempt in seconds (default: 10)
            max_alt_f4_retries: Maximum Alt+F4 retries after patience exhausted (default: 1)

        Returns:
            True if Patient List Header was detected, False otherwise
        """
        screen_w, screen_h = pyautogui.size()

        for alt_f4_cycle in range(
            max_alt_f4_retries + 1
        ):  # 0 = initial, 1 = after retry
            cycle_name = (
                "initial" if alt_f4_cycle == 0 else f"after Alt+F4 retry {alt_f4_cycle}"
            )

            for attempt in range(max_attempts):
                attempt_num = attempt + 1
                logger.info(
                    f"[{self.EMR_TYPE.upper()}] Waiting for Patient List Header "
                    f"({cycle_name}, attempt {attempt_num}/{max_attempts}, {attempt_timeout}s)..."
                )

                # Click center to wake up system (Citrix/VDI can freeze)
                pyautogui.click(screen_w // 2, screen_h // 2)
                stoppable_sleep(0.5)

                # Try to detect header
                header_found = self.wait_for_element(
                    patient_list_header_img,
                    timeout=attempt_timeout,
                    description=f"Patient List Header ({cycle_name}, attempt {attempt_num}/{max_attempts})",
                )

                if header_found:
                    logger.info(
                        f"[{self.EMR_TYPE.upper()}] Patient List Header detected ({cycle_name}, attempt {attempt_num})"
                    )
                    return True
                else:
                    logger.warning(
                        f"[{self.EMR_TYPE.upper()}] Patient List Header NOT detected ({cycle_name}, attempt {attempt_num})"
                    )

            # All patience attempts exhausted for this cycle
            if alt_f4_cycle < max_alt_f4_retries:
                # Send rescue Alt+F4 and try again
                logger.warning(
                    f"[{self.EMR_TYPE.upper()}] Patience exhausted - sending rescue Alt+F4..."
                )
                pyautogui.click(screen_w // 2, screen_h // 2)
                stoppable_sleep(0.5)

                pydirectinput.keyDown("alt")
                stoppable_sleep(0.1)
                pydirectinput.press("f4")
                stoppable_sleep(0.1)
                pydirectinput.keyUp("alt")

                # Wait for system to process close
                # PowerChart can freeze during close - longer wait prevents Alt+F4 accumulation
                logger.info(
                    f"[{self.EMR_TYPE.upper()}] Waiting 15s for system to process close..."
                )
                stoppable_sleep(15)
            else:
                # All retries exhausted
                logger.error(
                    f"[{self.EMR_TYPE.upper()}] Patient List Header NOT detected after "
                    f"{max_alt_f4_retries + 1} cycles. Giving up."
                )

        return False

    def _get_rois(self, agent_name: str = "patient_finder"):
        """
        Load ROI regions for the given agent from config.
        Uses EMR_TYPE to find the correct regions.

        Args:
            agent_name: Agent type (patient_finder, report_finder, etc.)

        Returns:
            List of ROI objects ready for screen capture masking.
        """
        from agentic.models import ROI

        roi_dicts = config.get_rois_for_agent(self.EMR_TYPE.lower(), agent_name)
        rois = [ROI(**r) for r in roi_dicts]

        if rois:
            logger.info(
                f"[{self.EMR_TYPE.upper()}] Loaded {len(rois)} ROI(s) for {agent_name}"
            )
        else:
            logger.warning(f"[{self.EMR_TYPE.upper()}] No ROIs found for {agent_name}")

        return rois

    # =========================================================================
    # Screenshot OCR + LLM Patient Extraction
    # =========================================================================

    def _ocr_image_google_vision(self, image_base64: str) -> str:
        """Send a base64-encoded image to Google Cloud Vision for OCR.

        Args:
            image_base64: Base64-encoded image data (PNG/JPEG).

        Returns:
            Extracted text from the image.
        """
        import requests as req

        vision_api_key = os.environ.get(
            "GOOGLE_VISION_API_KEY",
            os.environ.get("GOOGLE_API_KEY", ""),
        )
        if not vision_api_key:
            raise Exception(
                "Google Vision API key not found. "
                "Set GOOGLE_VISION_API_KEY or GOOGLE_API_KEY in .env"
            )

        vision_url = (
            f"https://vision.googleapis.com/v1/images:annotate" f"?key={vision_api_key}"
        )

        body = {
            "requests": [
                {
                    "image": {"content": image_base64},
                    "features": [{"type": "DOCUMENT_TEXT_DETECTION"}],
                    "imageContext": {
                        "languageHints": ["en", "es"],
                    },
                }
            ]
        }

        try:
            response = req.post(vision_url, json=body, timeout=60)
            response.raise_for_status()
            result = response.json()
        except Exception as e:
            logger.error(f"[OCR] Google Vision API call failed: {e}")
            raise Exception(f"Google Vision OCR failed: {e}")

        try:
            annotation = result["responses"][0].get("fullTextAnnotation", {})
            text = annotation.get("text", "")
            return text
        except (KeyError, IndexError) as e:
            logger.error(f"[OCR] Failed to parse Vision response: {e}")
            return ""

    def _extract_patients_from_screenshots(self, screenshots: list) -> list:
        """OCR all screenshot images via Google Vision and use Gemini LLM to
        extract structured patients.

        Replicates the n8n flow:
        1. For each screenshot, use the already-captured (masked/enhanced) base64 image
        2. Send each to Google Vision images:annotate for OCR
        3. Aggregate all OCR texts with hospital context headers
        4. Send combined text to Gemini LLM for structured patient extraction

        Args:
            screenshots: List of screenshot_data dicts from
                         capture_screenshot_with_processing(), each containing:
                         - image_b64: Base64-encoded processed image
                         - hospital_name: Full hospital name for context
                         - display_name: Short display name

        Returns:
            List of patient dicts: [{name, location, reason, admittedDate}]
        """
        logger.info(
            f"[OCR+LLM] Extracting patients from {len(screenshots)} screenshot(s)"
        )

        if not screenshots:
            logger.warning("[OCR+LLM] No screenshots provided")
            return []

        # ── Step 1: OCR each screenshot individually ──
        ocr_segments = []
        for idx, shot in enumerate(screenshots, 1):
            hospital_ctx = shot.get("hospital_name", f"Hospital_{idx}")
            image_b64 = shot.get("image_b64")

            if not image_b64:
                logger.warning(
                    f"[OCR+LLM] Screenshot {idx} ({hospital_ctx}) has no image_b64, skipping"
                )
                continue

            logger.info(f"[OCR+LLM] OCR screenshot {idx}/{len(screenshots)}: {hospital_ctx}")
            extracted_text = self._ocr_image_google_vision(image_b64)

            if not extracted_text.strip():
                logger.warning(f"[OCR+LLM] OCR returned empty text for {hospital_ctx}")
                continue

            # Format exactly like n8n: add source/hospital context header
            segment = (
                f"--- SOURCE: {self.FLOW_TYPE} | HOSPITAL: {hospital_ctx} ---\n"
                f"{extracted_text}"
            )
            ocr_segments.append(segment)
            logger.info(
                f"[OCR+LLM] OCR {hospital_ctx}: {len(extracted_text)} chars extracted"
            )

        if not ocr_segments:
            logger.warning("[OCR+LLM] No OCR text extracted from any screenshot")
            return []

        # ── Step 2: Combine all OCR texts (like n8n's Aggregate + Format node) ──
        combined_ocr_text = "\n\n".join(ocr_segments)
        logger.info(
            f"[OCR+LLM] Combined OCR text: {len(combined_ocr_text)} chars "
            f"from {len(ocr_segments)} screenshot(s)"
        )

        # ── Step 3: Use Gemini LLM to structure the patient data ──
        from agentic.core.llm import create_gemini_model
        from langchain_core.messages import SystemMessage, HumanMessage
        import json

        llm = create_gemini_model(temperature=0.0)
        if not llm:
            raise Exception("Failed to initialize Gemini LLM")

        system_prompt = f"""You are a medical data extraction expert. Extract the patient list from this OCR text.
The text may contain data from one or multiple hospitals. Each section is marked with a header:
--- SOURCE: ... | HOSPITAL: ... ---

For each patient found, extract:
- name: Patient full name in "LASTNAME, FIRSTNAME" format
- location: Room/Bed code (if available)
- reason: Brief reason for visit or diagnosis (if available)
- admittedDate: Admission date in MM/DD format (if available)

Rules:
1. Ignore the requesting doctor's name ({self.doctor_name}) — it is NOT a patient.
2. Ignore headers, menu items, toolbar text, and any non-patient data.
3. If a field is not available, use null (not "Unknown" or "N/A").
4. Return ONLY a valid JSON array, no markdown fences, no extra text.
5. Format: [{{"name":"LASTNAME, FIRSTNAME","location":"code","reason":"text","admittedDate":"MM/DD"}}]
6. If no patients are found, return: []"""

        user_prompt = f"OCR TEXT TO PROCESS:\n\n{combined_ocr_text}"

        try:
            messages = [
                SystemMessage(content=system_prompt),
                HumanMessage(content=user_prompt),
            ]
            response = llm.invoke(messages)

            # Clean possible markdown in response
            raw_content = response.content
            if isinstance(raw_content, list):
                text_parts = []
                for block in raw_content:
                    if isinstance(block, dict) and "text" in block:
                        text_parts.append(block["text"])
                    elif isinstance(block, str):
                        text_parts.append(block)
                clean_text = "".join(text_parts).strip()
            else:
                clean_text = str(raw_content).strip()

            if clean_text.startswith("```json"):
                clean_text = clean_text[7:]
            if clean_text.startswith("```"):
                clean_text = clean_text[3:]
            if clean_text.endswith("```"):
                clean_text = clean_text[:-3]

            clean_text = clean_text.strip()
            patients = json.loads(clean_text)

            if not isinstance(patients, list):
                raise ValueError("LLM response is not a valid JSON array")

            logger.info(
                f"[OCR+LLM] Extracted {len(patients)} patients from {len(screenshots)} screenshot(s)"
            )
            return patients

        except Exception as e:
            logger.error(f"[OCR+LLM] LLM extraction failed: {e}")
            raise Exception(f"Failed to structure patient list with LLM: {e}")

    # =========================================================================
    # Backend Ingestion Methods (replaces n8n webhooks)
    # =========================================================================

    def _send_to_backend_ingest(self, data_type: str, payload: dict):
        """
        Send extracted data to the backend ingestion endpoint.
        Replaces all previous n8n webhook methods.

        Args:
            data_type: One of 'patient_list', 'patient_summary', 'patient_insurance'
            payload: The data payload to ingest
        """
        body = {
            "uuid": _load_uuid(),
            "dataType": data_type,
            "hospitalType": self.EMR_TYPE.upper(),
            "payload": payload,
        }
        try:
            response = requests.post(
                f"{self.BACKEND_URL}/rpa/ingest", json=body, timeout=30
            )
            logger.info(
                f"[BACKEND] Ingest {data_type} sent - Status: {response.status_code}"
            )
            return response
        except Exception as e:
            logger.error(f"[BACKEND] Failed to send ingest {data_type}: {e}")
            return None

    def _send_to_list_webhook_n8n(self, data):
        """Send patient list data to the backend (backward-compatible name)."""
        return self._send_to_backend_ingest("patient_list", data)

    def _send_to_summary_webhook_n8n(self, data):
        """Send patient summary data to the backend (backward-compatible name)."""
        return self._send_to_backend_ingest("patient_summary", data)

    def _send_to_insurance_webhook_n8n(self, data):
        """Send patient insurance data to the backend (backward-compatible name)."""
        return self._send_to_backend_ingest("patient_insurance", data)

    def _send_to_batch_insurance_webhook_n8n(self, data):
        """Send batch insurance data to the backend (backward-compatible name)."""
        return self._send_to_backend_ingest("patient_insurance", data)
