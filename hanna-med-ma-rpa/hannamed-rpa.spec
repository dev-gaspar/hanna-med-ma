# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for Hanna-Med RPA Node (Headless) — Single .exe

Build command:
    pyinstaller hannamed-rpa.spec

Output: dist/HannamedRPA.exe  (single file)
"""

import os
from PyInstaller.utils.hooks import copy_metadata, collect_submodules

block_cipher = None

# Bundle package metadata for packages that use importlib.metadata at runtime
# This fixes "No package metadata was found for X" errors
datas = [
    ('rpa_config.json', '.'),
    ('images', 'images'),
]

# Include .env only if it exists at build time
if os.path.exists('.env'):
    datas.append(('.env', '.'))

# Collect metadata for packages that read their own version/metadata
for pkg in ['replicate', 'httpx', 'httpcore', 'anyio', 'langchain', 'langchain_core',
            'langchain_google_genai', 'google_genai', 'pydantic']:
    try:
        datas += copy_metadata(pkg)
    except Exception:
        pass

a = Analysis(
    ['app.py'],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=[
        # Flow modules
        'flows',
        'flows.jackson',
        'flows.baptist',
        'flows.steward',
        'flows.jackson_summary',
        'flows.jackson_insurance',
        'flows.jackson_batch_summary',
        'flows.jackson_batch_insurance',
        'flows.baptist_summary',
        'flows.baptist_insurance',
        'flows.baptist_batch_summary',
        'flows.baptist_batch_insurance',
        'flows.steward_summary',
        'flows.steward_insurance',
        'flows.steward_batch_summary',
        'flows.steward_batch_insurance',
        'flows.jackson_lab',
        'flows.jackson_batch_lab',
        'flows.jackson_unified_batch',
        'flows.baptist_lab',
        'flows.baptist_batch_lab',
        'flows.baptist_unified_batch',
        'flows.base_flow',
        'flows.base_batch_summary',
        'flows.batch_summary_registry',
        # Agentic (screen navigation / OmniParser)
        'agentic',
        'agentic.runners',
        'agentic.runners.jackson_summary_runner',
        'agentic.runners.jackson_insurance_runner',
        'agentic.runners.jackson_lab_runner',
        'agentic.runners.baptist_summary_runner',
        'agentic.runners.baptist_insurance_runner',
        'agentic.runners.baptist_lab_runner',
        'agentic.runners.steward_summary_runner',
        'agentic.runners.steward_insurance_runner',
        'agentic.runners.steward_lab_runner',
        'agentic.models',
        'agentic.omniparser_client',
        'agentic.screen_capturer',
        'agentic.core',
        'agentic.core.llm',
        'agentic.core.base_agent',
        # Core utilities
        'core',
        'core.rpa_engine',
        'core.s3_client',
        'core.system_utils',
        'core.vdi_input',
        'core.redis_consumer',
        # Services
        'services',
        'services.modal_watcher_service',
        # Config
        'config',
        'config_manager',
        'rpa_node',
        # CareTracker
        'caretracker',
        'caretracker.worker',
        'caretracker.service',
        'caretracker.runner',
        'caretracker.browser',
        'caretracker.types',
        'caretracker.fixtures',
        'caretracker.form_enums',
        'caretracker.flows',
        'caretracker.flows.login',
        'caretracker.flows.search',
        'caretracker.flows.registration',
        # Runtime libs that may be missed
        'httpx',
        'httpcore',
        'anyio',
        'anyio._backends._asyncio',
        'anyio._backends._trio',
        'pkg_resources',
        'pkg_resources._vendor',
        'importlib.metadata',
        # Playwright (used by CareTracker headless browser)
        'playwright',
        'playwright.sync_api',
        # Redis
        'redis',
        # AWS S3
        'boto3',
        'botocore',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'tkinter',
        'customtkinter',
        'unittest',
        'test',
        'fastapi',
        'uvicorn',
        'starlette',
        '_pytest',
        'doctest',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='HannamedRPA',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
)
