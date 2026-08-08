// Entry point: boots the renderer, builds the world from data.json and runs
// the game loop (input → physics → interactions → camera → render).

import * as THREE from '../vendor/three.module.js';
import { World, ZONE_RADIUS } from './world.js';
import { Player } from './player.js';
import { UI } from './ui.js';
import { GameAudio } from './audio.js';
import { Crate } from './crate.js';

// Flight only launches from, and can only land back on, the Cortical.io
// island (Vienna) — the one costume stage ('caped') where the player is
// airborne without a weapon in hand. A generous radius keeps landing forgiving
// near the shoreline without allowing a touchdown on a neighbouring island.
const FLIGHT_ISLAND_COMPANY = 'Cortical.io';
const FLIGHT_LANDING_RADIUS = ZONE_RADIUS + 4;

// Chase camera zoom, toggled by the up/down arrow keys — see cameraZoom in
// _initInput and its use in _updateCamera. Clamped so zooming in never
// tucks the camera inside the player, and zooming out never pushes it so
// far that occlusion/shadow quality falls apart.
const ZOOM_STEP = 0.18;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.0;

// Atmosphere targets for _updateAtmosphere — see there for how these blend
// with the scene's base daytime values.
//
// Night was originally tuned much darker (ambient 0.28, sun 0.22) and read
// as too dark to play in — moonlight should still let the player see the
// island clearly, with the lanterns and moon doing the atmosphere work
// rather than genuine darkness.
const NIGHT_FOG = new THREE.Color(0x24406e);
const NIGHT_FOG_NEAR = 30;
const NIGHT_FOG_FAR = 180;
const NIGHT_AMBIENT = new THREE.Color(0x5870a8);
const NIGHT_AMBIENT_I = 0.55;
const NIGHT_SUN = new THREE.Color(0xb9c9ec);
const NIGHT_SUN_I = 0.45;
const NIGHT_BOUNCE_SKY = new THREE.Color(0x35508c);
const NIGHT_BOUNCE_GROUND = new THREE.Color(0x2a3348);

const CHILL_FOG = new THREE.Color(0xc9d8e6);
const CHILL_FOG_NEAR = 24;
const CHILL_FOG_FAR = 130;
const CHILL_AMBIENT = new THREE.Color(0xd8e4f0);
const CHILL_AMBIENT_I = 0.85;
const CHILL_SUN = new THREE.Color(0xdfeaf7);
const CHILL_SUN_I = 0.85;
const CHILL_BOUNCE_SKY = new THREE.Color(0xb8ccdf);

const DATA_URL = new URL('../../data.json', import.meta.url);

// Costume per island, keyed by the zone's chronological index. Company name is
// not enough to key on — the career visits Upstream twice, and the two stints
// look completely different (lone hero, then a leader with a team behind them).
//
//   0 Intracom Telecom   1 Hellenic Army      2 European Dynamics
//   3 Upstream (eng)     4 Cortical.io        5 Camunda
//   6 Upstream (manager)
//
// The education island is handled separately: it is always the graduation cap.
const STAGE_BY_ZONE = {
    0: 'plain',      // first job — the cap comes off
    1: 'army',       // Hellenic Army — conscription
    2: 'chains',     // European Dynamics
    3: 'hero',       // Upstream — sword in hand
    4: 'caped',      // Cortical.io — grown, and a cape
    5: 'fourArms',   // Camunda — same size, four arms
    6: 'leader'      // Upstream again — the same, now with a team to shield
};

const STAGE_TOAST = {
    plain: '👕 Cap off — first day on the job.',
    army: '🪖 Kitted out — national service.',
    chains: '⛓️ The moon is my witness.',
    hero: '🗡️ A sword, and the strength to swing it.',
    caped: '🦸 Grown into the cape.',
    fourArms: '🖐️ Four arms — twice the throughput.',
    leader: '🛡️ Four to lead, and to shield.'
};

// Per-island theme song, keyed the same way as STAGE_BY_ZONE (the education
// island is handled separately, see EDU_TRACK below). Filenames carry a
// leading track number for ordering in the mp3 folder; that number is
// stripped for display so the sky only ever shows the song's name.
//
// Upstream is visited twice: the two stints get different tracks (5 first
// time, 8 the second) since reusing one silently would mean two very
// differently staged islands sound identical to a returning player.
function trackUrl(filename) {
    return new URL(`../../mp3/${filename}`, import.meta.url).href;
}
const ZONE_TRACK = {
    0: { url: trackUrl("2. Morning Quest.mp3"), name: 'Morning Quest' },
    1: { url: trackUrl("3. Steel March.mp3"), name: 'Steel March' },
    2: { url: trackUrl("4. Dark Eclipse.mp3"), name: 'Eclipsis' },
    3: { url: trackUrl("5. An Ancient Adventure.mp3"), name: 'An Ancient Adventure' },
    4: { url: trackUrl("6. Red-White Scherzo.mp3"), name: 'Red-White Scherzo' },
    5: { url: trackUrl("7. German Staccato.mp3"), name: 'The Staccato of Prussia' },
    6: { url: trackUrl("8. The Aegean Run.mp3"), name: 'The Aegean Run' }
};
const EDU_TRACK = { url: trackUrl("1. Apollo's Temple.mp3"), name: "Apollo's Temple" };
const MAIN_THEME = { url: trackUrl('Skybridge of Names (Main Theme).mp3'), name: 'Skybridge' };
const OUTRO_TRACK = { url: trackUrl('Lanterns at Dusk (Outro).mp3'), name: 'Lanterns at Dusk' };

