# Models

## hero.glb

The player character for the 3D resume (`resume-3d.html`).

- **Source:** "Animated Men Pack" by [Quaternius](https://quaternius.com/)
- **Licence:** CC0 1.0 (public domain) — free for personal and commercial use,
  attribution not required but given here anyway.
- **Obtained from:** https://poly.pizza/bundle/Animated-Men-Pack-DAC9SDgMQT

Ships with a skeleton and eleven animation clips. The game uses five of them:
`Man_Idle`, `Man_Walk`, `Man_Run`, `Man_Jump` and `Man_SwordSlash` (the last
drives the spin attack).

`js/game/player.js` recolours the model's materials at load time — by material
name, so the source file is untouched — to match the palette of the author's
cartoon avatar in `img/profile_picture_cartoon.jpg`.
