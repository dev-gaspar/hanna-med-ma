from __future__ import annotations

import argparse
import json
from pathlib import Path

from .service import parse_registration_payload, run_registration


def main() -> None:
    parser = argparse.ArgumentParser(description="CareTracker runner")
    parser.add_argument(
        "--input-file",
        type=Path,
        required=True,
        help="Path to payload JSON file (patient_details + insurance_periods)",
    )
    parser.add_argument(
        "--headed",
        action="store_true",
        help="Run with visible browser",
    )
    args = parser.parse_args()

    data = json.loads(args.input_file.read_text(encoding="utf-8"))
    payload = parse_registration_payload(data)
    result = run_registration(
        payload=payload,
        headless=not args.headed,
    )

    print(json.dumps(result, indent=2, ensure_ascii=False))
    if not result.get("success"):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