class Game {
    constructor(data) {
        this.data = data;
        this.clock = new THREE.Clock();
        this.elapsed = 0;
        this.cratesBroken = 0;
        this.fruitsCollected = 0;
        this.finished = false;
        // True from playMainTheme() until "Enter Island" is clicked — the
        // main theme belongs to the Resume Island title screen, so the
        // university island's own track must not cut in while it's still up,
        // no matter how long the player lingers there. holdMusicHandoff()
        // then keeps it a moment longer so the crossfade doesn't begin the
        // instant the screen starts fading out.
        this.titleScreenActive = false;
        this._themeHoldUntil = 0;

        // Island atmosphere: eased 0→1 toward whichever of these the current
        // zone calls for (set in _updateZoneLabel), applied every frame in
        // _updateAtmosphere. Both default off (open water / daytime).
        this._nightTarget = 0;
        this._nightAmount = 0;
        this._chillTarget = 0;
        this._chillAmount = 0;
        // Scratch colors reused every frame by _updateAtmosphere.
        this._tmpFog = new THREE.Color();
        this._tmpAmbient = new THREE.Color();
        this._tmpSun = new THREE.Color();
        this._tmpBounceSky = new THREE.Color();
        this._tmpBounceGround = new THREE.Color();

        this._initRenderer();
        this._initScene();

        this.world = new World(this.scene, data);
        this.player = new Player();
        this.scene.add(this.player.group);

        // Cached once: the island flight is gated on, looked up by company
        // rather than assumed to be any particular zone index.
        const flightZone = this.world.zones.find((z) => z.exp.company === FLIGHT_ISLAND_COMPANY);
        this.flightIslandCenter = flightZone ? flightZone.center : null;
        this.flyHeld = false; // jump/attack-button held while airborne, for flight climb

        // Start inside the university temple — the career begins at school.
        const spawn = this.world.spawnPoint;
        this.player.group.position.copy(spawn);

        this.ui = new UI(document.body);
        this.audio = new GameAudio();
        this.pendingPayloads = [];
        this.bullets = []; // live rifle rounds, see _fireBullet / _updateBullets
        this.ui.onClose = () => {
            this.audio.resume();
            // Show the next queued page, if an attack broke more than one crate.
            const next = this.pendingPayloads.shift();
            if (next) setTimeout(() => this.ui.openModal(this.ui.render(next)), 220);
        };
        this.ui.setCounts(0, this.world.totalCrates, 0, this.world.totalFruits);

        // Seed the camera at its resting offset behind the player; starting at
        // the origin would make it swoop across the map on the first frames.
        const p = this.player.position;
        this.cameraTarget = new THREE.Vector3(p.x, p.y + 2.2, p.z);
        this.cameraPos = new THREE.Vector3(p.x, p.y + 7.5, p.z - 13);
        // Reused each frame so the camera-occlusion test allocates nothing.
        this._raycaster = new THREE.Raycaster();
        this._rayDir = new THREE.Vector3();

        this._initInput();
        window.addEventListener('resize', () => this._onResize());
    }

    _initRenderer() {
        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        // Cap the pixel ratio: retina displays otherwise quadruple the fill cost.
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.getElementById('canvas-host').appendChild(this.renderer.domElement);
    }

    _initScene() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.Fog(0x9fd0e8, 60, 240);

