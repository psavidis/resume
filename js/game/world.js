// Builds the island world out of the resume data.
//
// Layout: each work experience becomes a circular "island" zone, laid out along
// a gently curving path in chronological order (oldest first, so walking
// forward walks forward through the career). Bridges connect the zones.
// Within a zone: a totem sign naming the role, crates carrying the projects
// done there, and fruit for the technologies used.

import * as THREE from '../vendor/three.module.js';
import { Crate, Fruit } from './crate.js';

const ZONE_RADIUS = 15;
const ZONE_SPACING = 42;

// Per-company palette so zones are visually distinct and memorable.
const ZONE_THEMES = [
    { ground: 0x4a9d4f, accent: 0x2d6b32, rock: 0x8b7355 }, // jungle
    { ground: 0xd9b26a, accent: 0xb5883f, rock: 0xa0845c }, // beach
    { ground: 0x5a8fa8, accent: 0x3d6b80, rock: 0x6b8494 }, // coastal
    { ground: 0x7a9d4f, accent: 0x54702f, rock: 0x8b7355 }, // grassland
    { ground: 0xa87c5a, accent: 0x7d5a3f, rock: 0x9c8069 }, // canyon
    { ground: 0x6b5a8f, accent: 0x483d63, rock: 0x7d7093 }, // dusk
    { ground: 0x4f9d8a, accent: 0x2f6b5c, rock: 0x749186 }  // lagoon
];

// `worldWidth` is how wide the finished sign should be in world units; the
// sprite's height follows from the canvas aspect so text never distorts.
function makeLabelSprite(text, {
    fontSize = 44, color = '#ffffff', bg = 'rgba(20,12,8,0.82)',
    maxWidth = 520, worldWidth = 5
} = {}) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`;

    ctx.font = font;
    const lines = [];
    let line = '';
    for (const word of text.split(' ')) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > maxWidth && line) {
            lines.push(line);
            line = word;
        } else {
            line = test;
        }
    }
    if (line) lines.push(line);

    const pad = 24;
    const lineHeight = fontSize * 1.25;
    const width = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
    canvas.width = Math.ceil(width);
    canvas.height = Math.ceil(lines.length * lineHeight + pad * 2);

    // Re-set the font: resizing the canvas resets the 2D context state.
    ctx.font = font;
    ctx.fillStyle = bg;
    ctx.strokeStyle = 'rgba(255,220,150,0.9)';
    ctx.lineWidth = 5;
    const r = 18;
    ctx.beginPath();
    ctx.roundRect(3, 3, canvas.width - 6, canvas.height - 6, r);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => {
        ctx.fillText(l, canvas.width / 2, pad + lineHeight * (i + 0.5));
    });

    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true }));
    sprite.scale.set(worldWidth, worldWidth * (canvas.height / canvas.width), 1);
    return sprite;
}

// Paints a two-line wooden sign face. Unlike a sprite this is a real texture on
// real geometry, so it stays welded to the board at any angle and takes light.
function makeSignTexture(titleText, subtitleText) {
    const W = 768;
    const H = 288;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Wood base with grain
    ctx.fillStyle = '#a5713c';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(90, 55, 20, 0.35)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 9; i++) {
        ctx.beginPath();
        ctx.moveTo(0, 16 + i * 32);
        ctx.bezierCurveTo(W * 0.3, 10 + i * 32, W * 0.7, 24 + i * 32, W, 16 + i * 32);
        ctx.stroke();
    }

    // Carved inner border
    ctx.strokeStyle = '#5e3a17';
    ctx.lineWidth = 10;
    ctx.strokeRect(14, 14, W - 28, H - 28);

    // Shrink the title until it fits the plank width.
    let fontSize = 62;
    ctx.textAlign = 'center';
    do {
        ctx.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`;
        fontSize -= 2;
    } while (ctx.measureText(titleText).width > W - 70 && fontSize > 20);

    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#3a2008';
    ctx.fillText(titleText, W / 2 + 2, H * 0.38 + 3); // carved shadow
    ctx.fillStyle = '#fff6e0';
    ctx.fillText(titleText, W / 2, H * 0.38);

    let subSize = 36;
    do {
        ctx.font = `600 ${subSize}px system-ui, -apple-system, sans-serif`;
        subSize -= 2;
    } while (ctx.measureText(subtitleText).width > W - 80 && subSize > 14);

    ctx.fillStyle = '#3a2008';
    ctx.fillText(subtitleText, W / 2 + 1, H * 0.68 + 2);
    ctx.fillStyle = '#ffcf82';
    ctx.fillText(subtitleText, W / 2, H * 0.68);

    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 8;
    return tex;
}

// Each company gets its own landmark silhouette so islands are recognisable
// from a distance. The logo is always mounted on a lit, slowly rotating panel
// near the top, and the player can smash the plinth crate at its base.
const LANDMARK_STYLE = {
    'Camunda': 'pyramid',
    'Cortical.io': 'palace',
    'Upstream': 'temple',
    'European Dynamics': 'arch',
    'Intracom Telecom': 'tower',
    'Hellenic Army': 'barracks'
};

const logoTextureCache = new Map();
function loadLogoTexture(url) {
    if (!logoTextureCache.has(url)) {
        const tex = new THREE.TextureLoader().load(url);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        logoTextureCache.set(url, tex);
    }
    return logoTextureCache.get(url);
}

// A double-sided panel carrying the company logo, framed in gold.
function makeLogoPanel(logoUrl, size = 3) {
    const panel = new THREE.Group();

    const frame = new THREE.Mesh(
        new THREE.BoxGeometry(size * 1.14, size * 1.14, 0.22),
        new THREE.MeshLambertMaterial({ color: 0xf0c96a })
    );
    frame.castShadow = true;
    panel.add(frame);

    // The logo goes on both faces so it reads from any approach angle.
    const logoMat = new THREE.MeshBasicMaterial({ map: loadLogoTexture(logoUrl) });
    [0.13, -0.13].forEach((z) => {
        const face = new THREE.Mesh(new THREE.PlaneGeometry(size, size), logoMat);
        face.position.z = z;
        if (z < 0) face.rotation.y = Math.PI;
        panel.add(face);
    });

    return panel;
}

