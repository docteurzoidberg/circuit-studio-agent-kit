# Usage: make-open.py <project.c3dproj> <out.js>
# Builds a page function that "opens" the project through the app's own Open file input.
import json, sys
text = open(sys.argv[1], encoding='utf-8').read()
name = sys.argv[1].rsplit('/', 1)[-1]
open(sys.argv[2], 'w').write("""() => {
  const input = document.querySelector('input[type=file][accept*=".c3dproj"]');
  const dt = new DataTransfer();
  dt.items.add(new File([%s], %s, { type: 'application/json' }));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return input.files.length;
}""" % (json.dumps(text), json.dumps(name)))
