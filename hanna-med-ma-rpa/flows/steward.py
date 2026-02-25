"""
Steward Health Flow - Patient list recovery for Steward Health System.
"""

import os
from datetime import datetime

import pyautogui
import pydirectinput
import pyperclip

from config import config
from core.rpa_engine import rpa_state
from core.vdi_input import type_with_clipboard, press_key_vdi, stoppable_sleep
from logger import logger

from .base_flow import BaseFlow


class StewardFlow(BaseFlow):
    """RPA flow for Steward Health list recovery."""

    FLOW_NAME = "Steward Health"
    FLOW_TYPE = "steward_list_recovery"
    EMR_TYPE = "steward"

    def __init__(self):
        super().__init__()

    @property
    def email(self):
        """Get email from Steward credentials."""
        creds = self.get_credentials_for_system("STEWARD")
        if "email" not in creds:
            raise Exception("Steward credentials missing 'email' field")
        return creds["email"]

    @property
    def password(self):
        """Get password from Steward credentials."""
        creds = self.get_credentials_for_system("STEWARD")
        if "password" not in creds:
            raise Exception("Steward credentials missing 'password' field")
        return creds["password"]

    def execute(self):
        """Execute all Steward Health flow steps."""
        self._log_start()

        self.step_1_tab()
        self.step_2_favorite()
        self.step_3_meditech()
        self.step_4_login()
        self.step_5_open_session()
        self.step_6_navigate_menu_5()
        self.step_7_navigate_menu_6()
        self.step_8_click_list()
        self.step_9_print_pdf()
        text_content = self.step_10_extract_text_from_pdf()
        structured_patients = self.step_10b_structure_patients_with_llm(text_content)
        self.step_11_close_pdf_tab()
        self.step_12_close_tab()
        self.step_13_close_modal()
        self.step_14_cancel_modal()
        self.step_15_close_meditech()
        self.step_16_tab_logged_out()
        self.step_17_close_tab_final()
        self.step_18_url()
        self.step_19_vdi_tab()

        return structured_patients

    def _log_start(self):
        """Log flow start."""
        logger.info("=" * 80)
        logger.info("STEWARD LIST RECOVERY RPA FLOW - STARTED")
        logger.info("=" * 80)
        logger.info(f"Doctor ID: {self.doctor_id}")
        logger.info(f"Doctor Name: {self.doctor_name}")
        logger.info(f"Start Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        logger.info(f"Screen Resolution: {pyautogui.size()}")
        logger.info("=" * 80)

    def notify_completion(self, structured_patients):
        """Notify backend of successful completion with structured patients array."""
        payload = {
            "status": "completed",
            "type": self.FLOW_TYPE,
            "patients": structured_patients,
            "timestamp": datetime.now().strftime("%Y%m%d_%H%M%S"),
            "doctor_name": self.doctor_name,
        }
        response = self._send_to_list_webhook_n8n(payload)
        logger.info(f"[BACKEND] Notification sent - Status: {response.status_code}")
        logger.info(
            f"[SUCCESS] Sent {len(structured_patients)} structured patients to backend"
        )
        return response

    # --- Flow Steps ---

    def step_1_tab(self):
        """Click Steward Tab."""
        self.set_step("STEP_1_TAB_STEWARD")
        logger.info("[STEP 1] Clicking Steward Tab")

        steward_tab = self.wait_for_element(
            config.get_rpa_setting("images.steward_tab"),
            timeout=config.get_timeout("steward.tab"),
            description="Steward Tab",
        )
        if not steward_tab:
            raise Exception("Steward Tab not found")

        if not self.safe_click(steward_tab, "Steward Tab"):
            raise Exception("Failed to click on Steward Tab")

        stoppable_sleep(3)
        logger.info("[STEP 1] Steward Tab clicked")
        return True

    def step_2_favorite(self):
        """Click Favorite Steward."""
        self.set_step("STEP_2_FAVORITE_STEWARD")
        logger.info("[STEP 2] Clicking Favorite Steward")

        favorite = self.wait_for_element(
            config.get_rpa_setting("images.steward_favorite"),
            timeout=config.get_timeout("steward.favorite"),
            description="Favorite Steward",
        )
        if not favorite:
            raise Exception("Favorite Steward not found")

        if not self.safe_click(favorite, "Favorite Steward"):
            raise Exception("Failed to click on Favorite Steward")

        stoppable_sleep(3)
        logger.info("[STEP 2] Favorite Steward clicked")
        return True

    def step_3_meditech(self):
        """Click Meditech."""
        self.set_step("STEP_3_MEDITECH")
        logger.info("[STEP 3] Clicking Meditech")

        meditech = self.wait_for_element(
            config.get_rpa_setting("images.steward_meditech"),
            timeout=config.get_timeout("steward.meditech"),
            description="Meditech",
        )
        if not meditech:
            raise Exception("Meditech not found")

        if not self.safe_click(meditech, "Meditech"):
            raise Exception("Failed to click on Meditech")

        stoppable_sleep(5)
        logger.info("[STEP 3] Meditech clicked")
        return True

    def step_4_login(self):
        """
        Login with 'Windows Key Trick' (Using Ctrl+Esc) to force synchronization.
        Optimized: Detects location before syncing to minimize delays.
        """
        self.set_step("STEP_4_LOGIN")
        logger.info("[STEP 4] Login - Windows Key Sync Strategy")

        # --- PHASE 1: LOGIN WINDOW (EMAIL) ---
        login_window = self.wait_for_element(
            config.get_rpa_setting("images.steward_login_window"),
            timeout=config.get_timeout("steward.login_window"),
            description="Login Window",
        )

        if not login_window:
            # Recovery attempt with F5
            press_key_vdi("f5")
            stoppable_sleep(5)
            login_window = self.wait_for_element(
                config.get_rpa_setting("images.steward_login_window"), timeout=30
            )
            if not login_window:
                raise Exception("Login window not found")

        # Initial click for focus
        center_login = pyautogui.center(login_window)
        pyautogui.click(center_login)
        stoppable_sleep(1)

        logger.info("[LOGIN] Typing Email...")
        type_with_clipboard(self.email)
        stoppable_sleep(1.0)
        press_key_vdi("enter")

        # --- PHASE 2: PASSWORD PREPARATION (CRITICAL SPACE) ---
        logger.info("[LOGIN] Waiting for password screen...")

        # Wait and locate field BEFORE starting synchronization
        password_window = self.wait_for_element(
            config.get_rpa_setting("images.steward_password_window"),
            timeout=config.get_timeout("steward.password_window"),
            description="Password Input Field",
        )
        if not password_window:
            raise Exception("Password Window not found")

        # Save coordinates to use just before pasting
        password_click_target = pyautogui.center(password_window)

        # --- PHASE 3: COPY PASSWORD (LOCAL) ---
        logger.info("[LOGIN] Copying Password to Local Clipboard...")

        pyperclip.copy("")
        stoppable_sleep(0.5)
        pyperclip.copy(self.password)

        # --- PHASE 4: START MENU TRICK (FORCE SYNC) ---
        logger.info("[LOGIN] Executing Start Menu Dance (Ctrl+Esc) to force sync...")

        # Ensure neutral focus before the dance
        pyautogui.click(password_click_target)
        stoppable_sleep(0.5)

        # 1. Open Start Menu (Ctrl + Esc)
        pydirectinput.keyDown("ctrl")
        stoppable_sleep(0.1)
        pydirectinput.press("esc")
        stoppable_sleep(0.1)
        pydirectinput.keyUp("ctrl")

        stoppable_sleep(3.0)  # Wait for menu visualization

        # 2. Close Start Menu
        pydirectinput.press("esc")

        # 3. THE KEY 5 SECOND WAIT (Data transfer through VDI channel)
        logger.info("[LOGIN] Waiting 5s for sync as requested...")
        stoppable_sleep(5.0)

        # --- PHASE 5: CLICK AND PASTE (FAST) ---
        logger.info("[LOGIN] Clicking Password Field (Refocus)...")
        pyautogui.click(password_click_target)

        # Small technical pause for click to register focus
        stoppable_sleep(0.2)

        logger.info("[LOGIN] Pasting Password...")
        pydirectinput.keyDown("ctrl")
        stoppable_sleep(0.1)
        pydirectinput.press("v")
        stoppable_sleep(0.1)
        pydirectinput.keyUp("ctrl")

        stoppable_sleep(2.0)

        # --- PHASE 6: SUBMIT ---
        logger.info("[LOGIN] Submitting...")
        press_key_vdi("enter")

        stoppable_sleep(8)
        logger.info("[STEP 4] Login sequence completed")
        return True

    def step_5_open_session(self):
        """Click to open Meditech session, handling already-open sessions."""
        self.set_step("STEP_5_OPEN_SESSION")
        logger.info("[STEP 5] Opening Meditech session")

        # Check if a session is already open (obstacle)
        if self._check_element_exists(
            config.get_rpa_setting("images.steward_status_session_open")
        ):
            logger.info("[STEP 5] Session already open - resetting...")
            self._reset_existing_session()

        # Now proceed with normal session opening
        session_meditech = self.wait_for_element(
            config.get_rpa_setting("images.steward_session_meditech"),
            timeout=config.get_timeout("steward.session"),
            description="Meditech Session",
        )
        if not session_meditech:
            raise Exception("Meditech Session button not found")

        if not self.safe_click(session_meditech, "Meditech Session"):
            raise Exception("Failed to click on Meditech Session")

        stoppable_sleep(5)
        logger.info("[STEP 5] Meditech session opened")
        return True

    def _check_element_exists(self, image_path, confidence=None):
        """Quickly check if an element exists on screen without waiting."""
        if confidence is None:
            confidence = self.confidence
        try:
            location = pyautogui.locateOnScreen(image_path, confidence=confidence)
            return location is not None
        except pyautogui.ImageNotFoundException:
            return False
        except Exception:
            return False

    def _reset_existing_session(self):
        """Reset an already-open Meditech session."""
        # Click Reset button
        reset_btn = self.wait_for_element(
            config.get_rpa_setting("images.steward_reset_session"),
            timeout=10,
            description="Reset Session Button",
        )
        if not reset_btn:
            raise Exception("Reset Session button not found")

        if not self.safe_click(reset_btn, "Reset Session"):
            raise Exception("Failed to click Reset Session")

        stoppable_sleep(2)

        # Click Terminate button in the modal
        terminate_btn = self.wait_for_element(
            config.get_rpa_setting("images.steward_terminate_session"),
            timeout=10,
            description="Terminate Session Button",
        )
        if not terminate_btn:
            raise Exception("Terminate Session button not found")

        if not self.safe_click(terminate_btn, "Terminate Session"):
            raise Exception("Failed to click Terminate Session")

        # Wait longer for UI to refresh after terminating session
        logger.info("[STEP 5] Waiting for UI to refresh after terminate...")
        stoppable_sleep(5)
        logger.info("[STEP 5] Existing session terminated")

    def _handle_sign_list_popup(self, location):
        """Handler to close the Sign List popup that appears when there are pending documents.

        Also handles the Warning modal that may appear after closing Sign List,
        clicking 'Leave Now' button if it appears.
        """
        logger.info("[SIGN LIST] Sign List popup detected - closing it...")

        # Close the popup using steward_close_meditech
        close_btn = self.wait_for_element(
            config.get_rpa_setting("images.steward_close_meditech"),
            timeout=10,
            description="Close Meditech (Sign List)",
        )
        if close_btn:
            self.safe_click(close_btn, "Close Sign List")
            stoppable_sleep(2)
            logger.info("[SIGN LIST] Sign List popup closed")

            # Check if Warning modal appeared after closing Sign List
            self._handle_warning_leave_now_modal()

    def _handle_warning_leave_now_modal(self):
        """Handle the Warning modal that may appear after closing Sign List.

        This modal has a 'Leave Now' button that needs to be clicked to dismiss it.
        """
        logger.info("[SIGN LIST] Checking for Warning modal...")

        leave_now_btn = self.wait_for_element(
            config.get_rpa_setting("images.steward_leave_now_btn"),
            timeout=5,
            description="Leave Now Button",
        )

        if leave_now_btn:
            logger.info("[SIGN LIST] Warning modal detected - clicking Leave Now...")
            self.safe_click(leave_now_btn, "Leave Now")
            stoppable_sleep(2)
            logger.info("[SIGN LIST] Warning modal dismissed successfully")
        else:
            logger.info("[SIGN LIST] No Warning modal detected - continuing")

    def _handle_sign_list_modal_no(self, location):
        """Handler for the 'Items to be signed' Yes/No modal.

        This modal appears once a day asking if you want to review and sign items.
        Click 'No' to skip and stay on the patient list.
        """
        logger.info(
            "[SIGN LIST] 'Items to be signed' modal detected - clicking 'No'..."
        )

        no_btn = self.wait_for_element(
            config.get_rpa_setting("images.steward_sign_list_no_btn"),
            timeout=5,
            description="Sign List 'No' Button",
        )

        if no_btn:
            self.safe_click(no_btn, "Sign List No")
            stoppable_sleep(2)
            logger.info(
                "[SIGN LIST] Clicked 'No' - modal dismissed, staying on patient list"
            )
        else:
            logger.warning("[SIGN LIST] 'No' button not found on modal")

    def _get_sign_list_handlers(self):
        """Get handlers for Sign List popup obstacle.

        Includes:
        - steward_sign_list_no_btn: The Yes/No modal → click 'No'
        - steward_sign_list: The Sign List page → close + leave now
        - steward_sign_list_obstacle: The Sign List page (alt) → close + leave now
        """
        return {
            config.get_rpa_setting("images.steward_sign_list_no_btn"): (
                "Sign List Modal (Yes/No)",
                self._handle_sign_list_modal_no,
            ),
            config.get_rpa_setting("images.steward_sign_list"): (
                "Sign List Popup",
                self._handle_sign_list_popup,
            ),
            config.get_rpa_setting("images.steward_sign_list_obstacle"): (
                "Sign List Obstacle",
                self._handle_sign_list_popup,
            ),
        }

    def _handle_steward_message(self, location):
        """Handler to dismiss the informative message popup.

        This popup sometimes appears before steward_load_menu_5.
        Click the OK button to dismiss it and continue.
        """
        logger.info("[MESSAGE] Informative message popup detected - dismissing...")

        # Click OK button to dismiss the message
        ok_btn = self.wait_for_element(
            config.get_rpa_setting("images.steward_message_ok"),
            timeout=10,
            description="Message OK Button",
        )
        if ok_btn:
            self.safe_click(ok_btn, "Message OK")
            stoppable_sleep(2)
            logger.info("[MESSAGE] Informative message dismissed")
        else:
            logger.warning("[MESSAGE] OK button not found - trying to continue")

    def _get_message_handlers(self):
        """Get handlers for informative message popup obstacle."""
        return {
            config.get_rpa_setting("images.steward_message"): (
                "Informative Message",
                self._handle_steward_message,
            ),
        }

    def step_6_navigate_menu_5(self):
        """Wait for menu to load and navigate (step 5), handling message popup."""
        self.set_step("STEP_6_MENU_5")
        logger.info("[STEP 6] Navigating menu (step 5)")

        # Use robust_wait to handle informative message popup if it appears
        menu = self.robust_wait_for_element(
            config.get_rpa_setting("images.steward_load_menu_5"),
            target_description="Menu (step 5)",
            handlers=self._get_message_handlers(),
            timeout=config.get_timeout("steward.menu"),
        )
        if not menu:
            raise Exception("Menu (step 5) not found")

        stoppable_sleep(2)

        # Right arrow, Down arrow, Enter
        press_key_vdi("right")
        press_key_vdi("down")
        press_key_vdi("enter")
        stoppable_sleep(3)

        logger.info("[STEP 6] Menu navigation (step 5) completed")
        return True

    def step_7_navigate_menu_6(self):
        """Wait for menu to load and navigate (step 6), handling Sign List popup."""
        self.set_step("STEP_7_MENU_6")
        logger.info("[STEP 7] Navigating menu (step 6)")

        # Use robust_wait_for_element to handle Sign List popup if it appears
        menu = self.robust_wait_for_element(
            config.get_rpa_setting("images.steward_load_menu_6"),
            target_description="Menu (step 6)",
            handlers=self._get_sign_list_handlers(),
            timeout=config.get_timeout("steward.menu"),
        )
        if not menu:
            raise Exception("Menu (step 6) not found")

        stoppable_sleep(2)

        # Click directly on menu to open it instead of Tab+Enter
        if not self.safe_click(menu, "Menu dropdown"):
            raise Exception("Failed to click on Menu")
        stoppable_sleep(1)

        # 5 times arrow down
        for _ in range(5):
            press_key_vdi("down")

        press_key_vdi("enter")
        stoppable_sleep(0.5)

        # Tab, Enter
        press_key_vdi("tab")
        press_key_vdi("enter")
        stoppable_sleep(0.5)

        # 3 tabs
        for _ in range(3):
            press_key_vdi("tab")

        press_key_vdi("enter")
        stoppable_sleep(0.5)

        # 2 tabs
        for _ in range(2):
            press_key_vdi("tab")

        press_key_vdi("enter")
        stoppable_sleep(3)

        logger.info("[STEP 7] Menu navigation (step 6) completed")
        return True

    def step_8_click_list(self):
        """Click on the list."""
        self.set_step("STEP_8_LIST")
        logger.info("[STEP 8] Clicking on list")

        patient_list = self.wait_for_element(
            config.get_rpa_setting("images.steward_list"),
            timeout=config.get_timeout("steward.list"),
            description="Patient List",
        )
        if not patient_list:
            raise Exception("Patient List not found")

        if not self.safe_click(patient_list, "Patient List"):
            raise Exception("Failed to click on Patient List")

        stoppable_sleep(2)
        logger.info("[STEP 8] Patient List clicked")
        return True

    def step_9_print_pdf(self):
        """Print to PDF - Robust VDI Version with printer verification."""
        self.set_step("STEP_9_PRINT_PDF")
        logger.info("[STEP 9] Printing to PDF (Robust Ctrl+P)")

        # 1. Ensure focus on document
        screen_width, screen_height = pyautogui.size()
        pyautogui.click(screen_width // 2, screen_height // 2)
        stoppable_sleep(1.5)

        # 2. Send Ctrl + P "Manually" (Hardware Simulation)
        logger.info("[PRINT] Sending Ctrl + P via DirectInput...")

        pydirectinput.keyDown("ctrl")
        stoppable_sleep(0.5)

        pydirectinput.press("p")
        stoppable_sleep(0.5)

        pydirectinput.keyUp("ctrl")

        # 3. Wait for print dialog to load
        logger.info("[PRINT] Waiting for Print Dialog...")
        stoppable_sleep(8.0)

        # 4. Verify Horizon Printer is selected
        if not self._verify_horizon_printer():
            logger.info("[PRINT] Horizon Printer not selected - selecting it...")
            self._select_horizon_printer()
        else:
            logger.info("[PRINT] Horizon Printer already selected")

        # 5. Click Print button to start printing (avoid focus issues with Enter)
        logger.info("[PRINT] Clicking Print button...")
        print_btn = self.wait_for_element(
            config.get_rpa_setting("images.steward_print_btn"),
            timeout=10,
            description="Print Button",
        )
        if not print_btn:
            raise Exception("Print button not found")

        if not self.safe_click(print_btn, "Print Button"):
            raise Exception("Failed to click Print button")
        stoppable_sleep(4.0)

        for i in range(2):
            logger.info(f"[PRINT] Dialog navigation enter {i+1}...")
            press_key_vdi("enter")
            stoppable_sleep(3.0)

        logger.info("[PRINT] Selecting action (Left)...")
        press_key_vdi("left")
        stoppable_sleep(1.5)

        logger.info("[PRINT] Final Save command...")
        press_key_vdi("enter")

        logger.info("[PRINT] Waiting for file save...")
        stoppable_sleep(10.0)

        logger.info("[STEP 9] PDF Print sequence finished")
        return True

    def _verify_horizon_printer(self):
        """Check if Horizon Printer is currently selected."""
        return self._check_element_exists(
            config.get_rpa_setting("images.steward_horizon_printer_ok")
        )

    def _select_horizon_printer(self):
        """Select Horizon Printer from the dropdown."""
        # Click on Save PDF dropdown to open options
        save_pdf_dropdown = self.wait_for_element(
            config.get_rpa_setting("images.steward_save_pdf_dropdown"),
            timeout=10,
            description="Save PDF Dropdown",
        )
        if not save_pdf_dropdown:
            raise Exception("Save PDF dropdown not found")

        if not self.safe_click(save_pdf_dropdown, "Save PDF Dropdown"):
            raise Exception("Failed to click Save PDF dropdown")

        stoppable_sleep(2)

        # Select Horizon Printer option
        horizon_option = self.wait_for_element(
            config.get_rpa_setting("images.steward_horizon_printer_option"),
            timeout=10,
            description="Horizon Printer Option",
        )
        if not horizon_option:
            raise Exception("Horizon Printer option not found")

        if not self.safe_click(horizon_option, "Horizon Printer"):
            raise Exception("Failed to select Horizon Printer")

        stoppable_sleep(2)
        logger.info("[PRINT] Horizon Printer selected")

    def step_10_extract_text_from_pdf(self):
        """Extract text from the printed PDF using Google Cloud Vision OCR."""
        self.set_step("STEP_10_EXTRACT_TEXT")
        logger.info("[STEP 10] Extracting text from PDF via Google Vision OCR")

        # Get the desktop path
        desktop_path = os.path.join(os.path.expanduser("~"), "Desktop")
        pdf_filename = "GOLDEN SUN Portal.pdf"
        pdf_path = os.path.join(desktop_path, pdf_filename)

        # Check if file exists
        if not os.path.exists(pdf_path):
            raise Exception(f"PDF file not found at: {pdf_path}")

        # Read PDF and encode as base64
        import base64
        import requests as req

        with open(pdf_path, "rb") as f:
            pdf_base64 = base64.b64encode(f.read()).decode("utf-8")

        logger.info(
            f"[STEP 10] PDF loaded ({len(pdf_base64)} base64 chars), "
            f"sending to Google Vision..."
        )

        # Call Google Cloud Vision files:annotate API (same as n8n)
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
            f"https://vision.googleapis.com/v1/files:annotate" f"?key={vision_api_key}"
        )

        body = {
            "requests": [
                {
                    "inputConfig": {
                        "content": pdf_base64,
                        "mimeType": "application/pdf",
                    },
                    "features": [{"type": "DOCUMENT_TEXT_DETECTION"}],
                    "pages": [1, 2, 3, 4, 5],
                }
            ]
        }

        try:
            response = req.post(vision_url, json=body, timeout=60)
            response.raise_for_status()
            result = response.json()
        except Exception as e:
            logger.error(f"[STEP 10] Google Vision API call failed: {e}")
            raise Exception(f"Google Vision OCR failed: {e}")

        # Extract text from response
        # Response structure: responses[0].responses[].fullTextAnnotation.text
        try:
            pages_responses = result["responses"][0]["responses"]
            text_parts = []
            for i, page_resp in enumerate(pages_responses):
                annotation = page_resp.get("fullTextAnnotation", {})
                page_text = annotation.get("text", "")
                if page_text.strip():
                    text_parts.append(page_text)
                    logger.debug(
                        f"[STEP 10] Page {i + 1}: OCR extracted "
                        f"{len(page_text)} chars"
                    )

            text_content = "\n".join(text_parts)
            logger.info(
                f"[STEP 10] OCR complete: {len(text_content)} chars from "
                f"{len(pages_responses)} page(s)"
            )
        except (KeyError, IndexError) as e:
            logger.error(f"[STEP 10] Failed to parse Vision response: {e}")
            raise Exception(f"Failed to parse Google Vision response: {e}")

        if not text_content.strip():
            raise Exception("Google Vision OCR returned empty text")

        return text_content

    def step_10b_structure_patients_with_llm(self, ocr_text: str):
        """Use Gemini LLM to structure the raw OCR text into a JSON array."""
        self.set_step("STEP_10B_STRUCTURE_LLM")
        logger.info("[STEP 10B] Structuring OCR text using Gemini LLM")

        from agentic.core.llm import create_gemini_model
        from langchain_core.messages import SystemMessage, HumanMessage
        import json
        import re

        llm = create_gemini_model(temperature=0.0)
        if not llm:
            raise Exception("Failed to initialize Gemini LLM")

        system_prompt = f"""Eres un asistente médico experto. Extrae los pacientes de este texto OCR de la lista de Steward Health.
Las tarjetas de pacientes de Steward suelen contener: Patient Name, Rm/Bed (Location), Reason, y Admitted (Date).
Ignora completamente el nombre del doctor que solicita la lista ({self.doctor_name}) si aparece, nunca lo incluyas como paciente.
Devuelve ÚNICAMENTE un array JSON válido con esta estructura exacta para cada paciente, sin Markdown extra (ni ```json):
[
  {{ "name": "APELLIDO, NOMBRE", "location": "código de cama", "reason": "motivo resumido", "admittedDate": "MM/DD" }}
]"""

        user_prompt = f"TEXTO OCR EXTRAIDO:\n\n{ocr_text}"

        try:
            messages = [
                SystemMessage(content=system_prompt),
                HumanMessage(content=user_prompt),
            ]
            response = llm.invoke(messages)

            # Limpiar posible markdown en la respuesta
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

            # Parsear el JSON
            patients = json.loads(clean_text)

            if not isinstance(patients, list):
                raise ValueError("LLM response is not a valid JSON array")

            logger.info(
                f"[STEP 10B] LLM extraction successful: {len(patients)} patients found"
            )
            return patients

        except Exception as e:
            logger.error(f"[STEP 10B] LLM extraction failed: {e}")
            logger.debug(f"LLM Response was: {locals().get('response', 'None')}")
            # Retornar lista vacía para no romper el flujo, o relanzar la excepción
            raise Exception(f"Failed to structure patient list with LLM: {e}")

    def step_11_close_pdf_tab(self):
        """Close PDF tab."""
        self.set_step("STEP_11_CLOSE_PDF_TAB")
        logger.info("[STEP 11] Closing PDF tab")

        pdf_tab = self.wait_for_element(
            config.get_rpa_setting("images.steward_tab_pdf"),
            timeout=config.get_timeout("steward.pdf_tab"),
            description="PDF Tab",
        )
        if not pdf_tab:
            raise Exception("PDF Tab not found")

        # Right click on the tab
        center = pyautogui.center(pdf_tab)
        pyautogui.rightClick(center)
        stoppable_sleep(1)

        logger.info("[STEP 11] PDF tab right-clicked")
        return True

    def step_12_close_tab(self):
        """Close tab."""
        self.set_step("STEP_12_CLOSE_TAB")
        logger.info("[STEP 12] Closing tab")

        close_tab = self.wait_for_element(
            config.get_rpa_setting("images.steward_close_tab"),
            timeout=config.get_timeout("steward.close_tab"),
            description="Close Tab",
        )
        if not close_tab:
            raise Exception("Close Tab not found")

        if not self.safe_click(close_tab, "Close Tab"):
            raise Exception("Failed to click on Close Tab")

        stoppable_sleep(2)
        logger.info("[STEP 12] Tab closed")
        return True

    def step_13_close_modal(self):
        """Close modal."""
        self.set_step("STEP_13_CLOSE_MODAL")
        logger.info("[STEP 13] Closing modal")

        close_modal = self.wait_for_element(
            config.get_rpa_setting("images.steward_close_modal"),
            timeout=config.get_timeout("steward.close_modal"),
            description="Close Modal",
        )
        if not close_modal:
            raise Exception("Close Modal not found")

        if not self.safe_click(close_modal, "Close Modal"):
            raise Exception("Failed to click on Close Modal")

        stoppable_sleep(2)
        logger.info("[STEP 13] Modal closed")
        return True

    def step_14_cancel_modal(self):
        """Cancel modal."""
        self.set_step("STEP_14_CANCEL_MODAL")
        logger.info("[STEP 14] Canceling modal")

        cancel_modal = self.wait_for_element(
            config.get_rpa_setting("images.steward_cancel_modal"),
            timeout=config.get_timeout("steward.cancel_modal"),
            description="Cancel Modal",
        )
        if not cancel_modal:
            raise Exception("Cancel Modal not found")

        if not self.safe_click(cancel_modal, "Cancel Modal"):
            raise Exception("Failed to click on Cancel Modal")

        stoppable_sleep(2)
        logger.info("[STEP 14] Modal canceled")
        return True

    def step_15_close_meditech(self):
        """Close Meditech - with verification loop for multiple windows."""
        self.set_step("STEP_15_CLOSE_MEDITECH")
        logger.info("[STEP 15] Closing Meditech")

        # --- Original behavior: find and click twice ---
        close_meditech = self.wait_for_element(
            config.get_rpa_setting("images.steward_close_meditech"),
            timeout=config.get_timeout("steward.close_meditech"),
            description="Close Meditech",
        )
        if not close_meditech:
            raise Exception("Close Meditech not found")

        if not self.safe_click(close_meditech, "Close Meditech"):
            raise Exception("Failed to click on Close Meditech")

        stoppable_sleep(2)

        # Click in the same location again (as per the process)
        if not self.safe_click(close_meditech, "Close Meditech (second click)"):
            raise Exception("Failed to click on Close Meditech (second click)")

        stoppable_sleep(2)

        # --- New: Verification loop - keep clicking while button is still visible ---
        max_extra_clicks = 3
        extra_clicks = 0

        while extra_clicks < max_extra_clicks:
            # Check if close button is still visible (short timeout)
            still_visible = self.wait_for_element(
                config.get_rpa_setting("images.steward_close_meditech"),
                timeout=3,
                description="Close Meditech (verification)",
            )

            if not still_visible:
                # Button no longer visible, we're done
                break

            # Button still visible, click again
            extra_clicks += 1
            logger.info(
                f"[STEP 15] Close button still visible, clicking again ({extra_clicks}/{max_extra_clicks})"
            )
            self.safe_click(
                still_visible, f"Close Meditech (extra click {extra_clicks})"
            )
            stoppable_sleep(1.5)

        logger.info("[STEP 15] Meditech closed")
        return True

    def step_16_tab_logged_out(self):
        """Right click on logged out tab (with fallback to unexpected error tab)."""
        self.set_step("STEP_16_TAB_LOGGED_OUT")
        logger.info("[STEP 16] Right clicking on logged out tab")

        # Try primary: logged out tab
        tab_location = self.wait_for_element(
            config.get_rpa_setting("images.steward_tab_logged_out"),
            timeout=config.get_timeout("steward.logged_out_tab"),
            description="Logged Out Tab",
        )

        # Fallback: unexpected error tab
        if not tab_location:
            logger.warning(
                "[STEP 16] Logged out tab not found, trying unexpected error tab..."
            )
            tab_location = self.wait_for_element(
                config.get_rpa_setting("images.steward_tab_unexpected_error"),
                timeout=10,
                description="Unexpected Error Tab",
            )

        if not tab_location:
            raise Exception("Neither Logged Out Tab nor Unexpected Error Tab found")

        # Right click on the tab
        center = pyautogui.center(tab_location)
        pyautogui.rightClick(center)
        stoppable_sleep(1)

        logger.info("[STEP 16] Tab right-clicked")
        return True

    def step_17_close_tab_final(self):
        """Close tab (final)."""
        self.set_step("STEP_17_CLOSE_TAB_FINAL")
        logger.info("[STEP 17] Closing tab (final)")

        close_tab = self.wait_for_element(
            config.get_rpa_setting("images.steward_close_tab"),
            timeout=config.get_timeout("steward.close_tab"),
            description="Close Tab",
        )
        if not close_tab:
            raise Exception("Close Tab not found")

        if not self.safe_click(close_tab, "Close Tab (final)"):
            raise Exception("Failed to click on Close Tab (final)")

        stoppable_sleep(2)
        logger.info("[STEP 17] Tab closed (final)")
        return True

    def step_18_url(self):
        """Right click on URL and reset."""
        self.set_step("STEP_18_URL")
        logger.info("[STEP 18] Right clicking on URL")

        url_field = self.wait_for_element(
            config.get_rpa_setting("images.steward_url"),
            timeout=config.get_timeout("steward.url"),
            description="URL Field",
        )
        if not url_field:
            raise Exception("URL Field not found")

        # Click on the URL field
        center = pyautogui.center(url_field)
        pyautogui.click(center)
        stoppable_sleep(0.5)

        # Select all existing text and delete it
        pyautogui.hotkey("ctrl", "a")
        stoppable_sleep(0.2)

        # Type the URL using clipboard for VDI compatibility
        url = "https://horizon.steward.org/portal/webclient/#/home"
        logger.info(f"[STEP 18] Typing URL using clipboard: {url}")
        type_with_clipboard(url)
        stoppable_sleep(0.5)

        # Press Enter
        press_key_vdi("enter")
        stoppable_sleep(3)

        logger.info("[STEP 18] URL reset")
        return True

    def step_19_vdi_tab(self):
        """Click VDI Desktop Tab with fallback."""
        self.set_step("STEP_19_VDI_TAB")
        logger.info("[STEP 19] Clicking VDI Desktop Tab")

        # Try primary image
        vdi_tab = self.wait_for_element(
            config.get_rpa_setting("images.common_vdi_desktop_tab"),
            timeout=config.get_timeout("steward.vdi_tab"),
            description="VDI Desktop Tab",
        )

        used_fallback = False
        # Fallback to alternative image
        if not vdi_tab:
            logger.warning("[STEP 19] Primary VDI tab not found, trying fallback...")
            vdi_tab = self.wait_for_element(
                config.get_rpa_setting("images.common_vdi_desktop_tab_fallback"),
                timeout=config.get_timeout("steward.vdi_tab"),
                description="VDI Desktop Tab (Apps fallback)",
            )
            used_fallback = True

        if not vdi_tab:
            raise Exception("VDI Desktop Tab not found (tried primary and fallback)")

        if not self.safe_click(vdi_tab, "VDI Desktop Tab"):
            raise Exception("Failed to click on VDI Desktop Tab")

        stoppable_sleep(2)

        # If fallback was used, navigate to lobby URL since we're in wrong view
        if used_fallback:
            logger.info("[STEP 19] Fallback used - navigating to lobby URL...")
            self._navigate_to_lobby()
            stoppable_sleep(3)

        logger.info("[STEP 19] VDI Desktop Tab clicked")
        return True
