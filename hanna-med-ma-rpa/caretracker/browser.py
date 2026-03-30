from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import re

from playwright.sync_api import Browser, BrowserContext, Frame, Page, sync_playwright
from logger import logger


class CareTrackerBrowser:
    def __init__(self, headless: bool, artifacts_dir: Path):
        self.headless = headless
        self.artifacts_dir = artifacts_dir
        self.playwright = None
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None

    def open(self) -> Page:
        self.playwright = sync_playwright().start()
        launch_args = [
            "--disable-gpu",
            "--disable-software-rasterizer",
            "--disable-dev-shm-usage",
            "--disable-features=RendererCodeIntegrity",
        ]
        try:
            # Prefer installed Chrome on Windows for better headed stability.
            self.browser = self.playwright.chromium.launch(
                channel="chrome",
                headless=self.headless,
                args=launch_args,
            )
        except Exception:
            self.browser = self.playwright.chromium.launch(
                headless=self.headless,
                args=launch_args,
            )
        self.context = self.browser.new_context(ignore_https_errors=True)
        self.context.set_default_timeout(30000)
        self.context.set_default_navigation_timeout(60000)
        self.page = self.context.new_page()
        self.page.on(
            "crash", lambda: logger.error("[CARETRACKER] Browser page crash event")
        )
        self.page.on(
            "pageerror", lambda err: logger.warning(f"[CARETRACKER] Page error: {err}")
        )
        return self.page

    def close(self) -> None:
        try:
            if self.context:
                self.context.close()
        finally:
            if self.browser:
                self.browser.close()
            if self.playwright:
                self.playwright.stop()

    def artifact_path(self, prefix: str) -> Path:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        return self.artifacts_dir / f"{prefix}_{ts}.png"

    @staticmethod
    def normalize_key(value: str) -> str:
        return re.sub(r"\s+", "", value or "").lower()

    @staticmethod
    def latest_named_frame(host: Page, name: str) -> Optional[Frame]:
        frames = [f for f in host.frames if f.name == name]
        return frames[-1] if frames else None

    @staticmethod
    def first_frame_with_selector(host: Page, selector: str) -> Optional[Frame]:
        for frame in host.frames:
            try:
                if frame.locator(selector).count() > 0:
                    return frame
            except Exception:
                continue
        return None

    @staticmethod
    def wait_for_any_selector(
        host: Page,
        selectors: List[str],
        timeout_ms: int = 5000,
        require_enabled: bool = False,
    ) -> bool:
        if not selectors:
            return True

        elapsed = 0
        tick_ms = 100
        while elapsed < timeout_ms:
            for frame in host.frames:
                for sel in selectors:
                    try:
                        loc = frame.locator(sel)
                        if loc.count() == 0:
                            continue
                        if require_enabled and not loc.first.is_enabled():
                            continue
                        return True
                    except Exception:
                        continue
            host.wait_for_timeout(tick_ms)
            elapsed += tick_ms
        return False

    @staticmethod
    def fill_first(host: Page, selectors: List[str], value: str) -> bool:
        for frame in host.frames:
            for sel in selectors:
                try:
                    loc = frame.locator(sel)
                    if loc.count() > 0:
                        loc.first.fill(value)
                        return True
                except Exception:
                    continue
        return False

    @staticmethod
    def select_first(
        host: Page,
        selectors: List[str],
        value: Optional[str] = None,
        label: Optional[str] = None,
    ) -> bool:
        for frame in host.frames:
            for sel in selectors:
                try:
                    loc = frame.locator(sel)
                    if loc.count() == 0:
                        continue
                    if value is not None:
                        loc.first.select_option(value=value)
                    elif label is not None:
                        loc.first.select_option(label=label)
                    else:
                        return False
                    return True
                except Exception:
                    continue
        return False

    @staticmethod
    def click_first(host: Page, selectors: List[str]) -> bool:
        for frame in host.frames:
            for sel in selectors:
                try:
                    loc = frame.locator(sel)
                    if loc.count() > 0:
                        loc.first.click(force=True)
                        return True
                except Exception:
                    continue
        return False

    @staticmethod
    def select_option_contains(
        host: Page,
        selectors: List[str],
        text_contains: List[str],
    ) -> bool:
        needles = [n.lower() for n in text_contains if n]
        for frame in host.frames:
            for sel in selectors:
                try:
                    loc = frame.locator(sel)
                    if loc.count() == 0:
                        continue
                    opts = loc.first.locator("option")
                    for idx in range(opts.count()):
                        txt = (opts.nth(idx).inner_text() or "").strip().lower()
                        if txt and all(n in txt for n in needles):
                            value = opts.nth(idx).get_attribute("value")
                            if value and value != "0":
                                loc.first.select_option(value=value)
                                return True
                except Exception:
                    continue
        return False

    @staticmethod
    def select_option_text_variants(
        host: Page,
        selectors: List[str],
        variants: List[str],
    ) -> bool:
        normalized_variants = [
            re.sub(r"[^a-z0-9]+", "", (v or "").lower()) for v in variants if v
        ]
        normalized_variants = [v for v in normalized_variants if v]
        if not normalized_variants:
            return False

        for frame in host.frames:
            for sel in selectors:
                try:
                    loc = frame.locator(sel)
                    if loc.count() == 0:
                        continue
                    opts = loc.first.locator("option")
                    for idx in range(opts.count()):
                        raw_text = (opts.nth(idx).inner_text() or "").strip().lower()
                        option_text = re.sub(r"[^a-z0-9]+", "", raw_text)
                        if not option_text:
                            continue
                        for variant in normalized_variants:
                            if (
                                variant == option_text
                                or variant in option_text
                                or option_text in variant
                            ):
                                value = opts.nth(idx).get_attribute("value")
                                if value and value != "0":
                                    loc.first.select_option(value=value)
                                    return True
                except Exception:
                    continue
        return False

    @staticmethod
    def parse_phone(phone: str) -> Tuple[str, str]:
        digits = re.sub(r"\D", "", phone or "")
        area = digits[:3] if len(digits) >= 3 else ""
        number = digits[3:10] if len(digits) >= 10 else ""
        if len(number) == 7:
            number = f"{number[:3]}-{number[3:]}"
        return area, number
