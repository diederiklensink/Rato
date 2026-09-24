# Rato visual theme

Rato uses a warm, quiet palette inspired by paper ledgers and forest ink. Color is reserved for the main action, participant identity, and status messages. The interface avoids decorative gradients and keeps card borders and shadows subtle.

## Palette

| Role | Hex | Use |
| --- | --- | --- |
| Background | `#f3f0e8` | App canvas |
| Surface | `#fffdf8` | Cards, menus, and forms |
| Surface hover | `#ebe7dd` | Hover and disabled states |
| Primary | `#315b49` | Main actions and participant one |
| Primary dark | `#254737` | Main action hover |
| Secondary | `#a86643` | Participant two and add actions |
| Secondary dark | `#844a30` | Secondary action background |
| Foreground | `#292c26` | Headings and primary content |
| Muted | `#73746b` | Labels and supporting text |
| Border | `#e1dbcf` | Card and divider outlines |
| Strong border | `#cec6b8` | Form control outlines |
| Danger | `#a3443d` | Destructive actions and errors |

## Tailwind CSS

The project uses Tailwind CSS 4, so these values are defined in `src/index.css` with `@theme` rather than a JavaScript configuration file. Components use the semantic color utilities such as `bg-background`, `bg-surface`, `text-primary`, and `text-muted`.

The wordmark and favicon are hand-authored SVG assets in `public/`. The wordmark uses a serif logotype; the favicon uses its lowercase initial.
