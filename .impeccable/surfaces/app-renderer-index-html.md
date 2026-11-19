---
version: 1
slug: "app-renderer-index-html"
primary_target: "app/renderer/index.html"
related_targets: []
---

# PadBridge app window

Scope: the whole Electron window (status strip, Mapping, Tuning, Test, Profiles). Mode: Operate.

Audience and job: one owner who opens the window rarely, to set a mapping once or to find out why the bridge is not working. Constraint: must not read as a bland settings page; no Sony or Microsoft marks.

## Direction contract

THESIS: The controls page of a printed game manual. The controller in your hands is drawn in line art and every control is annotated with what it does on the PS5. Refuses the remapper default of a table of dropdown rows.

OWN-WORLD: Bright white stock (#fbfbf8), ink black (#16171a) in 2px rules and line art, one spot blue (#086fab) for the Xbox side and for anything live, signal red (#e2452f) only for a broken link or a warning. Hanken Grotesk, heavy for names, tight tracking on the page title. Callouts are a bold name over a black rule that becomes the leader line. No cards, no shadows, no gradients.

STORY: The owner sees at once whether the chain is up, recognises their controller, presses a button to find its callout, and changes what it sends.

FIRST VIEWPORT: Left rail 200px (wordmark, four sections). Status strip across the top of the work area: Xbox controller, Bridge, Remote Play, and the bridge switch at the right. Below, the page title and profile name, then the controller drawing centred with callouts in a column each side and three above, leader lines joining each to its control. Two ruled blocks under the drawing: View button combos and D-pad directions.

FORM: Manual Page, position 1 on the ordered list (the user's pick over the assigned direction). seed:5223da88c8b11468

SIGNATURE: the drawing is live. A pressed control fills blue and its leader line and callout ink in blue; sticks lean, triggers fill by how far they are pulled.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
