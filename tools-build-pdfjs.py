#!/usr/bin/env python3
"""Converts the ES-module pdf.js build in lib/*.mjs into classic <script> files (lib/pdfjs-main.js, lib/pdfjs-worker.js).
Classic scripts load even when index.html is opened straight from a folder (file://), where module imports are blocked.
Usage: python3 tools-build-pdfjs.py <path to pdfjs-dist/legacy/build>"""
import re, sys, pathlib
src = pathlib.Path(sys.argv[1]); out = pathlib.Path(__file__).parent / 'lib'
URL = "(self.location&&self.location.href||'http://localhost/')"
main = (src / 'pdf.min.mjs').read_text(encoding='utf-8')
i = main.rindex('export{'); exp = main[i + 7: main.rindex('}')]
pairs = []
for part in exp.split(','):
    part = part.strip()
    if not part: continue
    a, _, b = part.partition(' as ')
    pairs.append(f"{b or a}:{a}")
main = main[:i] + 'window.pdfjsLib={' + ','.join(pairs) + '};'
main = main.replace('import.meta.url', URL)
(out / 'pdfjs-main.js').write_text(';(function(){' + main + '\n})();', encoding='utf-8')
w = (src / 'pdf.worker.min.mjs').read_text(encoding='utf-8')
w = w.replace('export{WorkerMessageHandler};', '').replace('import.meta.url', URL)
assert 'globalThis.pdfjsWorker=' in w
(out / 'pdfjs-worker.js').write_text(';(function(){' + w + '\n})();', encoding='utf-8')
print('ok', len(main), len(w))
