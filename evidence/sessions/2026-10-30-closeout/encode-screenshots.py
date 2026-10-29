"""Encode the IAB JPEG screenshots as PNG without resizing or content changes."""
import json
from pathlib import Path
from PIL import Image

evidence = Path(__file__).resolve().parent
root = Path(json.loads((evidence / 'startup.json').read_text(encoding='utf-8'))['root'])
results = []
for source in sorted(root.glob('*.jpg')):
    target = evidence / (source.stem + '.png')
    with Image.open(source) as image:
        image.save(target, 'PNG')
        results.append({'source': str(source), 'target': target.name, 'size': image.size,
                        'encoding': 'IAB JPEG decoded to PNG, no resize or content edits'})
(evidence / 'screenshots.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
print(json.dumps(results, indent=2))
