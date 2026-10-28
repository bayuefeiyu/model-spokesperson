"""Read DSH installation metadata and write a small, credential-free evidence report.

Only the chosen report path is written. The installation and optional source
checkout are read without importing or executing any of their JavaScript.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess
from datetime import datetime, timedelta, timezone


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


class AsarReader:
    def __init__(self, path: Path):
        self.path = path
        with path.open('rb') as stream:
            header = stream.read(16)
            if len(header) != 16:
                raise ValueError('ASAR header is incomplete')
            _, self.header_size, _, json_size = struct.unpack('<4I', header)
            if json_size > 32 * 1024 * 1024 or json_size > self.header_size:
                raise ValueError('Unexpected ASAR header size')
            self.index = json.loads(stream.read(json_size))

    def read(self, name: str) -> bytes:
        node = self.index
        for part in name.split('/'):
            node = node['files'][part]
        if node.get('link'):
            raise ValueError('ASAR link is not followed: ' + name)
        size = int(node['size'])
        if size > 20 * 1024 * 1024:
            raise ValueError('Selected file exceeds inspection size limit: ' + name)
        if node.get('unpacked'):
            return (Path(str(self.path) + '.unpacked') / name).read_bytes()
        with self.path.open('rb') as stream:
            stream.seek(8 + self.header_size + int(node['offset']))
            data = stream.read(size)
        if len(data) != size:
            raise ValueError('Truncated ASAR entry: ' + name)
        return data


def git_read(source: Path, args: list[str]) -> dict:
    rtk = shutil.which('rtk')
    if not rtk:
        return {'status': 'skipped', 'reason': 'rtk is not available; no Git command executed'}
    command = [rtk, 'git', '-C', str(source), *args]
    result = subprocess.run(command, capture_output=True, text=True,
                            encoding='utf-8', errors='replace', timeout=20)
    return {'command': command, 'exitCode': result.returncode,
            'stdout': result.stdout.strip(), 'stderr': result.stderr.strip()}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--installation', type=Path, required=True)
    parser.add_argument('--source', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    installation = args.installation.resolve()
    output = args.output.resolve()
    source = args.source.resolve() if args.source else None
    if output.is_relative_to(installation) or (source and output.is_relative_to(source)):
        parser.error('Write the report outside the installation and source checkout')
    archive = installation / 'resources' / 'app.asar'
    reader = AsarReader(archive)
    report = {
        'schemaVersion': 1,
        'checkedAt': datetime.now(timezone(timedelta(hours=8))).isoformat(),
        'installation': str(installation),
        'archive': {'path': str(archive), 'bytes': archive.stat().st_size,
                    'sha256': sha256_file(archive)},
        'limitations': [
            'This inspects the specified directory, not the actual running application.',
            'No latest-release lookup or runtime compatibility test is performed.',
            'API presence does not prove that replacing a built-in chat renderer is supported.',
            'No user configuration, credentials, session logs or model APIs are accessed.',
        ],
        'packages': {},
        'interfaces': {},
    }
    names = {'desktop': 'package.json'}
    for package in ('dsh', 'dsh-llm', 'dsh-agent', 'dsh-client-ui-chat', 'cordis'):
        names[package] = f'dsh/node_modules/@deepseek-ai/{package}/package.json'
    for label, name in names.items():
        try:
            raw = reader.read(name)
            data = json.loads(raw)
            fields = ('name', 'version', 'engines', 'repository', 'dshBuildCommit', 'dshBuildDirty')
            report['packages'][label] = {
                'asarPath': name, 'sha256': hashlib.sha256(raw).hexdigest(),
                **{key: data[key] for key in fields if key in data},
            }
        except (KeyError, OSError, ValueError) as error:
            report['packages'][label] = {'asarPath': name, 'error': str(error)}
    base = 'dsh/node_modules/@deepseek-ai/'
    checks = {
        base + 'dsh-llm/lib/index.js': ['isAgentLoopRequest', '"llm/stream"'],
        base + 'dsh-llm/lib/typert.host.js': [
            '"name": "GenerateOptions"', '"name": "FinishReasonMap"',
            '"name": "StreamChunk"', '"name": "llm/stream"',
        ],
        base + 'dsh-llm/README.md': ['deep-frozen', 'replay', 'ctx.llm.stream'],
        base + 'dsh-client-ui-chat/README.md': ['does not assemble', 'replay', 'Assistant'],
        base + 'dsh/README.md': ['DSH_HOME', 'Desktop-installed command', 'peer ranges'],
        base + 'dsh-home-paths/README.md': ['explicit path wins', 'highest precedence'],
    }
    for name, patterns in checks.items():
        try:
            raw = reader.read(name)
            lines = raw.decode('utf-8').splitlines()
            hits = []
            for pattern in patterns:
                count = 0
                for number, line in enumerate(lines, 1):
                    if pattern in line:
                        hits.append({'pattern': pattern, 'line': number, 'text': line[:800],
                                     'nextLine': lines[number][:1600] if number < len(lines) else ''})
                        count += 1
                        if count == 2:
                            break
            report['interfaces'][name] = {
                'sha256': hashlib.sha256(raw).hexdigest(), 'matches': hits,
                'missingPatterns': [p for p in patterns if not any(h['pattern'] == p for h in hits)],
            }
        except (KeyError, OSError, ValueError) as error:
            report['interfaces'][name] = {'error': str(error)}
    if source:
        report['sourceCheckout'] = {
            'path': str(source),
            'head': git_read(source, ['log', '-1', '--format=%H %cs %s']),
            'note': 'Source HEAD may differ from the installed runtime; local modifications were not inspected.',
        }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'output': str(output), 'desktop': report['packages']['desktop'],
                      'checkedFiles': len(report['interfaces'])}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