export class World {
    constructor(scene, data) {
        this.scene = scene;
        this.data = data;
        this.crates = [];
        this.fruits = [];
        this.zones = [];
        this.colliders = [];   // static boxes the player cannot walk through
        this.platforms = [];   // walkable surfaces {x,z,radius,y} for ground height
        this.occluders = [];   // meshes the chase camera must not end up inside
        this.logoPanels = [];  // company logo panels, spun in update()
        this.smokestacks = []; // factory chimneys that emit smoke puffs
        this.brokenDebris = [];

        this._build();
    }

    _build() {
        this._buildSky();
        this._buildOcean();

        // Education comes first: the career starts at university, so the player
        // spawns inside the temple and walks out into their working life.
        this._buildEducationZone(0);

        // Chronological order: data.json lists newest first, so reverse it.
        const experiences = [...this.data.workExperience].reverse();

        experiences.forEach((exp, i) => {
            const theme = ZONE_THEMES[i % ZONE_THEMES.length];
            // Index is offset by one because the education island holds slot 0.
            const slot = i + 1;
            // A gentle S-curve keeps the island chain from being a boring line.
            const center = new THREE.Vector3(
                Math.sin(slot * 0.9) * 14,
                0,
                slot * ZONE_SPACING
            );
            const zone = this._buildZone(exp, center, theme, i);
            this.zones.push(zone);

            // The first bridge leaves the oversized education island.
            const previous = i === 0 ? this.eduCenter : this.zones[i - 1].center;
            this._buildBridge(previous, center, i === 0 ? this.eduRadius : ZONE_RADIUS);
        });

        this._buildSummarySign();
    }

    _buildSky() {
        // Large inverted sphere with a vertical gradient, painted on a canvas.
        const canvas = document.createElement('canvas');
        canvas.width = 8;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createLinearGradient(0, 0, 0, 256);
        grad.addColorStop(0, '#1a4d8f');
        grad.addColorStop(0.45, '#5aa9e6');
        grad.addColorStop(0.75, '#f9d29b');
        grad.addColorStop(1, '#f4a261');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 8, 256);

