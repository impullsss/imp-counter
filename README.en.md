# Imp Counter

Documentation: [Russian](README.ru.md) | [English](README.en.md)

Author: Impullsss

A small system-agnostic module for Foundry VTT. It adds two shared counters that can be used for Advantage, Group Advantage, or any other table resource.

Technical module id: `imp-counter`.

## Features

- Opens two small resizable windows.
- Windows can be dragged by the title row and resized from the edges, without a visible resize handle.
- The title row has a compact white close control.
- A small `Adv` button in the lower left opens or hides both windows.
- The launcher smoothly moves above the Foundry player list so it does not cover players.
- The launcher has a `Reset` button near the counters: it resets the available counters to 0 and changes to `Undo` while that reset can be reverted.
- Clicking the first or second launcher counter opens that counter window; clicking it again hides the window.
- Values are shared across the world and synchronized through `game.settings`.
- The GM can always change both counters.
- Module settings can allow or block players from changing the first and second window separately.
- Values can be changed with the `+` and `-` buttons; `Shift-click` changes the value by 5.
- Values can also be typed manually.
- Settings and interface text are loaded from `lang/en.json` or `lang/ru.json`, depending on the Foundry language.

## Settings

- `First window text` - label for the first counter.
- `Second window text` - label for the second counter.
- `Players can change the first window` - player permission for the first counter.
- `Players can change the second window` - player permission for the second counter.
- `Allow negative values` - disabled by default because Advantage usually cannot go below 0.
- `Reset when Combat is created` - optional auto-reset to 0 when a new Combat is created.
- `Open windows on login` - client setting for the current user. Disabled by default.
- `Show the Adv button` - client setting for the current user.

## For Players

If a player is allowed to change a window, their `+`, `-`, and manual input send a request to the active GM through the module socket. If no active GM is present, the value is not saved and a warning is shown.

## Console API

The module also exposes a small API:

```js
game.impCounter.open();           // open both windows
game.impCounter.open("one");      // open the first window
game.impCounter.open("two");      // open the second window
game.impCounter.close();          // close both windows
game.impCounter.set("one", 3);    // set value
game.impCounter.adjust("two", 1); // adjust value
```

## Ideas for a Later Version

- Color thresholds: for example 0 gray, 1-3 green, 4+ red.
- Third counter mode for games that need more than two sides.
- Scene-specific values instead of one shared world value.
- Chat log for Advantage changes.
