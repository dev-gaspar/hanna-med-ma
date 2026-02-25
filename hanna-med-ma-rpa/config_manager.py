"""
Configuration Manager - Handles persistent storage of credentials and settings
"""

import json
import os
from pathlib import Path
from typing import Optional, Dict, Any
from config import config


class ConfigManager:
    """Manages configuration persistence for the RPA agent"""

    def __init__(self):
        self.config_dir = config.get_app_dir()
        self.config_file = self.config_dir / "rpa_config.json"

        # Create directories if they don't exist
        self.config_dir.mkdir(parents=True, exist_ok=True)

    def load_config(self) -> Optional[Dict[str, Any]]:
        """Load configuration from disk"""
        if not self.config_file.exists():
            return None

        try:
            with open(self.config_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading config: {e}")
            return None

    def save_config(self, config_data: Dict[str, Any]) -> bool:
        """Save configuration to disk"""
        try:
            with open(self.config_file, "w", encoding="utf-8") as f:
                json.dump(config_data, f, indent=2)
            return True
        except Exception as e:
            print(f"Error saving config: {e}")
            return False

    def clear_config(self) -> bool:
        """Clear all configuration"""
        try:
            if self.config_file.exists():
                self.config_file.unlink()
            return True
        except Exception as e:
            print(f"Error clearing config: {e}")
            return False
