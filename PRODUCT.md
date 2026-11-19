# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Electron desktop app (Windows). Renderer is plain HTML/CSS/JS with no framework; the main process runs the bridge engine in Node. Confirmed by the user choosing to stay in Node and build the UI as Electron.

## Users

One person: the author, a PC and PS5 player who travels with an Xbox controller and plays their PS5 through Sony's PS Remote Play on a Windows laptop. They know what VIIPER and Remote Play are. No onboarding audience.

## Product Purpose

PS Remote Play on Windows only accepts PlayStation controllers. PadBridge reads an Xbox controller and presents a virtual DualSense Edge to Windows so Remote Play accepts it. Success is: plug in the Xbox pad, start PadBridge, play, and never think about it again.

## Positioning

It works with Sony's official Remote Play client by emulating a real USB DualSense Edge through VIIPER, where ViGEm-based tools stopped being accepted. Every mapping is verified end to end by an automated test that presses each input and reads back what Windows receives.

## Operating Context

- Configured once, then lives in the system tray. The window is opened rarely: first setup, a remap, or when something stops working.
- Used next to PS Remote Play on the same laptop. Remote Play only forwards controller input while its own window is focused.
- Depends on the VIIPER server (auto-starts with Windows) and its usbip-win2 driver.
- The Xbox controller has fewer inputs than a DualSense, so the View button acts as a modifier: tap, hold, and chords with other buttons reach Create, the touchpad click, the PS button and touchpad swipes.

## Capabilities and Constraints

- Inputs come from Windows XInput (slots 1-4). Triggers and sticks are analog and fixed to L2/R2 and the two sticks; buttons and the D-pad are remappable.
- Output is a DualSense Edge report: 15 buttons, D-pad, two sticks, two triggers, one touch point. Gyro reports a controller resting flat. Adaptive triggers, mic and speaker are not reproduced.
- Rumble from Remote Play is passed back to the Xbox pad's two motors.
- On this PC, pressing the Xbox button also opens Xbox Game Bar, which hides other buttons from the bridge until dismissed. View + Menu is the reliable PS button.
- Profiles are JSON files. One profile is active at a time.
- Terminology: "Xbox controller" (input), "virtual DualSense" (output), "View" and "Menu" (the two small Xbox buttons), "bridge" (the running translation).

## Evidence on Hand

- Working engine: `src/mapping.js`, `src/xinput.js`, `src/bridge.js`.
- 16 unit tests and a 36-check end-to-end test (`e2e/run.js`), all passing.
- No logo, brand assets or screenshots exist.

## Product Principles

1. Out of the way. The best session is one where the window never opens.
2. Status before settings. When the window does open, the first thing it answers is "is it working, and if not, which link in the chain is broken".
3. Show the controller, not the data. Buttons and sticks are shown as buttons and sticks; raw values stay out of the main path.
4. Nothing that can press buttons into a live game by accident.

## Brand Commitments

- Must not read as a bland settings page (user's stated dislike).
- Not an official Sony or Microsoft product; no PlayStation or Xbox logos or brand marks.