        this.camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 1200);

        const ambient = new THREE.AmbientLight(0xbfd8ef, 0.75);
        this.scene.add(ambient);
        this.ambient = ambient;

        const sun = new THREE.DirectionalLight(0xfff0d0, 1.15);
        sun.position.set(30, 60, 20);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        // The shadow camera follows the player each frame; this is its extent.
        const s = 40;
        sun.shadow.camera.left = -s;
        sun.shadow.camera.right = s;
        sun.shadow.camera.top = s;
        sun.shadow.camera.bottom = -s;
        sun.shadow.camera.near = 1;
        sun.shadow.camera.far = 200;
        sun.shadow.bias = -0.0015;
        this.scene.add(sun);
        this.scene.add(sun.target);
        this.sun = sun;

        // Warm bounce light from below sells the tropical palette.
        const bounce = new THREE.HemisphereLight(0x88c0ff, 0xd9a05b, 0.45);
        this.scene.add(bounce);
        this.bounce = bounce;

        // Base ("day") values for everything the atmosphere system tweens,
        // captured once so _updateAtmosphere always has a known rest state
        // to blend back toward when the player leaves a themed island.
        this._atmosphereBase = {
            fogColor: this.scene.fog.color.clone(),
            fogNear: this.scene.fog.near,
            fogFar: this.scene.fog.far,
            ambientColor: ambient.color.clone(),
            ambientIntensity: ambient.intensity,
            sunColor: sun.color.clone(),
            sunIntensity: sun.intensity,
            bounceSky: bounce.color.clone(),
            bounceGround: bounce.groundColor.clone()
        };
    }

    _initInput() {
        this.keys = new Set();
        this.cameraYaw = 0;
        this.cameraYawTarget = 0;
        // Eased zoom multiplier on the chase camera's base distance/height —
        // 1 is the resting framing, <1 is zoomed in, >1 is zoomed out. See
        // _updateCamera for how this scales the offset, and ZOOM_MIN/MAX
        // below for the clamped range.
        this.cameraZoom = 1;
        this.cameraZoomTarget = 1;

        window.addEventListener('keydown', (e) => {
            // Let the browser keep its own shortcuts (reload, devtools, ...).
            if (e.metaKey || e.ctrlKey || e.altKey) return;

            if (e.code === 'Escape' && this.ui.isOpen) {
                this.ui.closeModal();
                return;
            }
            if (this.ui.isOpen) return;

            if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
                e.preventDefault();
            }
            this.keys.add(e.code);

            if (e.code === 'Space') this.player.jump(this.audio);
            if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyE') {
                this._triggerAttack();
            }
            if (e.code === 'KeyM') {
                const muted = this.audio.toggleMute();
                document.getElementById('mute-btn').textContent = muted ? '🔇' : '🔊';
            }
        });

        window.addEventListener('keyup', (e) => this.keys.delete(e.code));
        window.addEventListener('blur', () => this.keys.clear());

        // Camera orbit with the left/right arrow keys, zoom with up/down.
        window.addEventListener('keydown', (e) => {
            if (this.ui.isOpen) return;
            if (e.code === 'ArrowLeft') this.cameraYawTarget += Math.PI / 8;
            if (e.code === 'ArrowRight') this.cameraYawTarget -= Math.PI / 8;
            // Up = further away (zoom out), down = closer in (zoom in) —
            // matches "up" pushing the camera back like pulling away, not
            // literally moving the view upward.
            if (e.code === 'ArrowUp') {
                this.cameraZoomTarget = Math.min(ZOOM_MAX, this.cameraZoomTarget + ZOOM_STEP);
            }
            if (e.code === 'ArrowDown') {
                this.cameraZoomTarget = Math.max(ZOOM_MIN, this.cameraZoomTarget - ZOOM_STEP);
            }
        });

        document.getElementById('mute-btn').addEventListener('click', () => {
            const muted = this.audio.toggleMute();
            document.getElementById('mute-btn').textContent = muted ? '🔇' : '🔊';
        });

        this._initTouch();
    }

    _initTouch() {
        // Virtual stick for touch devices: a fixed circle anchored
        // bottom-left (see #stick's CSS) for the left thumb, matching a
        // console-style on-screen joystick rather than the old drag-anywhere
        // version. Any touch starting in the left half controls it — the
        // thumb doesn't have to land exactly inside the drawn circle, but
        // the knob itself always stays visually within it, clamped to its
        // radius, so the stick never looks like it's drifted off to wherever
        // the finger happened to land.
        const stick = document.getElementById('stick');
        const knob = document.getElementById('stick-knob');
        const KNOB_RADIUS = 36; // stick radius (60) minus half the knob (24)
        this.touchDir = { x: 0, z: 0 };
        let activeId = null;
        let origin = { x: 0, y: 0 };

        const host = document.getElementById('canvas-host');

        host.addEventListener('touchstart', (e) => {
            for (const t of e.changedTouches) {
                if (t.clientX < window.innerWidth / 2 && activeId === null) {
                    activeId = t.identifier;
                    origin = { x: t.clientX, y: t.clientY };
                    knob.classList.add('dragging');
                    stick.classList.add('active');
                }
            }
        }, { passive: true });

        host.addEventListener('touchmove', (e) => {
            for (const t of e.changedTouches) {
                if (t.identifier !== activeId) continue;
                const dx = t.clientX - origin.x;
                const dy = t.clientY - origin.y;
                const dist = Math.min(Math.hypot(dx, dy), 50);
                const angle = Math.atan2(dy, dx);
                const knobDist = Math.min(dist, KNOB_RADIUS);
                knob.style.transform =
                    `translate(${Math.cos(angle) * knobDist - 24}px, ${Math.sin(angle) * knobDist - 24}px)`;
                this.touchDir.x = Math.cos(angle) * (dist / 50);
                this.touchDir.z = Math.sin(angle) * (dist / 50);
            }
        }, { passive: true });

        const endTouch = (e) => {
            for (const t of e.changedTouches) {
                if (t.identifier !== activeId) continue;
                activeId = null;
                this.touchDir = { x: 0, z: 0 };
                knob.classList.remove('dragging');
                knob.style.transform = 'translate(-24px, -24px)';
                stick.classList.remove('active');
            }
        };
        host.addEventListener('touchend', endTouch, { passive: true });
        host.addEventListener('touchcancel', endTouch, { passive: true });

        this._initPinchZoom(host);

        // The jump button is also the flight throttle: tapping it jumps as
        // normal, but main.js reads `touchJumpHeld` every frame to climb
        // while flying, the touch equivalent of holding Space.
        this.touchJumpHeld = false;
        const jumpBtn = document.getElementById('btn-jump');
        jumpBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.touchJumpHeld = true;
            this.player.jump(this.audio);
        }, { passive: false });
        const releaseJump = () => { this.touchJumpHeld = false; };
        jumpBtn.addEventListener('touchend', releaseJump, { passive: true });
        jumpBtn.addEventListener('touchcancel', releaseJump, { passive: true });

        document.getElementById('btn-spin').addEventListener('click', () => this._triggerAttack());

        // Camera rotate buttons: a tap nudges by one step, a hold keeps
        // rotating smoothly for as long as the thumb stays down.
        const holdRotate = (btn, sign) => {
            let interval = null;
            const start = (e) => {
                e.preventDefault();
                this.cameraYawTarget += sign * (Math.PI / 8);
                interval = setInterval(() => {
                    this.cameraYawTarget += sign * (Math.PI / 8);
                }, 180);
            };
            const stop = () => { clearInterval(interval); interval = null; };
            btn.addEventListener('touchstart', start, { passive: false });
            btn.addEventListener('touchend', stop, { passive: true });
            btn.addEventListener('touchcancel', stop, { passive: true });
        };
        holdRotate(document.getElementById('btn-cam-left'), 1);
        holdRotate(document.getElementById('btn-cam-right'), -1);
    }

    // Pinch-to-zoom: the standard mobile gesture for "get closer / pull
    // back", so it needs no dedicated on-screen button the way jump/attack
    // do — two fingers anywhere on the canvas, spread apart to zoom in,
    // pinch together to zoom out. Shown once via #pinch-hint the first time
    // a second finger joins a touch already in progress, then never again
    // (a flag in localStorage, since it's a one-time "here's how" cue rather
    // than state the game itself needs to remember).
    _initPinchZoom(host) {
        let pinchStartDist = null;
        let pinchStartZoom = 1;
        const hint = document.getElementById('pinch-hint');
        const HINT_KEY = 'resumeIslandPinchHintShown';

        const touchDist = (touches) => {
            const [a, b] = touches;
            return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        };

        host.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 2) return;
            pinchStartDist = touchDist(e.touches);
            pinchStartZoom = this.cameraZoomTarget;

            if (!localStorage.getItem(HINT_KEY)) {
                hint.classList.add('visible');
                localStorage.setItem(HINT_KEY, '1');
                setTimeout(() => hint.classList.remove('visible'), 2200);
            }
        }, { passive: true });

        host.addEventListener('touchmove', (e) => {
            if (e.touches.length !== 2 || pinchStartDist === null) return;
            // Fingers spreading apart (ratio > 1) zooms in — smaller camera
            // distance — matching the "pull the view closer" gesture used
            // everywhere else (maps, photos); pinching together zooms out.
            const ratio = touchDist(e.touches) / pinchStartDist;
            this.cameraZoomTarget = THREE.MathUtils.clamp(pinchStartZoom / ratio, ZOOM_MIN, ZOOM_MAX);
        }, { passive: true });

        const endPinch = (e) => {
            if (e.touches.length < 2) pinchStartDist = null;
        };
        host.addEventListener('touchend', endPinch, { passive: true });
        host.addEventListener('touchcancel', endPinch, { passive: true });
    }

    _onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    _readInput() {
        if (this.ui.isOpen) return { x: 0, z: 0 };

        let x = 0;
        let z = 0;
        if (this.keys.has('KeyW')) z += 1;
        if (this.keys.has('KeyS')) z -= 1;
        if (this.keys.has('KeyA')) x -= 1;
        if (this.keys.has('KeyD')) x += 1;

        x += this.touchDir.x;
        z -= this.touchDir.z;

        const len = Math.hypot(x, z);
        if (len > 1) { x /= len; z /= len; }

        // Rotate the input into camera space so "forward" is always up-screen.
        // The camera sits at (-sin(yaw), -cos(yaw)) * distance and looks back at
        // the player, so screen-forward is world (sin(yaw), cos(yaw)). Looking
        // along that axis, screen-right is (-cos(yaw), sin(yaw)) — verified by
        // projecting a world-space offset and checking which way it moves.
        const cos = Math.cos(this.cameraYaw);
        const sin = Math.sin(this.cameraYaw);
        return {
            x: z * sin - x * cos,
            z: z * cos + x * sin
        };
    }

    // Wraps player.startAttack so a shot fired with the army costume spawns
    // a real bullet at the moment it's fired, rather than the proximity
    // check every other style gets every frame in _updateInteractions — the
    // rifle throws a round downrange, not itself.
    _triggerAttack() {
        if (!this.player.startAttack(this.audio)) return;
        if (this.player._attackStyle === 'gun') this._fireBullet();
    }

    // Spawns a small travelling round at the rifle's muzzle, aimed along the
    // player's facing. _updateBullets moves it forward every frame and culls
    // it on the first hit or once it's travelled BULLET_RANGE.
    _fireBullet() {
        if (!this._bulletGeo) {
            this._bulletGeo = new THREE.CapsuleGeometry(0.035, 0.14, 4, 6);
            this._bulletMat = new THREE.MeshBasicMaterial({ color: 0xfff3c4 });
        }
        const mesh = new THREE.Mesh(this._bulletGeo, this._bulletMat);

        // Spawn centred on the player's own facing line, not the rifle's
        // true (visually offset-to-the-side) muzzle transform — a bullet
        // that starts from the actual muzzle travels parallel to, but never
        // converging on, the centreline the player is aiming down, so it
        // quietly missed anything directly ahead at any range. Chest-height
        // and a step ahead of the player reads the same as "coming from the
        // gun" without inheriting that offset.
        const dir = new THREE.Vector3(Math.sin(this.player.facing), 0, Math.cos(this.player.facing));
        const origin = this.player.position.clone()
            .addScaledVector(dir, 0.6)
            .setY(this.player.position.y + 1.3);
        mesh.position.copy(origin);
        // Capsules are authored along Y; rotate so the bullet's length lies
        // along its direction of travel instead of standing straight up.
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        this.scene.add(mesh);

        this.bullets.push({ mesh, dir, travelled: 0 });
    }

    // Advances every live bullet, checking crates/NPCs along the way — same
    // breakage/scoring path a melee hit uses, just triggered by the bullet's
    // current position each frame instead of the player's.
    _updateBullets(dt) {
        const SPEED = 34;
        const RANGE = 26;
        const HIT_RADIUS = 0.55;

        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i];
            b.mesh.position.addScaledVector(b.dir, SPEED * dt);
            b.travelled += SPEED * dt;

            const hit = this._bulletHitTest(b.mesh.position, HIT_RADIUS);
            if (hit) {
                this._breakTarget(hit);
                this.scene.remove(b.mesh);
                this.bullets.splice(i, 1);
                continue;
            }
            if (b.travelled > RANGE) {
                this.scene.remove(b.mesh);
                this.bullets.splice(i, 1);
            }
        }
    }

    // Nearest unbroken crate or NPC within HIT_RADIUS of a bullet's current
    // position, or null. 2D distance (matches every other hit test in this
    // file), so a shot can't dodge by height alone.
    _bulletHitTest(pos, radius) {
        let best = null;
        let bestDist = Infinity;
        const consider = (target, x, z) => {
            const dist = Math.hypot(x - pos.x, z - pos.z);
            if (dist > radius || dist >= bestDist) return;
            bestDist = dist;
            best = target;
        };
        for (const crate of this.world.crates) {
            if (crate.broken) continue;
            consider(crate, crate.position.x, crate.position.z);
        }
        for (const npc of this.world.npcs) {
            if (npc.broken) continue;
            consider(npc, npc.position.x, npc.position.z);
        }
        return best;
    }

    // Shared "break whatever the shot hit" path — a Crate goes through its
    // normal break/score/payload flow, an NPC just gets flagged broken (its
    // own collapse animation picks up from there, see World._updateNPCs).
    _breakTarget(target) {
        if (target instanceof Crate) {
            target.break(this.scene);
            this.cratesBroken++;
            this.audio.crateBreak();
            this.ui.setCounts(
                this.cratesBroken, this.world.totalCrates,
                this.fruitsCollected, this.world.totalFruits
            );
            if (target.payload) {
                if (this.ui.isOpen) this.pendingPayloads.push(target.payload);
                else this.ui.openModal(this.ui.render(target.payload));
            }
        } else {
            target.broken = true;
            this.audio.crateBreak();
        }
    }

    _updateInteractions() {
        const pos = this.player.position;

        for (const crate of this.world.crates) {
            if (crate.broken) continue;
            if (!crate.intersectsPlayer(pos, this.player.radius)) continue;

            // Melee styles only land during isHitting's short window around
            // the swing/punch's peak (gun is handled separately — a real
            // bullet travels out from _fireBullet and is checked against
            // targets every frame in _updateBullets, not here).
            const attacking = this.player.isHitting && this.player._attackStyle !== 'gun';
            // Falling onto a crate breaks it too — the classic bonk.
            const stomping = this.player.velocity.y < -1 &&
                pos.y > crate.position.y;

            if (crate.spinOnly && !attacking) {
                // Metal crates shrug off a walk-into; nudge the player back.
                const push = new THREE.Vector3().subVectors(pos, crate.position).setY(0);
                if (push.lengthSq() > 0) {
                    push.normalize().multiplyScalar(0.15);
                    pos.add(push);
                }
                continue;
            }

            if (!attacking && !stomping) continue;

            crate.break(this.scene);
            this.cratesBroken++;
            this.audio.crateBreak();
            this.ui.setCounts(
                this.cratesBroken, this.world.totalCrates,
                this.fruitsCollected, this.world.totalFruits
            );

            if (stomping) this.player.velocity.y = 9; // little bounce off the crate

            // Breaking several crates in one attack must not clobber the page the
            // player is reading; queue the extras and show them on close.
            if (crate.payload) {
                if (this.ui.isOpen) this.pendingPayloads.push(crate.payload);
                else this.ui.openModal(this.ui.render(crate.payload));
            }
        }

        for (const fruit of this.world.fruits) {
            if (fruit.intersectsPlayer(pos)) {
                fruit.collect(this.scene);
                this.fruitsCollected++;
                this.audio.pickup(this.fruitsCollected);
                this.ui.toast(`⚡ ${fruit.label}`);
                this.ui.setCounts(
                    this.cratesBroken, this.world.totalCrates,
                    this.fruitsCollected, this.world.totalFruits
                );
            }
        }

        // Destructible set-dressing figures (the cat, the giant, the graduates)
        // — a fun aside broken the same way as a crate, but with no payload or
        // completion counter attached.
        if (this.player.isHitting && this.player._attackStyle !== 'gun') {
            for (const npc of this.world.npcs) {
                if (npc.broken) continue;
                const dx = pos.x - npc.position.x;
                const dz = pos.z - npc.position.z;
                if ((dx * dx + dz * dz) > (npc.radius + this.player.radius) ** 2) continue;
                npc.broken = true;
                this.audio.crateBreak();
            }
        }

        if (!this.finished &&
            this.cratesBroken === this.world.totalCrates &&
            this.fruitsCollected === this.world.totalFruits) {
            this.finished = true;
            this.audio.fanfare();
            this.ui.toast('🏆 100% — every crate smashed!');
            // Crossfade to the outro under the fanfare/toast beat, so the
            // island track has already handed off by the time the victory
            // screen itself appears.
            this._setTrack(OUTRO_TRACK);
            setTimeout(() => this.ui.showVictory(), 1400);
        }
    }

    _updateZoneLabel() {
        // Once the game is won the outro owns the soundtrack; the player is
        // still standing in whatever zone they finished in, and this runs
        // every frame, so without this guard it would immediately crossfade
        // straight back to that island's track and undo _setTrack(OUTRO_TRACK).
        if (this.finished) return;

        // The title screen owns the soundtrack for as long as it's up, and
        // for a short beat after — long enough that clicking "Enter Island"
        // doesn't cut the theme off before the crossfade even begins.
        if (this.titleScreenActive || this.elapsed < this._themeHoldUntil) return;

        // Full 2D distance: the island chain curves, so comparing z alone
        // mislabels the zone whenever the player is off the centre line.
        const p = this.player.position;
        let nearest = null;
        let bestDist = Infinity;
        for (const zone of this.world.zones) {
            const d = Math.hypot(zone.center.x - p.x, zone.center.z - p.z);
            if (d < bestDist) { bestDist = d; nearest = zone; }
        }

        // The education island opens the chain, so it competes for the label
        // on the same footing as the work zones.
        const edu = this.world.eduCenter;
        if (edu && Math.hypot(edu.x - p.x, edu.z - p.z) < bestDist) {
            const school = this.data.education[0];
            this.ui.setZone(school ? `🎓 ${school.school}` : '🎓 Education');
            this._setStage('toga', '🎓 Cap on — student days.');
            this._setTrack(EDU_TRACK);
            this._nightTarget = 0;
            this._chillTarget = 0;
        } else if (nearest) {
            this.ui.setZone(`${nearest.exp.company} · ${nearest.exp.title}`);
            this._setStage(STAGE_BY_ZONE[nearest.index] ?? 'plain',
                STAGE_TOAST[STAGE_BY_ZONE[nearest.index]]);
            this._setTrack(ZONE_TRACK[nearest.index] ?? null);
            // European Dynamics (index 2) turns to night; the second
            // Upstream stint (index 6) turns chilly and snows. Targets, not
            // instant switches — _updateAtmosphere eases toward them every
            // frame so crossing an island boundary fades rather than cuts.
            this._nightTarget = nearest.index === 2 ? 1 : 0;
            this._chillTarget = nearest.index === 6 ? 1 : 0;
        }
    }

    // Crossfades the island soundtrack and the sky's song-title label
    // together. `track` is `{ url, name }` or null for an island with no
    // theme of its own (Intracom Telecom) — silence and no label, same idea
    // as _setStage falling back to 'plain'.
    _setTrack(track) {
        this.audio.playTrack(track ? track.url : null);
        this.ui.setSongTitle(track ? track.name : null);
    }

    // Called once, from the "Play with Music" click that also unlocks audio.
    // The main theme then owns the soundtrack for as long as the title
    // screen is up — see titleScreenActive and releaseTitleScreen().
    playMainTheme() {
        this.titleScreenActive = true;
        this._setTrack(MAIN_THEME);
    }

    // Called from the "Enter Island" click. Lets the main theme finish
    // handing off to the university island's own track — held a few seconds
    // longer so the crossfade doesn't begin the instant the title screen
    // starts fading out.
    releaseTitleScreen() {
        this.titleScreenActive = false;
        this._themeHoldUntil = this.elapsed + 3;
    }

    // The character's costume tracks the island they are standing on, so the
    // career reads as a visible transformation. Announced once per change.
    _setStage(stage, toast) {
        if (this.player.costume === stage) return;
        this.player.setCostume(stage);
        if (toast) this.ui.toast(toast);
    }

    // Eases the scene's lighting/fog toward whichever atmosphere the current
    // island calls for (night at European Dynamics, chilly/snowing at the
    // second Upstream) and back to the base daytime values otherwise. Reused
    // temp colors avoid allocating three THREE.Color objects every frame.
    _updateAtmosphere(dt) {
        const base = this._atmosphereBase;
        this._nightAmount = THREE.MathUtils.damp(this._nightAmount, this._nightTarget, 2.2, dt);
        this._chillAmount = THREE.MathUtils.damp(this._chillAmount, this._chillTarget, 2.2, dt);
        const night = this._nightAmount;
        const chill = this._chillAmount;

        // Night: fog goes low and dark blue, the sun cools and dims hard (a
        // moon-like remnant rather than full dark, so the player can still
        // see), ambient/bounce dim, and the ship's lanterns light up.
        // Chill: fog goes pale and close-in (like haze/light snow reducing
        // visibility), the sun goes cool and slightly dimmer, ambient goes
        // flat and cool. The two never overlap in practice (different
        // islands) but are additive here rather than exclusive so nothing
        // has to special-case "which one wins".
        this._tmpFog.copy(base.fogColor)
            .lerp(NIGHT_FOG, night)
            .lerp(CHILL_FOG, chill);
        this.scene.fog.color.copy(this._tmpFog);
        this.scene.fog.near = THREE.MathUtils.lerp(
            THREE.MathUtils.lerp(base.fogNear, NIGHT_FOG_NEAR, night), CHILL_FOG_NEAR, chill
        );
        this.scene.fog.far = THREE.MathUtils.lerp(
            THREE.MathUtils.lerp(base.fogFar, NIGHT_FOG_FAR, night), CHILL_FOG_FAR, chill
        );

        this._tmpAmbient.copy(base.ambientColor).lerp(NIGHT_AMBIENT, night).lerp(CHILL_AMBIENT, chill);
        this.ambient.color.copy(this._tmpAmbient);
        this.ambient.intensity = THREE.MathUtils.lerp(
            THREE.MathUtils.lerp(base.ambientIntensity, NIGHT_AMBIENT_I, night), CHILL_AMBIENT_I, chill
        );

        this._tmpSun.copy(base.sunColor).lerp(NIGHT_SUN, night).lerp(CHILL_SUN, chill);
        this.sun.color.copy(this._tmpSun);
        this.sun.intensity = THREE.MathUtils.lerp(
            THREE.MathUtils.lerp(base.sunIntensity, NIGHT_SUN_I, night), CHILL_SUN_I, chill
        );

        this._tmpBounceSky.copy(base.bounceSky).lerp(NIGHT_BOUNCE_SKY, night).lerp(CHILL_BOUNCE_SKY, chill);
        this.bounce.color.copy(this._tmpBounceSky);
        this._tmpBounceGround.copy(base.bounceGround).lerp(NIGHT_BOUNCE_GROUND, night);
        this.bounce.groundColor.copy(this._tmpBounceGround);

        for (const lamp of this.world.nightLamps ?? []) {
            lamp.light.intensity = night * 2.4;
            lamp.glass.color.setHex(night > 0.05 ? 0xffcf7a : 0x2a2010);
        }

        if (this.world.moonBody) {
            this.world.moonBody.material.opacity = night * 0.95;
            this.world.moonHalo.material.opacity = night * 0.18;
        }

        this.world.setSnow?.(chill);
    }

    _updateCamera(dt) {
        this.cameraYaw += (this.cameraYawTarget - this.cameraYaw) * Math.min(1, dt * 6);
        this.cameraZoom += (this.cameraZoomTarget - this.cameraZoom) * Math.min(1, dt * 6);

        // Chase camera trailing behind and above the player. Inside the opening
        // temple the camera tucks in close and steep, so it stays within the
        // colonnade instead of being pushed out through the marble.
        const b = this.world.interiorBounds;
        const p = this.player.position;
        const indoor = !!b &&
            p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ;
        // Zoom scales both — distance alone would leave a zoomed-out camera
        // oddly low, and height alone would leave it hovering in place.
        const distance = (indoor ? 7 : 13) * this.cameraZoom;
        const height = (indoor ? 5.5 : 7.5) * this.cameraZoom;
        const offset = new THREE.Vector3(
            Math.sin(this.cameraYaw + Math.PI) * distance,
            height,
            Math.cos(this.cameraYaw + Math.PI) * distance
        );

        // Pull the camera in when scenery (a palm, a totem) sits between it and
        // the player, so the view never ends up buried inside a tree.
        const focus = new THREE.Vector3(
            this.player.position.x,
            this.player.position.y + 2.0,
            this.player.position.z
        );
        const dir = offset.clone().normalize();
        this._rayDir.copy(dir);
        this._raycaster.set(focus, this._rayDir);
        this._raycaster.far = distance;

        const hits = this._raycaster.intersectObjects(this.world.occluders, true);
        // Stop short of whatever blocks the view. The floor of 2.2 keeps the
        // near plane off the character rather than preserving a nice framing —
        // being close is fine, being inside a tree trunk is not.
        let allowed = distance;
        if (hits.length) allowed = Math.max(2.2, hits[0].distance - 0.6);

        const desired = focus.clone().addScaledVector(dir, allowed);
        // Snap inward instantly (a blocked view is jarring), ease back out.
        const towards = desired.distanceTo(this.cameraPos) > 0 &&
            desired.distanceTo(focus) < this.cameraPos.distanceTo(focus);
        this.cameraPos.lerp(desired, Math.min(1, dt * (towards ? 18 : 4.5)));
        // Never let the camera dip below the waterline.
        this.cameraPos.y = Math.max(this.cameraPos.y, this.player.position.y + 3);
        this.camera.position.copy(this.cameraPos);

        this.cameraTarget.lerp(
            new THREE.Vector3(this.player.position.x, this.player.position.y + 2.2, this.player.position.z),
            Math.min(1, dt * 6)
        );
        this.camera.lookAt(this.cameraTarget);

        // Keep the shadow frustum centred on the player so shadows stay crisp
        // across the whole island chain.
        this.sun.position.set(
            this.player.position.x + 30,
            this.player.position.y + 60,
            this.player.position.z + 20
        );
        this.sun.target.position.copy(this.player.position);
        this.sun.target.updateMatrixWorld();
    }

    _respawnIfDrowned() {
        if (this.player.position.y > -8) return;
        // Fell in the water: drop back onto the nearest island.
        let nearest = this.world.eduCenter || this.world.zones[0].center;
        let best = Infinity;
        const all = [...this.world.zones.map((z) => z.center), this.world.eduCenter].filter(Boolean);
        for (const c of all) {
            const d = c.distanceToSquared(this.player.position);
            if (d < best) { best = d; nearest = c; }
        }
        this.player.group.position.set(nearest.x, 2, nearest.z);
        this.player.velocity.set(0, 0, 0);
        this.player.stopFlying();
        this.ui.toast('💦 Splash! Back on dry land.');
    }

    // True while the player is horizontally within landing range of the
    // Cortical.io island — the only place flight may launch from or return to.
    _overFlightIsland() {
        if (!this.flightIslandCenter) return false;
        const p = this.player.position;
        const dx = p.x - this.flightIslandCenter.x;
        const dz = p.z - this.flightIslandCenter.z;
        return (dx * dx + dz * dz) < FLIGHT_LANDING_RADIUS * FLIGHT_LANDING_RADIUS;
    }

    // Jump/climb held this frame, from keyboard or the touch jump button —
    // the shared "hold to fly" input read by _updateFlight.
    _jumpHeld() {
        return this.keys.has('Space') || this.touchJumpHeld;
    }

    _updateFlight() {
        if (this.ui.isOpen) return;

        if (!this.player.isFlying) {
            // Flight only ever launches while airborne above Vienna, and only
            // while the player keeps holding jump past the initial hop — a
            // quick tap stays a normal jump.
            if (!this.player.onGround && this._jumpHeld() && this._overFlightIsland()) {
                this.player.startFlying(this.audio);
            }
            return;
        }

        // Already flying: the player can land on any island (or the ground
        // beneath them generally), not just the one flight launched from —
        // groundHeightAt covers all islands, the same lookup normal
        // non-flying ground contact uses.
        const ground = this.world.groundHeightAt(this.player.position.x, this.player.position.z);
        if (ground !== null && this.player.position.y <= ground + 0.5) {
            this.player.stopFlying();
        }
    }

    start() {
        const loop = () => {
            requestAnimationFrame(loop);
            // Clamp dt so a background tab does not teleport the player on return.
            const dt = Math.min(this.clock.getDelta(), 0.05);
            this.elapsed += dt;

            this._updateFlight();
            const flightInput = this.player.isFlying
                ? { holdingUp: this._jumpHeld(), holdingDown: this.keys.has('KeyS') }
                : null;
            this.player.update(dt, this._readInput(), flightInput);
            this.world.resolveCollisions(this.player.position, this.player.radius);

            if (this.player.isFlying) {
                // Flying: ground contact is decided by _updateFlight (Vienna
                // only), so the generic snap-to-ground below is skipped
                // entirely — otherwise every island underneath would catch
                // the player like a normal platform.
                this.player.onGround = false;
            } else {
                const ground = this.world.groundHeightAt(this.player.position.x, this.player.position.z);
                if (ground !== null) this.player.land(ground);
                else this.player.onGround = false;
            }

            this._respawnIfDrowned();
            this._updateInteractions();
            this._updateBullets(dt);
            this._updateZoneLabel();
            this._updateAtmosphere(dt);
            this.world.update(dt, this.elapsed);
            this._updateCamera(dt);

            this.renderer.render(this.scene, this.camera);
        };
        loop();
    }
}

