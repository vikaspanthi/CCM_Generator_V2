#!/usr/bin/env python3
"""Embed CCM_Template.docx as assets/template.js (base64) so the app can fill it in place.
Usage: python3 tools-build-template.py path/to/CCM_Template.docx"""
import base64, sys
src = sys.argv[1]
b = base64.b64encode(open(src, 'rb').read()).decode()
open('assets/template.js', 'w').write('/* CCM_Template.docx, embedded. Rebuild with tools-build-template.py */\n(function(r){r.CCM_TEMPLATE_B64="' + b + '";})(typeof window!=="undefined"?window:globalThis);\n')
print('ok', len(b))
