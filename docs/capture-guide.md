# Capture guide

These are tips for the person holding the phone. Ship them in your app's onboarding, because a good scan comes far more from how the room is filmed than from anything in code.

## Before you start

- Turn on every light. Open blinds unless direct sun is hitting the floor.
- Clear people and pets out of the room. Anything that moves during a scan shows up as a blurry patch.
- Close doors to rooms you aren't scanning.
- Hold the phone in portrait unless the room calls for landscape. Pick one and keep it for the whole scan.
- Walk slowly. One step per second is about right.

## The seven tips

1. **Focus first on one part of the room.** Tilt slowly up and down to capture where the wall meets the ceiling and the floor.
2. **Capture everything around you.** Include hidden spots, like the corner behind the couch.
3. **Look under furniture.** Tilt the phone down to capture under chairs and tables.
4. **Capture the ceiling from several spots.** Scan the ceiling from different parts of the room.
5. **Revisit areas from new angles.** Scanning an area again from a new angle fills in gaps.
6. **Get close for details.** Move closer and slow down to make small objects and text sharp.
7. **Keep people out of the room.** People who move during a scan show up as blurry patches.

## A pattern that works

1. Stand near a wall and pick the **Walls** pass in the scan guide. Sweep along the wall, tilting up and down so both edges are covered.
2. Walk the perimeter of the room this way, overlapping each section with the last.
3. Switch to **Ceiling**. Tilt up, keep the top of a wall in view, and move along it so the ceiling is seen from different spots.
4. Switch to **Floor**. Tilt down, keep the bottom of a wall in view, and move around furniture to capture the floor beyond it.
5. Go back to anything detailed (a bookshelf, a kitchen counter) and get close.

Most rooms take 1 to 3 minutes. The prototype caps a scan at 5,000 frames, which is more than that needs.

## What the app tells you

The live screen shows at most one message at a time. No message means things are going well.

| Message | What to do |
| --- | --- |
| Turn back to portrait (or landscape) | You rotated the phone away from the hold you started in. Frames aren't saved until you turn back |
| Going too fast | Slow down, especially when turning. Fast turns blur frames, and blurred frames are dropped |
| Hold still. Recovering tracking | Stop and point at something you already scanned until the message clears |
| Aim at a textured surface | The camera sees a blank wall or a window. Include an edge, a corner or furniture in view |
| Turn on more light | The room is too dark to track or to make sharp frames |
| Paused because the phone is still | Not an error. Frames are only taken when the camera moves. Keep walking |
| Tilt up toward the walls / Tilt down toward the walls | The scan guide is on the Walls pass but the phone points at the floor or ceiling. Level it out |
| You're nearing the scan limit | Finish soon. Everything captured so far is kept |

The Full setup adds these on LiDAR devices:

| Message or visual | What to do |
| --- | --- |
| Paint spreading over surfaces | Painted areas have been seen by saved frames. Aim at the unpainted ones |
| Don't forget the ceiling / floor / walls | That kind of surface is barely covered after a minute of scanning. Point the camera at it |
| Possible gap in the ceiling (or lower wall, floor, and so on) | A patch of that surface may not have been seen. Scan the highlighted area |
| Turn left / right, Look up / down toward the missing area | The gap is off screen. Turn as told until it's highlighted |
| Finish review with holes | Tap Keep scanning to go back and fill them one at a time, or Save if they don't matter |

## Why frames get skipped

The frame counter only goes up when the camera has moved about 7 cm or turned about 10° since the last frame, and tracking is solid. It pauses when you stand still, right after you start or resume (about half a second of settling), when tracking is limited, when the phone is turned to the other orientation, and when a frame would be badly blurred. All of these are normal. A scan that keeps moving keeps counting.
