---
version: 1
slug: "nginx-50x-html"
primary_target: "nginx/50x.html"
related_targets: ["nginx.conf", "app/app.py"]
---

## Mode
Read / understand the server failure and find the recovery actions.

## Direction
Follow DESIGN.md's flat reading surface, left-aligned text, display heading
scale and 1.35 Cyrillic heading leading, 1.7 prose leading, shared gutters,
44px controls and visible keyboard focus. Keep the illustration centered.
The existing red/yellow palette is pinned by the owner for this failure page;
do not replace it with the site's leaf/lake palette. Keep the existing copy,
including the status signature, and all link destinations.

## Independence
One HTML file with inline CSS and the existing WebP data URI. No JavaScript,
application assets, font downloads or CDN. Use DESIGN.md's local font stacks
and their system fallbacks. Preserve the nginx/X-Accel-Redirect behavior and
HTTP error status. Do not add animations, decorative gradients or card shadows.
