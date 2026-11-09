"""Online-only trusted adapter to the unchanged single-player All-Star algorithm.
Invoked by Node with Python -I; stdin is server-built and never browser-provided.
"""
import json
import sys
from pathlib import Path
# Python -I intentionally omits the script directory from sys.path. Add only
# this fixed, trusted backend folder so the original selector is importable.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from all_star_logic import compute_all_stars


def main():
    payload = json.load(sys.stdin)
    if not isinstance(payload, dict):
        raise ValueError('Invalid trusted selection input')
    result = compute_all_stars(payload)
    print(json.dumps(result, allow_nan=False, separators=(',', ':')))


if __name__ == '__main__':
    main()