        const tex = new THREE.CanvasTexture(canvas);
        const sky = new THREE.Mesh(
            new THREE.SphereGeometry(600, 24, 16),
            new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false })
        );
        this.scene.add(sky);

        // A few slab clouds; cheap, and they sell the cartoon look.
        const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, fog: false });
        for (let i = 0; i < 26; i++) {
            const cloud = new THREE.Group();
            const blobs = 3 + Math.floor(Math.random() * 3);
            for (let b = 0; b < blobs; b++) {
                const puff = new THREE.Mesh(new THREE.SphereGeometry(4 + Math.random() * 4, 8, 6), cloudMat);
                puff.position.set(b * 5 - blobs * 2, Math.random() * 2, Math.random() * 3);
                puff.scale.y = 0.6;
                cloud.add(puff);
            }
            cloud.position.set(
                (Math.random() - 0.5) * 400,
                45 + Math.random() * 40,
                Math.random() * (this.data.workExperience.length + 2) * ZONE_SPACING - 60
            );
            this.scene.add(cloud);
        }
    }

    _buildOcean() {
        // +1 for the education island that now opens the chain, plus margin.
        const length = (this.data.workExperience.length + 4) * ZONE_SPACING;
        const ocean = new THREE.Mesh(
            new THREE.PlaneGeometry(900, length + 300),
            new THREE.MeshLambertMaterial({ color: 0x1f7a8c, transparent: true, opacity: 0.92 })
        );
        ocean.rotation.x = -Math.PI / 2;
        ocean.position.set(0, -6, length / 2 - 60);
        this.scene.add(ocean);
        this.ocean = ocean;
    }

    _buildZone(exp, center, theme, index) {
        const group = new THREE.Group();
        group.position.copy(center);
        this.scene.add(group);

        // Island disc, slightly domed by scaling a cylinder.
        const island = new THREE.Mesh(
            new THREE.CylinderGeometry(ZONE_RADIUS, ZONE_RADIUS - 2.5, 6, 32),
            new THREE.MeshLambertMaterial({ color: theme.ground })
        );
        island.position.y = -3;
        island.receiveShadow = true;
        group.add(island);

        // Rocky rim so the edge does not look like a cut-out.
        const rim = new THREE.Mesh(
            new THREE.TorusGeometry(ZONE_RADIUS - 0.4, 0.7, 6, 32),
            new THREE.MeshLambertMaterial({ color: theme.rock })
        );
        rim.rotation.x = Math.PI / 2;
        rim.position.y = -0.3;
        group.add(rim);

        this.platforms.push({ x: center.x, z: center.z, radius: ZONE_RADIUS - 0.8, y: 0 });

        // Palms and rocks for scenery, kept clear of the walking path.
        for (let i = 0; i < 7; i++) {
            const angle = (i / 7) * Math.PI * 2 + index;
            const dist = ZONE_RADIUS - 3 - Math.random() * 2;
            const px = Math.cos(angle) * dist;
            const pz = Math.sin(angle) * dist;
            // Keep the whole north-south corridor clear: this is the path the
            // player walks between bridges, and a trunk in it is a roadblock.
            if (Math.abs(px) < 7) continue;
            if (i % 2 === 0) this._addPalm(group, px, pz, center);
            else this._addRock(group, px, pz, theme, center);
        }

        // Role totem: set off to the side so it never sits between the chase
        // camera and the player as they enter the island from the south.
        const totem = this._buildTotem(exp, theme);
        // Angled toward the walking path; the sign text is a texture on the
        // board itself, so it rotates along with it.
        totem.position.set(-8.5, 0, -2);
        totem.rotation.y = 0.55;
        group.add(totem);
        this.occluders.push(totem);

        // The company landmark anchors the far side of the island, so the
        // player walks toward it and past it on the way to the next zone.
        // Kept well north of the spawn so it never crowds the opening view.
        const LANDMARK_SCALE = 0.78;
        const landmark = this._buildLandmark(
            exp, theme, new THREE.Vector3(center.x, 0, center.z + 9.5), LANDMARK_SCALE
        );
        landmark.position.set(0, 0, 9.5);
        landmark.scale.setScalar(LANDMARK_SCALE);
        group.add(landmark);
        // Deliberately NOT an occluder: the player walks through these, so
        // pulling the camera in on every wall would collapse the view to the
        // player's back each time they pass under an arch.
        this.colliders.push({
            x: center.x - 8.5, z: center.z - 2, halfX: 1.2, halfZ: 1.2, top: 5.5
        });

        // Crates for every project done at this company.
        const projects = this.data.project.filter((p) => p.company === exp.company &&
            this._projectBelongsToStint(p, exp));

        const crateSpots = this._ringPositions(projects.length, 7.5);
        projects.forEach((project, i) => {
            const spot = this._clearOfLandmark(crateSpots[i]);
            const cratePos = this._pushOutOfColliders(
                new THREE.Vector3(center.x + spot.x, 0.75, center.z + spot.z)
            );
            const crate = new Crate({
                position: cratePos,
                kind: project.badges && project.badges.includes('lead') ? 'metal' : 'wood',
                payload: { type: 'project', project, company: exp.company }
            });
            this.scene.add(crate.mesh);
            this.crates.push(crate);
        });

        // A crate holding the role itself, always present. Offset from the
        // island centre so it never spawns on top of an arriving player.
        const roleCrate = new Crate({
            position: new THREE.Vector3(center.x + 3.5, 0.75, center.z + 1.5),
            kind: 'mystery',
            payload: { type: 'role', exp }
        });
        this.scene.add(roleCrate.mesh);
        this.crates.push(roleCrate);

        // Fruit for a sample of the technologies used here.
        const techs = [...new Set(projects.flatMap((p) => p.techUsed || []))];
        const sample = techs.slice(0, 8);
        const fruitSpots = this._ringPositions(sample.length, 11);
        sample.forEach((tech, i) => {
            const spot = this._clearOfLandmark(fruitSpots[i]);
            const pos = new THREE.Vector3(center.x + spot.x, 1.2, center.z + spot.z);
            // Palms are placed before the fruit, so a ring slot can land inside
            // a trunk. Slide the fruit out or it can never be collected.
            this._pushOutOfColliders(pos);
            const fruit = new Fruit(pos, tech);
            this.scene.add(fruit.mesh);
            this.fruits.push(fruit);
        });

        return { center, exp, theme, group };
    }

    // A project belongs to a stint when its date range overlaps the stint's.
    // Upstream appears twice in the history, so company name alone is ambiguous.
    _projectBelongsToStint(project, exp) {
        const parseProject = (s) => {
            const [m, y] = s.split('-').map(Number);
            return y * 12 + (m - 1);
        };
        const parseExp = (s) => {
            if (!s || s === 'Present') return 9999 * 12;
            const d = new Date(s + ' 1');
            return Number.isNaN(d.getTime()) ? 0 : d.getFullYear() * 12 + d.getMonth();
        };
        const pStart = parseProject(project.startDate);
        const pEnd = parseProject(project.endDate);
        const eStart = parseExp(exp.startDate);
        const eEnd = parseExp(exp.endDate);
        return pStart <= eEnd && pEnd >= eStart;
    }

    // The landmark occupies the island's north end (local z ≈ +9.5). Any ring
    // slot that lands inside its footprint is pulled back south, otherwise the
    // crate ends up sealed inside a collider and can never be broken.
    _clearOfLandmark(spot) {
        const LANDMARK_Z = 9.5;
        const KEEP_OUT = 4.6;
        const dz = spot.z - LANDMARK_Z;
        if (Math.abs(spot.x) < KEEP_OUT && Math.abs(dz) < KEEP_OUT) {
            return { x: spot.x, z: LANDMARK_Z - KEEP_OUT - 1.2 };
        }
        return spot;
    }

    // Slides a point out of any static collider it happens to sit inside,
    // along whichever axis needs the smaller correction.
    _pushOutOfColliders(pos, clearance = 0.9) {
        for (const col of this.colliders) {
            if (pos.y >= col.top) continue;
            const dx = pos.x - col.x;
            const dz = pos.z - col.z;
            const overlapX = col.halfX + clearance - Math.abs(dx);
            const overlapZ = col.halfZ + clearance - Math.abs(dz);
            if (overlapX > 0 && overlapZ > 0) {
                if (overlapX < overlapZ) pos.x += Math.sign(dx || 1) * overlapX;
                else pos.z += Math.sign(dz || 1) * overlapZ;
            }
        }
        return pos;
    }

    _ringPositions(count, radius) {
        // Spread items around a ring, biased away from the entry corridor.
        return Array.from({ length: count }, (_, i) => {
            const angle = -Math.PI / 2 + (i + 0.5) / Math.max(count, 1) * Math.PI * 1.6 + Math.PI * 0.2;
            return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
        });
    }

    // Builds the company landmark and returns its group. Each style is a
    // different silhouette, but all of them mount the logo panel up high.
    // `scale` must match the scale applied to the returned group by the caller,
    // because the colliders and platforms below are registered in world space
    // and would otherwise not line up with the rendered geometry.
    _buildLandmark(exp, theme, center, scale = 1) {
        const style = LANDMARK_STYLE[exp.company] || 'tower';
        const landmark = new THREE.Group();
        const stone = new THREE.MeshLambertMaterial({ color: 0xcbbb98 });
        const accent = new THREE.MeshLambertMaterial({ color: theme.accent });
        const metal = new THREE.MeshLambertMaterial({ color: 0x9aa6b2 });

        let logoY = 8;
        let blockRadius = 3.2;

        if (style === 'pyramid') {
            // Camunda: a stepped ziggurat the player can climb tier by tier.
            for (let i = 0; i < 4; i++) {
                const s = 8.5 - i * 1.8;
                const step = new THREE.Mesh(new THREE.BoxGeometry(s, 1.3, s), stone);
                step.position.y = 0.65 + i * 1.3;
                step.castShadow = true;
                step.receiveShadow = true;
                landmark.add(step);
                this.platforms.push({
                    x: center.x, z: center.z,
                    halfX: (s / 2) * scale, halfZ: (s / 2) * scale,
                    y: (1.3 + i * 1.3) * scale, box: true
                });
            }
            logoY = 6.6;     // just above the top tier, still readable from below
            blockRadius = 0; // climbable, so no blocking collider

        } else if (style === 'temple') {
            // Upstream: an ancient Greek temple — stylobate, colonnade, pediment.
            const marble = new THREE.MeshLambertMaterial({ color: 0xe8e2d2 });

            // Stepped base, climbable from the south.
            for (let i = 0; i < 3; i++) {
                const w = 11 - i * 0.9;
                const d = 8 - i * 0.9;
                const step = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), marble);
                step.position.y = 0.25 + i * 0.5;
                step.receiveShadow = true;
                landmark.add(step);
                this.platforms.push({
                    x: center.x, z: center.z,
                    halfX: (w / 2) * scale, halfZ: (d / 2) * scale,
                    y: (0.5 + i * 0.5) * scale, box: true
                });
            }

            // Fluted columns around the perimeter. The centre column of each
            // end row is omitted, leaving a doorway aligned with the walking
            // path so the player passes straight through the temple.
            const colY = 1.5;
            const colH = 5.2;
            for (const [cx, cz] of [
                [-5, -3], [-2.8, -3], [2.8, -3], [5, -3],
                [-5, 3], [-2.8, 3], [2.8, 3], [5, 3],
                [-5, 0], [5, 0]
            ]) {
                const col = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, colH, 10), marble);
                col.position.set(cx, colY + colH / 2, cz);
                col.castShadow = true;
                landmark.add(col);
                // Capital
                const cap = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.35, 1.15), marble);
                cap.position.set(cx, colY + colH + 0.17, cz);
                landmark.add(cap);
                this.colliders.push({
                    x: center.x + cx * scale, z: center.z + cz * scale,
                    halfX: 0.55 * scale, halfZ: 0.55 * scale, top: (colY + colH) * scale
                });
            }

            // Entablature and the triangular pediment on the front face.
            const arch = new THREE.Mesh(new THREE.BoxGeometry(10, 0.8, 7), marble);
            arch.position.y = colY + colH + 0.75;
            arch.castShadow = true;
            landmark.add(arch);

            const pediment = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 3.1, 6.5, 3), marble);
            pediment.rotation.x = -Math.PI / 2;
            pediment.rotation.y = Math.PI / 2;
            pediment.position.set(0, colY + colH + 2.2, 0);
            pediment.scale.set(1, 1.55, 1);
            pediment.castShadow = true;
            landmark.add(pediment);

            logoY = 4.6;      // between the columns, at the player's eye line
            blockRadius = 0;  // the colonnade itself provides the collision

        } else if (style === 'palace') {
            // Cortical.io: a palace — wide wings, a domed centre, gold trim.
            const wall = new THREE.MeshLambertMaterial({ color: 0xf0e4d0 });
            const gold = new THREE.MeshLambertMaterial({ color: 0xe8b44a });

            // The main block is split into two halves with a passage between
            // them, so the player walks through the palace rather than around.
            [-1, 1].forEach((side) => {
                const half = new THREE.Mesh(new THREE.BoxGeometry(2.6, 6.4, 6), wall);
                half.position.set(side * 4.2, 3.2, 0);
                half.castShadow = true;
                landmark.add(half);
            });
            // Lintel spanning the passage. Kept high so the chase camera can
            // follow the player through the arch without clipping into it.
            const span = new THREE.Mesh(new THREE.BoxGeometry(11, 1.4, 6), wall);
            span.position.y = 7.1;
            span.castShadow = true;
            landmark.add(span);

            // Side wings, slightly lower than the centre.
            [-5.2, 5.2].forEach((x) => {
                const spire = new THREE.Mesh(new THREE.ConeGeometry(1.5, 2.6, 8), gold);
                spire.position.set(x, 7.6, 0);
                spire.castShadow = true;
                landmark.add(spire);
            });

            // Central dome, sitting on the lintel above the passage.
            const drum = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.7, 1.6, 14), wall);
            drum.position.y = 8.6;
            landmark.add(drum);
            const dome = new THREE.Mesh(
                new THREE.SphereGeometry(2.5, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), gold
            );
            dome.position.y = 9.4;
            dome.castShadow = true;
            landmark.add(dome);

            // Gold surround framing the walk-through passage.
            [-1, 1].forEach((side) => {
                const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3.2, 0.35), gold);
                jamb.position.set(side * 2.2, 1.6, -3.1);
                landmark.add(jamb);
            });

            logoY = 7.1;     // centred on the lintel above the passage
            blockRadius = 5.5;

        } else if (style === 'arch') {
            // European Dynamics: a classical arch you can walk through.
            [-2.6, 2.6].forEach((x) => {
                const col = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.85, 7, 12), stone);
                col.position.set(x, 3.5, 0);
                col.castShadow = true;
                landmark.add(col);
                this.colliders.push({
                    x: center.x + x * scale, z: center.z,
                    halfX: 0.9 * scale, halfZ: 0.9 * scale, top: 7 * scale
                });
            });
            const lintel = new THREE.Mesh(new THREE.BoxGeometry(7.6, 1.3, 2), stone);
            lintel.position.y = 7.6;
            lintel.castShadow = true;
            landmark.add(lintel);
            logoY = 5.2;     // hangs in the archway opening, at eye level
            blockRadius = 0; // the gap between the columns stays walkable

        } else if (style === 'tower') {
            // Intracom Telecom: a broad stone tower with a battlement crown and
            // a comms dish, a nod to the telecom work.
            const brick = new THREE.MeshLambertMaterial({ color: 0xb9a68a });

            // Two piers carry the tower, leaving a passage at ground level that
            // the player can walk through on the way to the next bridge.
            [-1, 1].forEach((side) => {
                const pier = new THREE.Mesh(new THREE.BoxGeometry(1.6, 3.4, 5.2), brick);
                pier.position.set(side * 2.1, 1.7, 0);
                pier.castShadow = true;
                landmark.add(pier);
            });

            const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.2, 6, 12), brick);
            shaft.position.y = 6.4;
            shaft.castShadow = true;
            landmark.add(shaft);

            // Belt course breaks up the shaft so it does not read as a pipe.
            const belt = new THREE.Mesh(new THREE.CylinderGeometry(2.85, 2.85, 0.4, 12), stone);
            belt.position.y = 6.6;
            landmark.add(belt);

            // Battlements around the top of the shaft.
            for (let i = 0; i < 10; i++) {
                const a = (i / 10) * Math.PI * 2;
                const merlon = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.1, 0.8), stone);
                merlon.position.set(Math.cos(a) * 2.7, 9.9, Math.sin(a) * 2.7);
                merlon.rotation.y = -a;
                merlon.castShadow = true;
                landmark.add(merlon);
            }

            const dish = new THREE.Mesh(
                new THREE.SphereGeometry(1.3, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2.4),
                new THREE.MeshLambertMaterial({ color: 0xe8e2d4, side: THREE.DoubleSide })
            );
            dish.position.set(0, 11.0, 0.6);
            dish.rotation.x = 2.2;
            landmark.add(dish);

            logoY = 5.0;  // on the shaft just above the passage
            blockRadius = 3.2;

        } else if (style === 'barracks') {
            // Hellenic Army: a barracks hut with a pitched roof, sandbags and a
            // flagpole. The Greek emblem hangs on the gable facing the path.
            const olive = new THREE.MeshLambertMaterial({ color: 0x6f7a4e });
            const roofMat = new THREE.MeshLambertMaterial({ color: 0x54503f });

            // Built as four walls with a doorway gap at each end, so the player
            // can walk in the south door, through the hut, and out the north
            // door straight onto the bridge — the building is a passage, not a
            // wall. Side walls only; the gable ends are left open as doorways.
            const WALL_H = 4;
            [-1, 1].forEach((side) => {
                const wall = new THREE.Mesh(new THREE.BoxGeometry(0.4, WALL_H, 6), olive);
                wall.position.set(side * 4.3, WALL_H / 2, 0);
                wall.castShadow = true;
                landmark.add(wall);
                this.colliders.push({
                    x: center.x + side * 4.3 * scale, z: center.z,
                    halfX: 0.35 * scale, halfZ: 3 * scale, top: WALL_H * scale
                });

                const win = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.2, 1.6),
                    new THREE.MeshLambertMaterial({ color: 0x2f3a44 }));
                win.position.set(side * 4.45, 2.4, 0);
                landmark.add(win);
            });

            // Short returns at each end frame the doorways without closing them.
            [-1, 1].forEach((zSide) => {
                [-1, 1].forEach((xSide) => {
                    const jamb = new THREE.Mesh(new THREE.BoxGeometry(2.4, WALL_H, 0.4), olive);
                    jamb.position.set(xSide * 3.3, WALL_H / 2, zSide * 2.8);
                    jamb.castShadow = true;
                    landmark.add(jamb);
                    this.colliders.push({
                        x: center.x + xSide * 3.3 * scale, z: center.z + zSide * 2.8 * scale,
                        halfX: 1.2 * scale, halfZ: 0.35 * scale, top: WALL_H * scale
                    });
                });
            });

            // Pitched roof: a 3-sided prism laid along the hut's long (x) axis,
            // so the triangular gable ends face north and south — the south one
            // is the face the approaching player sees, and carries the emblem.
            const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 3.4, 9.4, 3), roofMat);
            roof.rotation.z = Math.PI / 2;   // ridge runs along x
            roof.position.y = WALL_H + 0.9;
            roof.scale.set(1, 1, 0.75);
            roof.castShadow = true;
            landmark.add(roof);

            // Sandbag emplacements flanking the hut, well clear of the doorway
            // so they never obstruct the walk-through route.
            const bagMat = new THREE.MeshLambertMaterial({ color: 0x9c8b62 });
            [-1, 1].forEach((side) => {
                for (let i = 0; i < 5; i++) {
                    for (let row = 0; row < 2; row++) {
                        const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.55, 4, 6), bagMat);
                        bag.position.set(
                            side * (5.6 + row * 0.4),
                            0.34 + row * 0.6,
                            -2.2 + i * 1.1
                        );
                        bag.rotation.z = Math.PI / 2;
                        bag.rotation.y = Math.PI / 2;
                        bag.castShadow = true;
                        landmark.add(bag);
                    }
                }
            });

            const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 8, 8), metal);
            pole.position.set(5.6, 4, -2);
            landmark.add(pole);

            logoY = 5.4;   // on the gable above the south doorway
            blockRadius = 0; // walls do the blocking; the doorways stay open

        } else {
            // Fallback: a simple tapering tower with a lantern top.
            const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 2.6, 8, 10), stone);
            shaft.position.y = 4;
            shaft.castShadow = true;
            landmark.add(shaft);
            const cap = new THREE.Mesh(new THREE.ConeGeometry(2.5, 2.6, 10), accent);
            cap.position.y = 9.3;
            cap.castShadow = true;
            landmark.add(cap);
            logoY = 5.4;
            blockRadius = 2.6;
        }

        // The rotating logo panel, common to every landmark style. It sits on
        // the *south* face — the side the player approaches from — and low
        // enough to stay in frame from ground level.
        const panelZ = { temple: -3.6, palace: -3.4, arch: 0, tower: -3.3, pyramid: 0, barracks: -3.15 };
        const panel = makeLogoPanel(exp.companyLogo, style === 'pyramid' ? 3.4 : 2.8);
        panel.position.set(0, logoY, panelZ[style] ?? -1.2);
        landmark.add(panel);
        this.logoPanels.push(panel);

        // A dedicated light keeps the logo bright even when the structure
        // shadows it, so it always reads against the stone behind.
        const glow = new THREE.PointLight(0xfff3d0, 0.9, 12, 2);
        glow.position.set(0, logoY, (panelZ[style] ?? -1.2) - 2.2);
        landmark.add(glow);

        // Solid landmarks are blocked as two side masses with a clear corridor
        // down the middle, so the player can always walk straight through the
        // structure and out the far side toward the next bridge.
        if (blockRadius > 0) {
            const CORRIDOR = 2.2; // half-width of the walkable gap
            const sideHalf = (blockRadius - CORRIDOR) / 2;
            if (sideHalf > 0.2) {
                [-1, 1].forEach((side) => {
                    this.colliders.push({
                        x: center.x + side * (CORRIDOR + sideHalf) * scale,
                        z: center.z,
                        halfX: sideHalf * scale,
                        halfZ: blockRadius * scale,
                        top: 3 * scale
                    });
                });
            }
        }

        return landmark;
    }

    _buildTotem(exp, theme) {
        const totem = new THREE.Group();

        const post = new THREE.Mesh(
            new THREE.CylinderGeometry(0.35, 0.45, 4.5, 8),
            new THREE.MeshLambertMaterial({ color: 0x6b4423 })
        );
        post.position.y = 2.25;
        post.castShadow = true;
        totem.add(post);

        // The sign face is painted onto the board's front and back so the text
        // is readable from either side as the player circles the island.
        const signTex = makeSignTexture(
            exp.title,
            `${exp.company} · ${exp.startDate}–${exp.endDate}`
        );
        const plain = new THREE.MeshLambertMaterial({ color: 0x7d5228 });
        const faced = new THREE.MeshLambertMaterial({ map: signTex });
        // BoxGeometry material order: +x, -x, +y, -y, +z, -z
        const board = new THREE.Mesh(
            new THREE.BoxGeometry(5.4, 2.0, 0.3),
            [plain, plain, plain, plain, faced, faced]
        );
        board.position.y = 4.2;
        board.castShadow = true;
        totem.add(board);

        // Tiki face carved on the post, purely decorative.
        const eyeMat = new THREE.MeshLambertMaterial({ color: 0x241608 });
        [-0.16, 0.16].forEach((x) => {
            const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), eyeMat);
            eye.position.set(x, 2.6, 0.34);
            totem.add(eye);
        });

        return totem;
    }

    _addPalm(group, x, z, center) {
        const palm = new THREE.Group();
        const trunkHeight = 4 + Math.random() * 2.5;

        const trunk = new THREE.Mesh(
            new THREE.CylinderGeometry(0.22, 0.34, trunkHeight, 7),
            new THREE.MeshLambertMaterial({ color: 0x8b6f47 })
        );
        trunk.position.y = trunkHeight / 2;
        trunk.rotation.z = (Math.random() - 0.5) * 0.25;
        trunk.castShadow = true;
        palm.add(trunk);

        const frondMat = new THREE.MeshLambertMaterial({ color: 0x2e8b3d, side: THREE.DoubleSide });
        for (let f = 0; f < 6; f++) {
            const frond = new THREE.Mesh(new THREE.ConeGeometry(0.6, 3.2, 4), frondMat);
            const a = (f / 6) * Math.PI * 2;
            frond.position.set(Math.cos(a) * 1.2, trunkHeight, Math.sin(a) * 1.2);
            frond.rotation.z = Math.cos(a) * 1.1;
            frond.rotation.x = -Math.sin(a) * 1.1;
            frond.castShadow = true;
            palm.add(frond);
        }

        palm.position.set(x, 0, z);
        group.add(palm);
        this.occluders.push(palm);
        // `top` spans the whole trunk so the player cannot walk through a palm
        // while airborne; the half-extents keep them off the bark.
        this.colliders.push({
            x: center.x + x, z: center.z + z, halfX: 0.55, halfZ: 0.55, top: trunkHeight
        });
    }

    _addRock(group, x, z, theme, center) {
        const scale = 0.7 + Math.random() * 0.9;
        const rock = new THREE.Mesh(
            new THREE.DodecahedronGeometry(scale, 0),
            new THREE.MeshLambertMaterial({ color: theme.rock, flatShading: true })
        );
        rock.position.set(x, scale * 0.5, z);
        rock.rotation.set(Math.random(), Math.random(), Math.random());
        rock.castShadow = true;
        rock.receiveShadow = true;
        group.add(rock);
    }

    // `fromRadius` is the radius of the island the bridge leaves, which differs
    // for the oversized education island.
    _buildBridge(from, to, fromRadius = ZONE_RADIUS) {
        const dir = new THREE.Vector3().subVectors(to, from);
        const length = dir.length();
        const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
        const angle = Math.atan2(dir.x, dir.z);

        const bridge = new THREE.Group();
        bridge.position.copy(mid);
        bridge.rotation.y = angle;
        this.scene.add(bridge);

        // Plank deck spanning the gap between the two island rims.
        const span = length - (fromRadius - 1) - (ZONE_RADIUS - 1);
        // Shift the deck so it stays centred in the actual gap when the two
        // islands have different radii.
        const deckShift = (fromRadius - ZONE_RADIUS) / 2;
        const plankMat = new THREE.MeshLambertMaterial({ color: 0x9c6b3f });
        const plankCount = Math.max(2, Math.floor(span / 1.1));
        for (let i = 0; i < plankCount; i++) {
            const plank = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.22, 0.85), plankMat);
            plank.position.z = deckShift - span / 2 + (i + 0.5) * (span / plankCount);
            plank.position.y = -0.11;
            plank.receiveShadow = true;
            bridge.add(plank);
        }

        // Rope rails
        const ropeMat = new THREE.MeshLambertMaterial({ color: 0xd8c9a3 });
        [-2.2, 2.2].forEach((side) => {
            const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, span, 5), ropeMat);
            rope.rotation.x = Math.PI / 2;
            rope.position.set(side, 1.1, deckShift);
            bridge.add(rope);
        });

        // Register the bridge as a walkable strip.
        this.platforms.push({
            bridge: true,
            from: from.clone(),
            to: to.clone(),
            halfWidth: 2.2,
            y: 0
        });
    }

    _buildEducationZone(index) {
        const theme = { ground: 0xc9a86a, accent: 0x8f7443, rock: 0x9c8a6b };
        const center = new THREE.Vector3(Math.sin(index * 0.9) * 14, 0, index * ZONE_SPACING);

        const group = new THREE.Group();
        group.position.copy(center);
        this.scene.add(group);

        // The education island is larger than the work islands: it has to hold
        // the whole temple footprint plus walking room around it.
        const EDU_RADIUS = ZONE_RADIUS + 8;
        this.eduRadius = EDU_RADIUS;
        const island = new THREE.Mesh(
            new THREE.CylinderGeometry(EDU_RADIUS, EDU_RADIUS - 2.5, 6, 32),
            new THREE.MeshLambertMaterial({ color: theme.ground })
        );
        island.position.y = -3;
        island.receiveShadow = true;
        group.add(island);
        this.platforms.push({ x: center.x, z: center.z, radius: EDU_RADIUS - 0.8, y: 0 });

        const rim = new THREE.Mesh(
            new THREE.TorusGeometry(EDU_RADIUS - 0.4, 0.7, 6, 32),
            new THREE.MeshLambertMaterial({ color: theme.rock })
        );
        rim.rotation.x = Math.PI / 2;
        rim.position.y = -0.3;
        group.add(rim);

        // A Parthenon-style temple, large enough that the player starts inside
        // the colonnade and walks out between the columns to begin the career.
        const marble = new THREE.MeshLambertMaterial({ color: 0xeee7d5 });
        const marbleWorn = new THREE.MeshLambertMaterial({ color: 0xded5be });

        // Sized generously: the chase camera sits ~13 units behind the player,
        // so the interior has to be roomy enough to hold both without the view
        // jamming into a column.
        const HALF_W = 13;   // half width  (x)
        const HALF_D = 11;   // half depth  (z)
        const COL_H = 10;
        const BASE_TOP = 1.5;

        // Stylobate: three broad steps, walkable and climbable from any side.
        for (let i = 0; i < 3; i++) {
            const w = (HALF_W + 2.2 - i * 0.55) * 2;
            const d = (HALF_D + 2.2 - i * 0.55) * 2;
            const step = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), marbleWorn);
            step.position.y = 0.25 + i * 0.5;
            step.receiveShadow = true;
            group.add(step);
            this.platforms.push({
                x: center.x, z: center.z,
                halfX: w / 2, halfZ: d / 2, y: 0.5 + i * 0.5, box: true
            });
        }

        // Peristyle: columns around the full perimeter, spaced so the player
        // can walk between any adjacent pair.
        // A wide central gap is left in the north and south rows: those are the
        // doorways, so the player always has a clear straight walk in and out
        // rather than having to thread between columns.
        const DOORWAY = 5;
        const colSpots = [];
        const nx = 8;   // columns along each long side
        const nz = 5;   // columns along each short side
        for (let i = 0; i < nx; i++) {
            const x = -HALF_W + (i / (nx - 1)) * HALF_W * 2;
            if (Math.abs(x) < DOORWAY) continue;
            colSpots.push([x, -HALF_D], [x, HALF_D]);
        }
        for (let i = 1; i < nz - 1; i++) {
            const z = -HALF_D + (i / (nz - 1)) * HALF_D * 2;
            colSpots.push([-HALF_W, z], [HALF_W, z]);
        }

        for (const [cx, cz] of colSpots) {
            const col = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.58, COL_H, 12), marble);
            col.position.set(cx, BASE_TOP + COL_H / 2, cz);
            col.castShadow = true;
            group.add(col);

            const cap = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.4, 1.35), marble);
            cap.position.set(cx, BASE_TOP + COL_H + 0.2, cz);
            cap.castShadow = true;
            group.add(cap);

            this.colliders.push({
                x: center.x + cx, z: center.z + cz,
                halfX: 0.62, halfZ: 0.62, top: BASE_TOP + COL_H
            });
        }

        // Architrave ring and the pediments at both ends.
        const entabY = BASE_TOP + COL_H + 0.9;
        const entablature = new THREE.Mesh(
            new THREE.BoxGeometry((HALF_W + 0.9) * 2, 1.0, (HALF_D + 0.9) * 2), marbleWorn
        );
        entablature.position.y = entabY;
        entablature.castShadow = true;
        group.add(entablature);

        [-1, 1].forEach((side) => {
            const pediment = new THREE.Mesh(
                new THREE.CylinderGeometry(0.01, HALF_W + 0.9, 3.0, 3), marble
            );
            pediment.rotation.x = -Math.PI / 2;
            pediment.rotation.y = Math.PI / 2;
            pediment.position.set(0, entabY + 1.4, side * (HALF_D + 0.3));
            pediment.scale.set(1, 0.55, 1);
            pediment.castShadow = true;
            group.add(pediment);
        });

        // Deliberately no roof slab: the player starts inside the colonnade and
        // the chase camera looks down into it, so a closed roof would black out
        // the opening shot. The entablature ring alone reads as a temple.

        const edu = this.data.education[0];
        if (edu) {
            // The school crest hangs inside the temple, facing the player as
            // they spawn, then again outside above the entrance steps.
            // schoolLogo is an absolute site path; make it relative to this page.
            const logoPath = edu.schoolLogo.replace(/^\/resume\//, '');

            // Hung high on the interior's west side: visible from inside the
            // colonnade, but out of the chase camera's sightline down the
            // north-south axis, so it never masks the player at spawn.
            const crest = makeLogoPanel(logoPath, 4.2);
            crest.position.set(-HALF_W + 3, 7.4, 0);
            group.add(crest);
            this.logoPanels.push(crest);

            const crestLight = new THREE.PointLight(0xfff3d0, 1.4, 24, 2);
            crestLight.position.set(-HALF_W + 5, 7.4, 0);
            group.add(crestLight);

            // A second crest on the outside face, above the exit the player
            // walks toward, so the building is identifiable from the bridge.
            const outerCrest = makeLogoPanel(logoPath, 3.0);
            outerCrest.position.set(0, entabY + 1.5, HALF_D + 1.6);
            group.add(outerCrest);
            this.logoPanels.push(outerCrest);

            const sign = makeLabelSprite(`${edu.degree} · ${edu.fieldOfStudy}`, {
                fontSize: 34, worldWidth: 8
            });
            sign.position.set(0, entabY + 4.4, 0);
            group.add(sign);

            const school = makeLabelSprite(`${edu.school} (${edu.startYear}–${edu.endYear})`, {
                fontSize: 28, color: '#ffe0a0', bg: 'rgba(40,24,12,0.8)', worldWidth: 9
            });
            school.position.set(0, entabY + 3.3, 0);
            group.add(school);

            // The education crate sits inside, right where the player starts.
            const crate = new Crate({
                position: new THREE.Vector3(center.x - 5, BASE_TOP + 0.75, center.z + 3),
                kind: 'checkpoint',
                payload: { type: 'education', edu }
            });
            this.scene.add(crate.mesh);
            this.crates.push(crate);
        }

        // Contact crate, also inside the temple — the "about me" plaque.
        const contact = new Crate({
            position: new THREE.Vector3(center.x + 5, BASE_TOP + 0.75, center.z + 3),
            kind: 'mystery',
            payload: { type: 'contact', data: this.data }
        });
        this.scene.add(contact.mesh);
        this.crates.push(contact);

        // Where the player spawns and where the camera starts, both inside.
        this.eduCenter = center;
        this.spawnPoint = new THREE.Vector3(center.x, BASE_TOP, center.z + 1);

        // Region the camera treats as "indoors": while the player is in here it
        // tucks in close so it stays inside the colonnade. Generous on z so the
        // transition happens as the player clears the steps, not at the columns.
        this.interiorBounds = {
            minX: center.x - HALF_W - 3, maxX: center.x + HALF_W + 3,
            minZ: center.z - HALF_D - 5, maxZ: center.z + HALF_D + 5
        };
        this.finalZone = null; // education is the opening zone now, not the finale
    }

    _buildSummarySign() {
        // Welcome board at the very start of the chain, out in front of the
        // temple so it frames the opening view without blocking the exit.
        const start = this.eduCenter || new THREE.Vector3();
        const sign = makeLabelSprite(this.data.name, { fontSize: 56, worldWidth: 9 });
        sign.position.set(start.x, 15.5, start.z - 17);
        this.scene.add(sign);

        const sub = makeLabelSprite(this.data.summary, {
            fontSize: 26, color: '#ffe0a0', bg: 'rgba(40,24,12,0.8)',
            maxWidth: 700, worldWidth: 10
        });
        sub.position.set(start.x, 14.0, start.z - 17);
        this.scene.add(sub);
    }

    // ---- queries used by the game loop ------------------------------------

    // Height of the walkable surface under a point, or null when over water.
    groundHeightAt(x, z) {
        let best = null;
        for (const p of this.platforms) {
            if (p.bridge) {
                // Distance from the point to the bridge segment.
                const dir = new THREE.Vector3().subVectors(p.to, p.from);
                const len2 = dir.lengthSq();
                const t = THREE.MathUtils.clamp(
                    ((x - p.from.x) * dir.x + (z - p.from.z) * dir.z) / len2, 0, 1
                );
                const cx = p.from.x + dir.x * t;
                const cz = p.from.z + dir.z * t;
                if (Math.hypot(x - cx, z - cz) < p.halfWidth) {
                    best = Math.max(best ?? -Infinity, p.y);
                }
            } else if (p.box) {
                if (Math.abs(x - p.x) < p.halfX && Math.abs(z - p.z) < p.halfZ) {
                    best = Math.max(best ?? -Infinity, p.y);
                }
            } else if (Math.hypot(x - p.x, z - p.z) < p.radius) {
                best = Math.max(best ?? -Infinity, p.y);
            }
        }
        return best;
    }

    // Push the player out of static obstacles (trees, totems).
    resolveCollisions(pos, radius) {
        for (const c of this.colliders) {
            const dx = pos.x - c.x;
            const dz = pos.z - c.z;
            const overlapX = c.halfX + radius - Math.abs(dx);
            const overlapZ = c.halfZ + radius - Math.abs(dz);
            if (overlapX > 0 && overlapZ > 0 && pos.y < c.top) {
                // Resolve along the shallower axis so the player slides.
                if (overlapX < overlapZ) pos.x += Math.sign(dx || 1) * overlapX;
                else pos.z += Math.sign(dz || 1) * overlapZ;
            }
        }
    }

    update(dt, time) {
        for (const crate of this.crates) {
            crate.update(dt, time);
            if (crate.debris.length) crate.updateDebris(dt, this.scene);
        }
        for (const fruit of this.fruits) fruit.update(dt, time);

        // Logo panels turn slowly and bob, so they catch the eye from afar.
        // The rest height is captured once; bobbing always applies to that,
        // never to the already-bobbed value from the previous frame.
        for (let i = 0; i < this.logoPanels.length; i++) {
            const panel = this.logoPanels[i];
            if (panel.userData.baseY === undefined) panel.userData.baseY = panel.position.y;
            panel.rotation.y += dt * 0.5;
            panel.position.y = panel.userData.baseY + Math.sin(time * 1.4 + i) * 0.12;
        }

        this._updateSmoke(dt, time);

        if (this.ocean) {
            this.ocean.position.y = -6 + Math.sin(time * 0.7) * 0.12;
        }
    }

    // Chimney smoke: small puffs that rise, expand and fade.
    _updateSmoke(dt, time) {
        if (!this._smokeGeo) {
            this._smokeGeo = new THREE.SphereGeometry(0.45, 7, 6);
            this._smokeMat = new THREE.MeshLambertMaterial({
                color: 0xdfe4e8, transparent: true, opacity: 0.55
            });
        }

        for (const stack of this.smokestacks) {
            stack.timer -= dt;
            if (stack.timer <= 0) {
                stack.timer = 0.55 + Math.random() * 0.35;
                // Each puff owns its material so it can fade independently.
                const puff = new THREE.Mesh(this._smokeGeo, this._smokeMat.clone());
                puff.position.copy(stack.origin);
                puff.userData.life = 3.2;
                this.scene.add(puff);
                stack.puffs.push(puff);
            }

            for (let i = stack.puffs.length - 1; i >= 0; i--) {
                const puff = stack.puffs[i];
                puff.userData.life -= dt;
                if (puff.userData.life <= 0) {
                    this.scene.remove(puff);
                    puff.material.dispose();
                    stack.puffs.splice(i, 1);
                    continue;
                }
                const age = 1 - puff.userData.life / 3.2;
                puff.position.y += dt * 1.5;
                puff.position.x += Math.sin(time * 0.8 + i) * dt * 0.4;
                puff.scale.setScalar(0.5 + age * 1.8);
                puff.material.opacity = 0.55 * (1 - age);
            }
        }
    }

    get totalCrates() { return this.crates.length; }
    get totalFruits() { return this.fruits.length; }
}
