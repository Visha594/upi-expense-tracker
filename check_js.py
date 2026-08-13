import glob
import sys
import re

sys.stdout.reconfigure(encoding='utf-8')

print("=== CHECKING ALL JS FILES ===")
files = sorted(glob.glob('js/*.js'))
for f in files:
    with open(f, 'r', encoding='utf-8') as fp:
        content = fp.read()
    
    # Check for invalid Python format specifiers inside template literals
    bad_specifiers = re.findall(r'\$\{[^}]*:[0-9,.\s]*f\}', content)
    if bad_specifiers:
        print(f"ERROR in {f}: Found illegal Python format specifier: {bad_specifiers}")
    else:
        print(f"✓ {f} ({len(content.splitlines())} lines) - No format specifier syntax issues")

print("\n=== CHECKING SCRIPT TAGS IN index.html ===")
with open('index.html', 'r', encoding='utf-8') as fp:
    html = fp.read()

scripts = re.findall(r'<script[^>]*>.*?</script>', html, re.DOTALL)
print(f"Found {len(scripts)} script tags in index.html")
for idx, s in enumerate(scripts):
    print(f"Script #{idx+1}: {s[:100]}...")

print("\nALL CHECKS COMPLETE!")
