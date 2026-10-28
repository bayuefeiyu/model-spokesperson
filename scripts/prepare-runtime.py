"""Copy the installed, versioned DSH package tree into the isolated dev area."""
from pathlib import Path
import runpy
import json

AsarReader = runpy.run_path(str(Path(__file__).with_name('inspect-runtime.py')))['AsarReader']
root = Path(__file__).resolve().parents[1]
reader = AsarReader(Path(r'G:\ai\harness\dsh desktop\resources\app.asar'))
target = root / '.dev' / 'runtime'
count = 0
def visit(node, prefix=''):
    global count
    for name, entry in node.get('files', {}).items():
        path = prefix + name
        if 'files' in entry:
            visit(entry, path + '/')
        elif not entry.get('link') and int(entry.get('size', 0)) <= 20 * 1024 * 1024:
            dest = (target / path).resolve()
            if not dest.is_relative_to(target.resolve()):
                raise ValueError(path)
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(reader.read('dsh/' + path))
            count += 1
visit(reader.index['files']['dsh'])
print(json.dumps({'copiedFiles': count, 'target': str(target)}))
