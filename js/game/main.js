// Entry point: boots the renderer, builds the world from data.json and runs
// the game loop (input → physics → interactions → camera → render).

import * as THREE from '../vendor/three.module.js';
import { World } from './world.js';
import { Player } from './player.js';
import { UI } from './ui.js';
import { GameAudio } from './audio.js';

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
    1: 'plain',      // army duties
    2: 'chains',     // European Dynamics
    3: 'hero',       // Upstream — sword in hand
    4: 'caped',      // Cortical.io — grown, and a cape
    5: 'fourArms',   // Camunda — same size, four arms
    6: 'leader'      // Upstream again — the same, now with a team to shield
};

const STAGE_TOAST = {
    plain: '👕 Cap off — first day on the job.',
    chains: '⛓️ Chained to the process.',
    hero: '🗡️ A sword, and the strength to swing it.',
    caped: '🦸 Grown into the cape.',
    fourArms: '🖐️ Four arms — twice the throughput.',
    leader: '🛡️ Four to lead, and to shield.'
};

class Game {
    constructor(data) {
        this.data = data;
        this.clock = new THREE.Clock();
        this.elapsed = 0;
        this.cratesBroken = 0;
        this.fruitsCollected = 0;
        this.finished = false;

        this._initRenderer();
        this._initScene();

        this.world = new World(this.scene, data);
        this.player = new Player();
        this.scene.add(this.player.group);

        // Start inside the university temple — the career begins at school.
        const spawn = this.world.spawnPoint;
        this.player.group.position.copy(spawn);

        this.ui = new UI(document.body);
        this.audio = new GameAudio();
        this.pendingPayloads = [];
        this.ui.onClose = () => {
            this.audio.resume();
            // Show the next queued page, if a spin broke more than one crate.
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
    }

    _initInput() {
        this.keys = new Set();
        this.cameraYaw = 0;
        this.cameraYawTarget = 0;

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
                this.player.startSpin(this.audio);
            }
            if (e.code === 'KeyM') {
                const muted = this.audio.toggleMute();
                document.getElementById('mute-btn').textContent = muted ? '🔇' : '🔊';
            }
        });

        window.addEventListener('keyup', (e) => this.keys.delete(e.code));
        window.addEventListener('blur', () => this.keys.clear());

        // Camera orbit with Q/E-style bracket keys, kept simple.
        window.addEventListener('keydown', (e) => {
            if (this.ui.isOpen) return;
            if (e.code === 'KeyQ') this.cameraYawTarget += Math.PI / 8;
            if (e.code === 'KeyR') this.cameraYawTarget -= Math.PI / 8;
        });

        document.getElementById('mute-btn').addEventListener('click', () => {
            const muted = this.audio.toggleMute();
            document.getElementById('mute-btn').textContent = muted ? '🔇' : '🔊';
        });

        this._initTouch();
    }

    _initTouch() {
        // Virtual stick for touch devices: drag anywhere on the left half.
        const stick = document.getElementById('stick');
        const knob = document.getElementById('stick-knob');
        this.touchDir = { x: 0, z: 0 };
        let activeId = null;
        let origin = { x: 0, y: 0 };

        const host = document.getElementById('canvas-host');

        host.addEventListener('touchstart', (e) => {
            for (const t of e.changedTouches) {
                if (t.clientX < window.innerWidth / 2 && activeId === null) {
                    activeId = t.identifier;
                    origin = { x: t.clientX, y: t.clientY };
                    stick.style.left = `${t.clientX}px`;
                    stick.style.top = `${t.clientY}px`;
                    stick.classList.add('visible');
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
                knob.style.transform =
                    `translate(${Math.cos(angle) * dist - 22}px, ${Math.sin(angle) * dist - 22}px)`;
                this.touchDir.x = Math.cos(angle) * (dist / 50);
                this.touchDir.z = Math.sin(angle) * (dist / 50);
            }
        }, { passive: true });

        const endTouch = (e) => {
            for (const t of e.changedTouches) {
                if (t.identifier !== activeId) continue;
                activeId = null;
                this.touchDir = { x: 0, z: 0 };
                knob.style.transform = 'translate(-22px, -22px)';
                stick.classList.remove('visible');
            }
        };
        host.addEventListener('touchend', endTouch, { passive: true });
        host.addEventListener('touchcancel', endTouch, { passive: true });

        document.getElementById('btn-jump').addEventListener('click', () => this.player.jump(this.audio));
        document.getElementById('btn-spin').addEventListener('click', () => this.player.startSpin(this.audio));
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
        if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) z += 1;
        if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) z -= 1;
        if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
        if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;

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

    _updateInteractions() {
        const pos = this.player.position;

        for (const crate of this.world.crates) {
            if (crate.broken) continue;
            if (!crate.intersectsPlayer(pos, this.player.radius)) continue;

            const spinning = this.player.isSpinning;
            // Falling onto a crate breaks it too — the classic bonk.
            const stomping = this.player.velocity.y < -1 &&
                pos.y > crate.position.y;

            if (crate.spinOnly && !spinning) {
                // Metal crates shrug off a walk-into; nudge the player back.
                const push = new THREE.Vector3().subVectors(pos, crate.position).setY(0);
                if (push.lengthSq() > 0) {
                    push.normalize().multiplyScalar(0.15);
                    pos.add(push);
                }
                continue;
            }

            if (!spinning && !stomping) continue;

            crate.break(this.scene);
            this.cratesBroken++;
            this.audio.crateBreak();
            this.ui.setCounts(
                this.cratesBroken, this.world.totalCrates,
                this.fruitsCollected, this.world.totalFruits
            );

            if (stomping) this.player.velocity.y = 9; // little bounce off the crate

            // Breaking several crates in one spin must not clobber the page the
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

        if (!this.finished &&
            this.cratesBroken === this.world.totalCrates &&
            this.fruitsCollected === this.world.totalFruits) {
            this.finished = true;
            this.audio.fanfare();
            this.ui.toast('🏆 100% — every crate smashed!');
        }
    }

    _updateZoneLabel() {
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
        } else if (nearest) {
            this.ui.setZone(`${nearest.exp.company} · ${nearest.exp.title}`);
            this._setStage(STAGE_BY_ZONE[nearest.index] ?? 'plain',
                STAGE_TOAST[STAGE_BY_ZONE[nearest.index]]);
        }
    }

    // The character's costume tracks the island they are standing on, so the
    // career reads as a visible transformation. Announced once per change.
    _setStage(stage, toast) {
        if (this.player.costume === stage) return;
        this.player.setCostume(stage);
        if (toast) this.ui.toast(toast);
    }

    _updateCamera(dt) {
        this.cameraYaw += (this.cameraYawTarget - this.cameraYaw) * Math.min(1, dt * 6);

        // Chase camera trailing behind and above the player. Inside the opening
        // temple the camera tucks in close and steep, so it stays within the
        // colonnade instead of being pushed out through the marble.
        const b = this.world.interiorBounds;
        const p = this.player.position;
        const indoor = !!b &&
            p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ;
        const distance = indoor ? 7 : 13;
        const height = indoor ? 5.5 : 7.5;
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
        this.ui.toast('💦 Splash! Back on dry land.');
    }

    start() {
        const loop = () => {
            requestAnimationFrame(loop);
            // Clamp dt so a background tab does not teleport the player on return.
            const dt = Math.min(this.clock.getDelta(), 0.05);
            this.elapsed += dt;

            this.player.update(dt, this._readInput());
            this.world.resolveCollisions(this.player.position, this.player.radius);

            const ground = this.world.groundHeightAt(this.player.position.x, this.player.position.z);
            if (ground !== null) this.player.land(ground);
            else this.player.onGround = false;

            this._respawnIfDrowned();
            this._updateInteractions();
            this._updateZoneLabel();
            this.world.update(dt, this.elapsed);
            this._updateCamera(dt);

            this.renderer.render(this.scene, this.camera);
        };
        loop();
    }
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

    // Wait for a gesture before starting audio (browser autoplay policy).
    const startBtn = document.getElementById('start-btn');
    startBtn.addEventListener('click', () => {
        game.audio.start();
        loading.classList.add('hidden');
    });
    document.getElementById('start-silent').addEventListener('click', () => {
        loading.classList.add('hidden');
    });

    loading.querySelector('.load-inner').classList.add('ready');
    document.getElementById('load-status').textContent =
        `${game.world.totalCrates} crates · ${game.world.totalFruits} skills to collect`;
}

boot();