// ---- mobile fullscreen / orientation ---------------------------------------

// Touch devices get the full immersive treatment on "Enter Island": go
// fullscreen (hides the browser chrome/URL bar) and lock to landscape, since
// the game's camera and touch controls are laid out for a wide viewport.
// Both APIs require a direct user gesture, so this must run synchronously
// inside the click handler — not after an await.
function enterFullscreenOnMobile() {
    const isTouch = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    if (!isTouch) return;

    const el = document.documentElement;
    const request = el.requestFullscreen || el.webkitRequestFullscreen;
    const result = request ? request.call(el) : Promise.resolve();

    Promise.resolve(result)
        .then(() => {
            if (screen.orientation && screen.orientation.lock) {
                return screen.orientation.lock('landscape').catch(() => {});
            }
        })
        .catch(() => {
            // Fullscreen can be denied (e.g. iOS Safari has no Fullscreen API);
            // the #rotate-hint overlay covers that case via CSS instead.
        });
}

// ---- boot ------------------------------------------------------------------

async function boot() {
    const loading = document.getElementById('loading');
    let data;
    try {
        const res = await fetch(DATA_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
    } catch (err) {
        loading.innerHTML =
            `<div class="load-inner"><h1>Could not load data.json</h1>
       <p>${err.message}</p>
       <p class="hint">Serve the folder over HTTP — <code>node scripts/serve.js</code> — since
       browsers block <code>fetch</code> on <code>file://</code>.</p></div>`;
        return;
    }

    const game = new Game(data);
    game.start();

    // Exposed for debugging in the console (inspect the scene, teleport, etc.).
    window.game = game;

    // Two-step title screen: the sound choice fires immediately (it's the
    // one user gesture browsers require before any audio can play, so the
    // main theme has to start right on this click, not later), then "Enter
    // Island" replaces it as the actual commit to start playing.
    const soundActions = document.getElementById('sound-actions');
    const enterActions = document.getElementById('enter-actions');
    const chooseSound = (wantsMusic) => {
        if (wantsMusic) {
            game.playMainTheme();
            game.audio.start();
        }
        soundActions.hidden = true;
        enterActions.hidden = false;
    };
    document.getElementById('sound-music').addEventListener('click', () => chooseSound(true));
    document.getElementById('sound-muted').addEventListener('click', () => chooseSound(false));

    document.getElementById('enter-btn').addEventListener('click', () => {
        enterFullscreenOnMobile();
        game.releaseTitleScreen();
        loading.classList.add('hidden');
    });

    loading.querySelector('.load-inner').classList.add('ready');
    document.getElementById('load-status').textContent =
        `${game.world.totalCrates} crates · ${game.world.totalFruits} skills to collect`;
}

boot();
