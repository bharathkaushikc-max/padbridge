# PadBridge

Play your PS5 through **PS Remote Play on Windows with an Xbox controller**.

Sony's Remote Play app for Windows only accepts PlayStation controllers, and it stopped recognising the ViGEm-based virtual DualShock 4 that older tools relied on. PadBridge reads your Xbox controller and presents a virtual **DualSense Edge** to Windows over USB, using [VIIPER](https://github.com/Alia5/VIIPER), so Remote Play accepts it as a real PlayStation controller.

- A desktop app to remap buttons, tune sticks and triggers, test input live and keep several profiles.
- Rumble from the game is passed back to the Xbox controller.
- Every mapping is checked by an automated end-to-end test that presses each input and reads back what Windows receives.

Not affiliated with or endorsed by Sony Interactive Entertainment or Microsoft. PlayStation, DualSense, Xbox and Remote Play are trademarks of their owners.

## Requirements

- Windows 10 or 11
- An Xbox controller (anything Windows sees through XInput: Xbox One, Series, 360)
- [PS Remote Play](https://remoteplay.dl.playstation.net/remoteplay/lang/en/) for Windows, tested with version 9.5
- [Node.js](https://nodejs.org/) 20 or newer
- [VIIPER](https://github.com/Alia5/VIIPER/releases) 0.9.0 or newer, which installs the usbip-win2 driver it needs

## Setup

1. **Install VIIPER.** Download `viiper-windows-amd64.exe` from its [releases page](https://github.com/Alia5/VIIPER/releases) and run `viiper-windows-amd64.exe install`. Keep **Install USBIP** ticked and reboot when asked. PadBridge starts the VIIPER server itself, so you can untick **Autostart**, or turn VIIPER off later under Settings → Apps → Startup.
2. **Get PadBridge and its dependencies.**
   ```
   git clone https://github.com/bharathkaushikc-max/padbridge.git
   cd padbridge
   npm install
   ```
3. **Start it.** Double-click `PadBridge.cmd`, or run `npm run app`. (In PowerShell, if scripts are blocked, use `npm.cmd run app`.)

To get a desktop shortcut, right-click `PadBridge.cmd` → Show more options → Send to → Desktop.

## Using it

Open PadBridge, make sure the switch at the top right reads **Bridge on**, then click into PS Remote Play and play. Remote Play only listens to the controller while its own window is focused.

Closing the PadBridge window shuts everything down: the virtual controller is removed and the VIIPER server is stopped. Minimise it instead if you want to keep playing.

### Default mapping

| PlayStation | Xbox |
|---|---|
| Cross, Circle, Square, Triangle | A, B, X, Y |
| L1, R1, L2, R2 | LB, RB, LT, RT (triggers stay analog) |
| L3, R3, sticks, D-pad | Stick clicks, sticks, D-pad |
| Options | Menu |
| PS button | Xbox button, or View + Menu |
| Create | Tap View |
| Touchpad click | Hold View for 0.3 s, or View + RB |
| Touchpad swipe | Hold View and move the right stick |

The Xbox controller has fewer buttons than a DualSense, so View works as a modifier. Everything except the analog sticks and triggers can be remapped in the app.

### The screens

- **Mapping:** a drawing of your controller with a callout on each control. Press a button to find it; pick what it sends from its callout.
- **Tuning:** stick deadzone, trigger press point and View hold time, each beside a live view of your controller.
- **Test:** your controller on one side, what Remote Play receives on the other, plus a vibration test.
- **Profiles:** create, rename, duplicate, delete, import and export. Changes apply immediately.

## Known limits

- **Xbox button and Game Bar.** On many PCs the Xbox button also opens Xbox Game Bar, and while it is open Windows hides the other buttons from PadBridge. Use View + Menu for the PS button, or turn off Settings → Gaming → Game Bar → "Allow your controller to open Game Bar".
- **Not reproduced:** adaptive triggers, the DualSense speaker and microphone, and motion controls (the virtual controller reports lying flat).
- **One controller.** Remote Play takes one controller; PadBridge uses the first Xbox controller it finds.
- **Sony can change this.** A future Remote Play update could stop accepting the virtual controller, as happened to ViGEm-based tools.

## Command-line bridge

The same engine runs without the window:

```
node src/bridge.js            # default mapping
node src/bridge.js --verbose  # print every button change
node src/bridge.js --profile my-profile.json
```

## Tests

```
npm test        # unit tests for the mapping engine and profiles
npm run e2e     # end-to-end: every input through the real bridge
```

The end-to-end test creates a scripted virtual Xbox controller, runs the real bridge against it, presses every input in turn and checks the DualSense report Windows receives. It needs the VIIPER server running and refuses to press anything while PS Remote Play is the focused window. Stop the app first.

## How it works

```
Xbox controller -> XInput -> mapping engine -> VIIPER (USB/IP) -> virtual DualSense Edge -> PS Remote Play
                                   rumble <- output reports  <-
```

| Path | What it does |
|---|---|
| `src/xinput.js` | Reads the Xbox controller through Windows XInput, including the Xbox button |
| `src/mapping.js` | Pure mapping engine: Xbox state in, DualSense report out |
| `src/engine.js` | The bridge loop, VIIPER connection, reconnects and rumble |
| `src/profiles.js` | Profile files |
| `src/bridge.js` | Command-line bridge |
| `app/` | Electron desktop app |
| `e2e/run.js` | End-to-end button test |
| `spike/spike.js` | The original proof that Remote Play accepts a VIIPER DualSense |

Why a DualSense **Edge**: in testing, Remote Play ignored a virtual standard DualSense but accepted the Edge and the DualShock 4.

## Licence

[MIT](LICENSE)
