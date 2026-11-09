"""Trusted single-player lottery adapter. Reads JSON from stdin; no browser-supplied records."""
import importlib.util
import json
import pathlib
import sys


def main():
    request = json.load(sys.stdin)
    origin = pathlib.Path(__file__).resolve().with_name('draft_lottery.py')
    spec = importlib.util.spec_from_file_location('bm_original_draft_lottery', origin)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    result = module.run_draft_lottery(request['league'], request['payload'])
    print(json.dumps(result, allow_nan=False, separators=(',', ':')))


if __name__ == '__main__':
    main()
