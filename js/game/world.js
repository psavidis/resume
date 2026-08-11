// Builds the island world out of the resume data.
//
// Layout: each work experience becomes a circular "island" zone, laid out along
// a gently curving path in chronological order (oldest first, so walking
// forward walks forward through the career). Bridges connect the zones.
// Within a zone: a totem sign naming the role, crates carrying the projects
// done there, and fruit for the technologies used.

import * as THREE from '../vendor/three.module.js';
import { Crate, Fruit } from './crate.js';

export const ZONE_RADIUS = 15;
const ZONE_SPACING = 42;

// The flight easter egg: fly high enough above Cortical.io and the sky gives
// way to space. Altitudes are keyed to the same scale as the cloud layer
// (y ~45-85, see _buildSky) — SPACE_START sits comfortably above the tallest
// clouds so the transition reads as "climbed past the sky", not "clipped
// through a cloud into a different game".
export const SPACE_START = 140;   // fog/color begin fading toward black
export const SPACE_FULL = 260;    // fully space: black sky, stars, earth, sun
// The moon sits far to the side of the island chain (never over any island's
// x/z footprint, so groundHeightAt's flat circle test can't be picked up by
// accident while flying low) and high enough that reaching it means
// committing to the climb through SPACE_FULL first. Distance from the origin
// (~421) is kept well inside the star sky sphere's radius (580, see
// _buildSpace) — the same margin, proportionally, the island chain itself
// keeps from the ordinary day sky sphere (radius 600).
export const MOON_CENTER = new THREE.Vector3(260, 300, 140);
const MOON_RADIUS = 18;

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
    const W = 1024;
    const H = 384;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Wood base with grain
    ctx.fillStyle = '#a5713c';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(90, 55, 20, 0.35)';
    ctx.lineWidth = 4;
    for (let i = 0; i < 9; i++) {
        ctx.beginPath();
        ctx.moveTo(0, 21 + i * 43);
        ctx.bezierCurveTo(W * 0.3, 13 + i * 43, W * 0.7, 32 + i * 43, W, 21 + i * 43);
        ctx.stroke();
    }

    // Carved inner border — kept thin relative to the plank so it frames the
    // text rather than eating into the space available for it.
    ctx.strokeStyle = '#5e3a17';
    ctx.lineWidth = 12;
    ctx.strokeRect(18, 18, W - 36, H - 36);

    // Recessed plaque behind the text: a flat, near-black panel so the wood
    // grain lines (drawn above) never cross a letter — without this, a grain
    // curve running through the middle of the board reads as a stroke
    // through the text and makes names hard to pick out at a glance.
    const plaqueX = 60, plaqueY = 34, plaqueW = W - 120, plaqueH = H - 68;
    ctx.fillStyle = 'rgba(25, 15, 6, 0.78)';
    ctx.beginPath();
    ctx.roundRect(plaqueX, plaqueY, plaqueW, plaqueH, 14);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 220, 160, 0.35)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Shrink the title until it fits the plaque width, with margin so
    // letters never reach the plaque's own edge.
    const textMax = plaqueW - 80;
    let fontSize = 88;
    ctx.textAlign = 'center';
    do {
        ctx.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`;
        fontSize -= 2;
    } while (ctx.measureText(titleText).width > textMax && fontSize > 26);

    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.strokeText(titleText, W / 2, H * 0.36);
    ctx.fillStyle = '#fff6e0';
    ctx.fillText(titleText, W / 2, H * 0.36);

    let subSize = 46;
    do {
        ctx.font = `600 ${subSize}px system-ui, -apple-system, sans-serif`;
        subSize -= 2;
    } while (ctx.measureText(subtitleText).width > textMax && subSize > 18);

    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.strokeText(subtitleText, W / 2, H * 0.72);
    ctx.fillStyle = '#ffcf82';
    ctx.fillText(subtitleText, W / 2, H * 0.72);

    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 8;
    return tex;
}

// Some islands paint their ground rather than take a flat theme colour, so the
// turf itself says where in the world the player is standing. The painter draws
// into a square canvas that is then wrapped over the island cylinder — the top
// face samples the middle of the texture, which is where the pattern lives.
const GROUND_PAINTER = {
    // Cortical.io is in Vienna: the Austrian flag's red-white-red bands run
    // across the island so the ground reads as Austrian soil from the air.
    'Cortical.io': (ctx, S) => {
        const bands = [
            ['#d8232a', 0.00, 0.30],
            ['#f4f4f2', 0.30, 0.70],
            ['#d8232a', 0.70, 1.00]
        ];
        for (const [color, from, to] of bands) {
            ctx.fillStyle = color;
            ctx.fillRect(0, S * from, S, S * (to - from));
        }
        // Faint grass speckle so the flag still reads as ground, not as vinyl.
        ctx.globalAlpha = 0.10;
        for (let i = 0; i < 900; i++) {
            ctx.fillStyle = i % 2 ? '#4a7d3a' : '#2f5a24';
            const r = 2 + Math.random() * 5;
            ctx.beginPath();
            ctx.arc(Math.random() * S, Math.random() * S, r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    },

    // The Hellenic Army stint is the jungle island: deep, mottled undergrowth
    // under a dense canopy rather than open beach sand.
    'Hellenic Army': (ctx, S) => {
        ctx.fillStyle = '#255c22';
        ctx.fillRect(0, 0, S, S);
        // Layered blotches build a mulchy forest floor out of flat fills.
        const shades = ['#1c4a1b', '#2f7029', '#3d8a33', '#173d18', '#4f9638'];
        for (let i = 0; i < 1400; i++) {
            ctx.fillStyle = shades[i % shades.length];
            ctx.globalAlpha = 0.35 + Math.random() * 0.4;
            const r = 4 + Math.random() * 22;
            ctx.beginPath();
            ctx.arc(Math.random() * S, Math.random() * S, r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }
};

// The first Upstream visit (zone index 3): a marble plaza inlaid with a
// bold orange chevron mosaic, echoing the company's orange upward-arrow
// mark against white — it doubles as the sanctuary's temple floor for the
// mythology set dressing that island also carries (see _dressMythology).
function paintUpstreamGround(ctx, S) {
    ctx.fillStyle = '#f4f1e8';
    ctx.fillRect(0, 0, S, S);

    // Marble veining: faint grey-warm streaks under the mosaic.
    ctx.strokeStyle = 'rgba(150, 140, 120, 0.18)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 22; i++) {
        ctx.beginPath();
        let x = Math.random() * S;
        let y = Math.random() * S;
        ctx.moveTo(x, y);
        for (let s = 0; s < 5; s++) {
            x += (Math.random() - 0.5) * 90;
            y += (Math.random() - 0.5) * 90;
            ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    // Stacked chevrons ("^") pointing toward canvas top — the island's north,
    // the direction the player walks toward the temple — echoing an upward
    // arrow: wide at the rim, narrowing as they converge toward the centre.
    const cx = S / 2, cy = S / 2;
    ctx.strokeStyle = '#e8720c';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const rings = 6;
    for (let r = 0; r < rings; r++) {
        const t = r / (rings - 1);
        const width = S * (0.62 - t * 0.42);
        const depth = S * (0.16 - t * 0.09);
        const y = cy + S * 0.34 - t * S * 0.48;
        ctx.lineWidth = 10 - t * 5;
        ctx.globalAlpha = 0.9 - t * 0.25;
        ctx.beginPath();
        ctx.moveTo(cx - width / 2, y);
        ctx.lineTo(cx, y - depth);
        ctx.lineTo(cx + width / 2, y);
        ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Thin orange rim ring near the island edge, tying the mosaic to the
    // rocky border.
    ctx.strokeStyle = 'rgba(232, 114, 12, 0.55)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, S * 0.47, 0, Math.PI * 2);
    ctx.stroke();
}

// The second Upstream visit (zone index 6, not keyed by company since
// "Upstream" is also the first stint's jungle-free grass island): a frozen,
// snow-and-ice ground to match the chilly atmosphere that island turns to —
// see Game._updateAtmosphere and World._updateSnowfall.
function paintIceGround(ctx, S) {
    ctx.fillStyle = '#dce8f2';
    ctx.fillRect(0, 0, S, S);
    // Cracked-ice veins, and pale drifts of packed snow.
    ctx.strokeStyle = 'rgba(150, 180, 210, 0.5)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 40; i++) {
        ctx.beginPath();
        let x = Math.random() * S;
        let y = Math.random() * S;
        ctx.moveTo(x, y);
        for (let s = 0; s < 4; s++) {
            x += (Math.random() - 0.5) * 60;
            y += (Math.random() - 0.5) * 60;
            ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 700; i++) {
        ctx.fillStyle = i % 3 ? '#f4f9ff' : '#c3d8ea';
        const r = 3 + Math.random() * 14;
        ctx.beginPath();
        ctx.arc(Math.random() * S, Math.random() * S, r, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

// A stylised world map for the Camunda globe: ocean blue with hand-plotted
// landmasses. The shapes are deliberately loose — at globe scale the point is
// that it reads instantly as Earth, not that the coastlines are survey-grade.
let earthTexture = null;
function makeEarthTexture() {
    if (earthTexture) return earthTexture;

    const W = 1024;
    const H = 512;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Ocean, with a lighter band at the equator so the sphere has depth.
    const sea = ctx.createLinearGradient(0, 0, 0, H);
    sea.addColorStop(0, '#1d4f7a');
    sea.addColorStop(0.5, '#2a74a8');
    sea.addColorStop(1, '#1d4f7a');
    ctx.fillStyle = sea;
    ctx.fillRect(0, 0, W, H);

    // Landmasses as closed polygons in equirectangular (x = lon, y = lat) space.
    // Coordinates are fractions of the canvas.
    const land = [
        // North America
        [[0.13, 0.14], [0.30, 0.15], [0.31, 0.28], [0.25, 0.36], [0.22, 0.50],
         [0.18, 0.42], [0.15, 0.30], [0.09, 0.24]],
        // Greenland
        [[0.30, 0.07], [0.38, 0.08], [0.36, 0.17], [0.30, 0.15]],
        // South America
        [[0.24, 0.55], [0.31, 0.54], [0.33, 0.66], [0.29, 0.84], [0.25, 0.78],
         [0.23, 0.64]],
        // Africa
        [[0.46, 0.40], [0.57, 0.38], [0.58, 0.52], [0.53, 0.74], [0.48, 0.62],
         [0.45, 0.50]],
        // Europe
        [[0.46, 0.20], [0.57, 0.19], [0.56, 0.33], [0.47, 0.36], [0.44, 0.28]],
        // Asia
        [[0.57, 0.16], [0.82, 0.14], [0.85, 0.30], [0.76, 0.44], [0.66, 0.42],
         [0.58, 0.34]],
        // India
        [[0.66, 0.42], [0.72, 0.41], [0.70, 0.54], [0.66, 0.46]],
        // Australia
        [[0.78, 0.62], [0.90, 0.61], [0.91, 0.74], [0.80, 0.75]],
        // Antarctica
        [[0.00, 0.93], [1.00, 0.93], [1.00, 1.00], [0.00, 1.00]]
    ];

    ctx.fillStyle = '#3f8f43';
    ctx.strokeStyle = '#2f6f34';
    ctx.lineWidth = 3;
    for (const poly of land) {
        ctx.beginPath();
        poly.forEach(([x, y], i) => {
            const px = x * W;
            const py = y * H;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    }

    // Desert and ice tints over the appropriate bands.
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#d9c07a';
    ctx.fillRect(0.44 * W, 0.40 * H, 0.14 * W, 0.09 * H);   // Sahara
    ctx.fillRect(0.79 * W, 0.62 * H, 0.10 * W, 0.08 * H);   // Outback
    ctx.fillStyle = '#eaf2f7';
    ctx.fillRect(0, 0, W, 0.06 * H);                        // Arctic
    ctx.globalAlpha = 1;

    // A few swirls of cloud so it does not look like a flat map decal.
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    for (let i = 0; i < 34; i++) {
        const cx = Math.random() * W;
        const cy = 0.1 * H + Math.random() * 0.8 * H;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 24 + Math.random() * 60, 8 + Math.random() * 14, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    earthTexture = new THREE.CanvasTexture(canvas);
    earthTexture.colorSpace = THREE.SRGBColorSpace;
    earthTexture.anisotropy = 8;
    return earthTexture;
}

// Islands whose own set dressing fills the ground, so the generic palm-and-rock
// scatter is skipped: it would only screen the props the island exists to show.
const GENERIC_SCENERY_SKIP = new Set([
    'Hellenic Army',      // jungle canopy
    'Upstream',           // sanctuary of statues
    'Cortical.io',        // Vienna
    'Camunda',            // marketplace
    'European Dynamics',  // pirate beach
    'Intracom Telecom'    // town square
]);

const groundTextureCache = new Map();
function makeGroundTexture(painter) {
    if (!groundTextureCache.has(painter)) {
        const S = 512;
        const canvas = document.createElement('canvas');
        canvas.width = S;
        canvas.height = S;
        const ctx = canvas.getContext('2d');
        painter(ctx, S);
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        groundTextureCache.set(painter, tex);
    }
    return groundTextureCache.get(painter);
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
        this.npcs = [];         // destructible set-dressing figures (the cat, the giant, graduates, soldiers)
        this.zones = [];
        this.colliders = [];   // static boxes the player cannot walk through
        this.platforms = [];   // walkable surfaces {x,z,radius,y} for ground height
        this.occluders = [];   // meshes the chase camera must not end up inside
        this.logoPanels = [];  // company logo panels, spun in update()
        this.smokestacks = []; // factory chimneys that emit smoke puffs
        this.brokenDebris = [];
        this.snowflakes = [];   // active flakes over the second Upstream island
        this._snowIntensity = 0; // 0-1, set by Game._updateAtmosphere via setSnow()

        this._build();
    }

    _build() {
        this._buildSky();
        this._buildSpace();
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
            // transparent + depthWrite:false so it can fade out under the
            // star sky (_buildSpace) without a hard depth-sorted seam — the
            // two spheres cross-fade rather than one clipping the other.
            new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, transparent: true, depthWrite: false })
        );
        this.scene.add(sky);
        this.daySky = sky;

        // A few slab clouds; cheap, and they sell the cartoon look. One
        // shared material, so fading them out once in space (setSpaceAmount)
        // is a single opacity write rather than touching all 26 groups.
        const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, fog: false, depthWrite: false });
        this.cloudMat = cloudMat;
        this._cloudBaseOpacity = 0.85;
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

    // The flight easter egg's destination: a starfield, a distant sun, the
    // whole island chain's planet seen as a curved Earth below, and a real
    // landable moon. Everything here starts fully transparent/hidden — Game's
    // _updateSpaceAltitude fades it in by altitude once the player flies high
    // enough over Cortical.io, via setSpaceAmount() below.
    _buildSpace() {
        this.spaceAmount = 0;

        // A star sphere just inside the sky sphere (which is radius 600),
        // fog-exempt like the sky so distance haze never dims it, faded in by
        // opacity rather than swapped for the daytime sky so the transition
        // can cross-fade.
        const starCanvas = document.createElement('canvas');
        starCanvas.width = 512;
        starCanvas.height = 512;
        const sctx = starCanvas.getContext('2d');
        sctx.fillStyle = '#04040c';
        sctx.fillRect(0, 0, 512, 512);
        for (let i = 0; i < 900; i++) {
            const r = Math.random() < 0.15 ? 1.6 : 0.8;
            sctx.fillStyle = Math.random() < 0.2 ? '#bcd4ff' : '#ffffff';
            sctx.globalAlpha = 0.4 + Math.random() * 0.6;
            sctx.beginPath();
            sctx.arc(Math.random() * 512, Math.random() * 512, r, 0, Math.PI * 2);
            sctx.fill();
        }
        sctx.globalAlpha = 1;
        const starTex = new THREE.CanvasTexture(starCanvas);
        starTex.wrapS = starTex.wrapT = THREE.RepeatWrapping;
        starTex.repeat.set(6, 6);
        this.starSky = new THREE.Mesh(
            new THREE.SphereGeometry(580, 24, 16),
            new THREE.MeshBasicMaterial({
                map: starTex, side: THREE.BackSide, fog: false,
                transparent: true, opacity: 0, depthWrite: false
            })
        );
        this.scene.add(this.starSky);

        // The sun: a small bright disc, unlit and far off so it never moves
        // relative to the player — space's version of the sky sphere's own
        // gradient standing in for daylight.
        this.spaceSun = new THREE.Mesh(
            new THREE.SphereGeometry(26, 20, 16),
            new THREE.MeshBasicMaterial({ color: 0xfff6d8, fog: false, transparent: true, opacity: 0, depthWrite: false })
        );
        this.spaceSun.position.set(-380, 420, ZONE_SPACING * 3);
        this.scene.add(this.spaceSun);
        const sunGlow = new THREE.Mesh(
            new THREE.SphereGeometry(46, 16, 12),
            new THREE.MeshBasicMaterial({
                color: 0xfff0b0, fog: false, transparent: true, opacity: 0,
                side: THREE.BackSide, depthWrite: false
            })
        );
        sunGlow.position.copy(this.spaceSun.position);
        this.scene.add(sunGlow);
        this.spaceSunGlow = sunGlow;

        // Earth: the same painted texture used for the Camunda desk globe,
        // seen for real this time — a big curved horizon under the player,
        // centred on the island chain so "look down" reads as "there's the
        // world I've been walking on".
        const chainLength = (this.data.workExperience.length + 4) * ZONE_SPACING;
        this.spaceEarth = new THREE.Mesh(
            new THREE.SphereGeometry(520, 40, 30),
            new THREE.MeshBasicMaterial({ map: makeEarthTexture(), fog: false, transparent: true, opacity: 0, depthWrite: false })
        );
        this.spaceEarth.position.set(0, -500, chainLength / 2);
        this.scene.add(this.spaceEarth);

        this._buildMoonDestination();
    }

    // A real, landable moon — far to the side of the island chain and high
    // enough that reaching it means committing to a proper climb through the
    // space threshold first. Registered as an ordinary platform, so the
    // existing groundHeightAt/land flow (the same one every island uses)
    // handles touchdown for free.
    _buildMoonDestination() {
        const moon = new THREE.Group();
        moon.position.copy(MOON_CENTER);

        const craterCanvas = document.createElement('canvas');
        craterCanvas.width = 512;
        craterCanvas.height = 512;
        const mctx = craterCanvas.getContext('2d');
        mctx.fillStyle = '#c7c2ba';
        mctx.fillRect(0, 0, 512, 512);
        for (let i = 0; i < 60; i++) {
            const r = 8 + Math.random() * 30;
            const x = Math.random() * 512;
            const y = Math.random() * 512;
            mctx.fillStyle = 'rgba(130,124,112,0.5)';
            mctx.beginPath(); mctx.arc(x, y, r, 0, Math.PI * 2); mctx.fill();
            mctx.fillStyle = 'rgba(230,226,216,0.5)';
            mctx.beginPath(); mctx.arc(x - r * 0.25, y - r * 0.25, r * 0.6, 0, Math.PI * 2); mctx.fill();
        }
        const moonTex = new THREE.CanvasTexture(craterCanvas);
        moonTex.colorSpace = THREE.SRGBColorSpace;

        const body = new THREE.Mesh(
            new THREE.SphereGeometry(MOON_RADIUS, 28, 20),
            new THREE.MeshLambertMaterial({ map: moonTex })
        );
        moon.add(body);
        this.occluders.push(body);

        // A flat landing platform set into the top of the sphere, textured to
        // match, rather than trying to walk on the sphere's curve.
        const padY = MOON_RADIUS - 0.6;
        const pad = new THREE.Mesh(
            new THREE.CylinderGeometry(7, 7.4, 1.4, 24),
            new THREE.MeshLambertMaterial({ map: moonTex })
        );
        pad.position.y = padY;
        moon.add(pad);

        // A little flag, planted — the "one small step" beat.
        const flagGroup = new THREE.Group();
        const pole = new THREE.Mesh(
            new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6),
            new THREE.MeshLambertMaterial({ color: 0xd8d8d8 })
        );
        pole.position.y = 1.2;
        flagGroup.add(pole);
        const cloth = new THREE.Mesh(
            new THREE.PlaneGeometry(1.1, 0.7),
            new THREE.MeshLambertMaterial({ color: 0xe4483c, side: THREE.DoubleSide })
        );
        cloth.position.set(0.55, 2.05, 0);
        flagGroup.add(cloth);
        flagGroup.position.set(3, padY + 0.7, -2);
        moon.add(flagGroup);

        this.scene.add(moon);
        this.moonGroup = moon;

        this.platforms.push({
            x: MOON_CENTER.x, z: MOON_CENTER.z,
            radius: 7, y: MOON_CENTER.y + padY + 0.7
        });
    }

    // Blends the sky between daytime (0) and space (1) — see SPACE_START/
    // SPACE_FULL in Game's altitude read. Reused every frame while flying, so
    // this only touches opacities rather than rebuilding anything.
    setSpaceAmount(t) {
        this.spaceAmount = t;
        this.daySky.material.opacity = 1 - t;
        this.starSky.material.opacity = t;
        this.spaceSun.material.opacity = t;
        this.spaceSunGlow.material.opacity = t * 0.6;
        this.spaceEarth.material.opacity = t;
        // The literal ocean plane is part of the island-chain scale, not the
        // planet — without fading it out too, its far edge stays visible as a
        // flat teal wall poking into an otherwise black sky once high enough
        // to be looking down past it.
        this.ocean.material.opacity = 0.92 * (1 - t);
        // Clouds belong to the daytime sky layer (y ~45-85) — floating white
        // puffs against a starfield read as debris, not weather, so they fade
        // out on the same curve as the day sky itself.
        this.cloudMat.opacity = this._cloudBaseOpacity * (1 - t);
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

        // Island disc, slightly domed by scaling a cylinder. A few companies
        // paint their own ground (see GROUND_PAINTER) instead of a flat colour.
        // Both Upstream visits are checked by index rather than company, since
        // "Upstream" names both the orange-and-white first stint (index 3)
        // and the frozen second stint (index 6).
        const painter = index === 3 ? paintUpstreamGround
            : index === 6 ? paintIceGround
            : GROUND_PAINTER[exp.company];
        const groundMat = painter
            ? new THREE.MeshLambertMaterial({ map: makeGroundTexture(painter) })
            : new THREE.MeshLambertMaterial({ color: theme.ground });
        const island = new THREE.Mesh(
            new THREE.CylinderGeometry(ZONE_RADIUS, ZONE_RADIUS - 2.5, 6, 32),
            groundMat
        );
        island.position.y = -3;
        island.receiveShadow = true;
        group.add(island);

        // Rocky rim so the edge does not look like a cut-out. Burnt-orange
        // on the first Upstream visit and icy pale-blue on the second, to
        // match each island's ground.
        const rim = new THREE.Mesh(
            new THREE.TorusGeometry(ZONE_RADIUS - 0.4, 0.7, 6, 32),
            new THREE.MeshLambertMaterial({
                color: index === 3 ? 0xe8720c : index === 6 ? 0xaecbe0 : theme.rock
            })
        );
        rim.rotation.x = Math.PI / 2;
        rim.position.y = -0.3;
        group.add(rim);

        this.platforms.push({ x: center.x, z: center.z, radius: ZONE_RADIUS - 0.8, y: 0 });

        // Palms and rocks for scenery, kept clear of the walking path. Islands
        // that bring their own scenery (jungle, marketplace, sanctuary…) skip
        // the generic palms — otherwise the trunks screen the props that are
        // the whole reason to visit that island.
        if (!GENERIC_SCENERY_SKIP.has(exp.company)) {
            for (let i = 0; i < 7; i++) {
                const angle = (i / 7) * Math.PI * 2 + index;
                const dist = ZONE_RADIUS - 3 - Math.random() * 2;
                const px = Math.cos(angle) * dist;
                const pz = Math.sin(angle) * dist;
                // Keep the whole north-south corridor clear: this is the path
                // the player walks between bridges, and a trunk in it blocks it.
                if (Math.abs(px) < 7) continue;
                if (i % 2 === 0) this._addPalm(group, px, pz, center);
                else this._addRock(group, px, pz, theme, center);
            }
        }

        // Company-specific set dressing: each island gets props that say where
        // in the world (and in the career) the player is standing.
        this._decorateZone(exp, group, center);

        // Role totem: one per island, set off to the side so it never sits
        // between the chase camera and the player as they enter from the
        // south, but close enough to the walking corridor to be easy to read
        // on the way past.
        const totem = this._buildTotem(exp, theme);
        // The board's painted faces are its ±z sides, and the player always
        // arrives from the south (−z) walking north. Facing the board's +z
        // side south — rotation.y ≈ π — squares the text to the chase camera
        // on approach; the slight kick turns it toward the walking corridor.
        //
        // Sits out at the rim rather than mid-island: closer in it would mask
        // whatever stood behind it from most angles. Scaled up (1 rather than
        // the old 0.82) and closer to the corridor so the text reads clearly
        // without needing to detour off the path.
        totem.position.set(-9.5, 0, -6.5);
        totem.rotation.y = Math.PI - 0.5;
        group.add(totem);
        this.occluders.push(totem);
        this.colliders.push({
            x: center.x - 9.5, z: center.z - 6.5, halfX: 1.1, halfZ: 1.1, top: 5.9
        });

        // The year, floating in the sky off the island's west side (the
        // player's left as they walk the north-south corridor). Low enough
        // to catch on a normal zoomed-out view rather than needing the
        // camera tilted steeply upward to find it.
        const startYear = (exp.startDate.match(/\d{4}/) || [])[0] || exp.startDate;
        const yearSign = makeLabelSprite(startYear, {
            fontSize: 60, color: '#ffe0a0', bg: 'rgba(20,12,8,0.7)', worldWidth: 6
        });
        yearSign.position.set(-ZONE_RADIUS - 6, 9, 0);
        group.add(yearSign);

        // The company landmark anchors the far side of the island, so the
        // player walks toward it and past it on the way to the next zone.
        // Kept well north of the spawn so it never crowds the opening view.
        // Camunda's ziggurat is pulled in closer to the centre than the rest:
        // at the standard 9.5 its full 8.5-wide base tier sat right across
        // the north corridor and visually walled off the bridge to the next
        // island as the player approached.
        const LANDMARK_SCALE = 0.78;
        const landmarkZ = exp.company === 'Camunda' ? 6 : 9.5;
        const landmark = this._buildLandmark(
            exp, theme, new THREE.Vector3(center.x, 0, center.z + landmarkZ), LANDMARK_SCALE
        );
        landmark.position.set(0, 0, landmarkZ);
        landmark.scale.setScalar(LANDMARK_SCALE);
        group.add(landmark);
        // Deliberately NOT an occluder: the player walks through these, so
        // pulling the camera in on every wall would collapse the view to the
        // player's back each time they pass under an arch. The landmark
        // registers its own colliders inside _buildLandmark.

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

        // A crate holding the role itself, always present. Parked clear of the
        // island's central walking corridor so it never spawns on top of an
        // arriving player or in the mouth of the landmark's doorway.
        const roleCrate = new Crate({
            position: new THREE.Vector3(center.x + 5.2, 0.75, center.z + 1.5),
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

        // `index` is the chronological slot, which is what the costume system
        // keys off: company name alone cannot tell the two Upstream stints
        // apart, and they wear different things.
        return { center, exp, theme, group, index };
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

    // Every landmark is a walk-through: the player enters from the south, passes
    // under the arch/doorway and comes out onto the next bridge. Two things must
    // therefore stay clear of pickups.
    //
    // 1. The landmark footprint itself (local z ≈ +9.5): a crate sealed inside a
    //    collider can never be broken.
    // 2. The doorway corridor — the strip at |x| < DOOR_HALF running the length
    //    of the island. A crate parked in a doorway forces the player to smash
    //    it before they can walk through, which reads as a locked door.
    //
    // Anything landing in either is slid sideways out of the corridor, and only
    // pushed south as a fallback when there is no room either way.
    _clearOfLandmark(spot) {
        const LANDMARK_Z = 9.5;
        const KEEP_OUT = 4.6;
        const DOOR_HALF = 3.4;   // half-width of the protected walking corridor
        const SIDE = 5.0;        // where corridor intruders get parked instead

        let { x, z } = spot;

        // Slide out of the doorway corridor, keeping whichever side it started.
        if (Math.abs(x) < DOOR_HALF) {
            x = Math.sign(x || 1) * SIDE;
        }

        // If it still overlaps the landmark's mass, pull it south of the façade.
        if (Math.abs(x) < KEEP_OUT && Math.abs(z - LANDMARK_Z) < KEEP_OUT) {
            z = LANDMARK_Z - KEEP_OUT - 1.2;
        }

        return { x, z };
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
            // European Dynamics: a triumphal arch the player walks through on
            // the way north. The piers are set wide — the scaled gap has to
            // clear the player's 0.75 collision radius with room to spare, or
            // the "arch to pass through" becomes an arch to squeeze past.
            const PIER_X = 4.2;
            [-PIER_X, PIER_X].forEach((x) => {
                const pier = new THREE.Mesh(new THREE.BoxGeometry(1.7, 7, 2.4), stone);
                pier.position.set(x, 3.5, 0);
                pier.castShadow = true;
                landmark.add(pier);

                // Engaged half-columns dressing the inner face of each pier.
                const col = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.58, 6.4, 12), stone);
                col.position.set(x - Math.sign(x) * 0.85, 3.2, 1.2);
                col.castShadow = true;
                landmark.add(col);

                // Cornice block capping the pier.
                const cap = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.5, 2.8), stone);
                cap.position.set(x, 7.2, 0);
                landmark.add(cap);

                this.colliders.push({
                    x: center.x + x * scale, z: center.z,
                    halfX: 0.95 * scale, halfZ: 1.3 * scale, top: 7 * scale
                });
            });

            // The vault: a ring of voussoir blocks spanning the opening, drawn
            // as a half arc of boxes rotated about the springing line.
            const SPAN = PIER_X - 0.85;
            for (let i = 0; i <= 9; i++) {
                const a = (i / 9) * Math.PI;
                const voussoir = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.7, 2.4), stone);
                voussoir.position.set(Math.cos(a) * SPAN, 5.6 + Math.sin(a) * SPAN, 0);
                voussoir.rotation.z = a - Math.PI / 2;
                voussoir.castShadow = true;
                landmark.add(voussoir);
            }

            // Attic storey above the vault, the way a triumphal arch is topped.
            const attic = new THREE.Mesh(new THREE.BoxGeometry(11, 2.2, 2.8), stone);
            attic.position.y = 11.0;
            attic.castShadow = true;
            landmark.add(attic);
            const cornice = new THREE.Mesh(new THREE.BoxGeometry(11.8, 0.5, 3.2), stone);
            cornice.position.y = 12.4;
            landmark.add(cornice);

            // Quadriga-ish flourish: two horses on the attic, in silhouette.
            [-1.8, 1.8].forEach((hx) => {
                const horse = new THREE.Group();
                const bodyH = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.8, 4, 8), accent);
                bodyH.rotation.z = Math.PI / 2;
                horse.add(bodyH);
                const neckH = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 0.7, 7), accent);
                neckH.position.set(0.6, 0.36, 0);
                neckH.rotation.z = -0.6;
                horse.add(neckH);
                const headH = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.26, 4, 7), accent);
                headH.position.set(0.88, 0.62, 0);
                headH.rotation.z = -1.1;
                horse.add(headH);
                [[-0.42, 0.18], [-0.42, -0.18], [0.36, 0.18], [0.36, -0.18]].forEach(([lx, lz]) => {
                    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.7, 6), accent);
                    leg.position.set(lx, -0.5, lz);
                    horse.add(leg);
                });
                horse.position.set(hx, 13.0, 0);
                horse.castShadow = true;
                landmark.add(horse);
            });

            logoY = 4.6;     // hangs in the archway opening, at eye level
            blockRadius = 0; // the gap between the piers stays walkable

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
            // Pushed out to x = ±3.9 with narrower returns: the doorway has to
            // clear the player's 0.75 collision radius *after* the landmark's
            // 0.78 scale, and the earlier ±3.3 left barely a body's width, so
            // walking the hut caught a jamb corner and stopped dead.
            [-1, 1].forEach((zSide) => {
                [-1, 1].forEach((xSide) => {
                    const jamb = new THREE.Mesh(new THREE.BoxGeometry(1.6, WALL_H, 0.4), olive);
                    jamb.position.set(xSide * 3.9, WALL_H / 2, zSide * 2.8);
                    jamb.castShadow = true;
                    landmark.add(jamb);
                    this.colliders.push({
                        x: center.x + xSide * 3.9 * scale, z: center.z + zSide * 2.8 * scale,
                        halfX: 0.8 * scale, halfZ: 0.35 * scale, top: WALL_H * scale
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
        const postMat = new THREE.MeshLambertMaterial({ color: 0x6b4423 });

        // Two posts at the board's edges rather than one central post: a
        // single centred post used to cut straight across the title text from
        // the player's usual approach angle. Edge posts keep the whole face
        // clear while still reading as a proper signboard.
        const BOARD_W = 7.9;
        const BOARD_H = 2.95;
        const POST_TOP = 4.4 + BOARD_H / 2 - 0.3; // stops just short of the cap
        [-1, 1].forEach((side) => {
            const post = new THREE.Mesh(
                new THREE.CylinderGeometry(0.22, 0.3, POST_TOP, 8),
                postMat
            );
            post.position.set(side * (BOARD_W / 2 - 0.5), POST_TOP / 2, 0);
            post.castShadow = true;
            totem.add(post);
        });

        // The sign face is painted onto the board's front and back so the text
        // is readable from either side as the player circles the island.
        // Sized up from the original 5.4×2.0 plank — at the old size the title
        // shrank to fit and read as a thin line from the walking corridor.
        const signTex = makeSignTexture(
            exp.title,
            `${exp.company} · ${exp.startDate}–${exp.endDate}`
        );
        const plain = new THREE.MeshLambertMaterial({ color: 0x7d5228 });
        const faced = new THREE.MeshLambertMaterial({ map: signTex });
        // BoxGeometry material order: +x, -x, +y, -y, +z, -z
        const board = new THREE.Mesh(
            new THREE.BoxGeometry(BOARD_W, BOARD_H, 0.32),
            [plain, plain, plain, plain, faced, faced]
        );
        board.position.y = 4.4;
        board.castShadow = true;
        totem.add(board);

        return totem;
    }

    // A fellow graduate for the university temple: gown, mortarboard cap and
    // tassel, in one of a few gown colours so a cluster of them doesn't read
    // as clones. Destructible via _registerNPC, same as the cat and the giant.
    _buildGraduate() {
        const palette = [0x2a2f5c, 0x5c2a2a, 0x2a5c3a];
        const gownColor = palette[Math.floor(Math.random() * palette.length)];

        const grad = new THREE.Group();
        const gown = new THREE.MeshLambertMaterial({ color: gownColor });
        const skin = new THREE.MeshLambertMaterial({ color: 0xe0bb92 });
        const trim = new THREE.MeshLambertMaterial({ color: 0xd4af37 });
        const felt = new THREE.MeshLambertMaterial({ color: 0x1d2233 });

        const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.75, 4, 10), gown);
        torso.position.y = 1.2;
        torso.castShadow = true;
        grad.add(torso);

        // A sash of trim down the front, the way academic gowns are faced.
        const sash = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.1, 0.04), trim);
        sash.position.set(0, 1.2, 0.3);
        grad.add(sash);

        const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), skin);
        head.position.y = 1.92;
        grad.add(head);

        // Mortarboard, matching the university costume's cap but built fresh
        // here rather than shared — these figures have no rig to mount onto.
        const crown = new THREE.Mesh(
            new THREE.SphereGeometry(0.24, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), felt
        );
        crown.position.set(0, 2.02, 0);
        crown.scale.set(1, 0.6, 1);
        grad.add(crown);
        const board = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.03, 0.62), felt);
        board.position.set(0, 2.14, 0);
        board.rotation.y = Math.PI / 4;
        board.castShadow = true;
        grad.add(board);
        const button = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), trim);
        button.position.set(0, 2.16, 0);
        grad.add(button);
        const tassel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.025, 0.14, 8), trim);
        tassel.position.set(0.28, 2.08, 0);
        grad.add(tassel);

        const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.8, 8), gown);
        legs.position.y = 0.42;
        grad.add(legs);

        [-1, 1].forEach((side) => {
            const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.55, 4, 8), gown);
            arm.position.set(side * 0.4, 1.28, 0.04);
            arm.rotation.z = side * 0.24;
            grad.add(arm);

            const hand = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), skin);
            hand.position.set(side * 0.56, 0.96, 0.04);
            grad.add(hand);
        });

        return grad;
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

    // ---- per-company set dressing -----------------------------------------

    // Props are placed in island-local space. Two rules apply everywhere:
    //   * nothing in the corridor at |x| < 4, which is the walk-through route
    //     from the south bridge, through the landmark's doorway, to the north;
    //   * anything solid enough to stand next to gets a collider so the player
    //     bumps it instead of walking through it.
    _decorateZone(exp, group, center) {
        const decorate = {
            'Hellenic Army': () => this._dressJungle(group, center),
            'Cortical.io': () => this._dressVienna(group, center),
            'Upstream': () => this._dressMythology(group, center),
            'European Dynamics': () => this._dressPirates(group, center),
            'Intracom Telecom': () => this._dressTownLife(group, center),
            'Camunda': () => this._dressGlobalMarket(group, center)
        }[exp.company];
        if (decorate) decorate();
    }

    // Registers a collider in world space for a prop placed at island-local
    // (x, z). Props are added to zone groups, which are positioned at `center`,
    // but colliders live in world coordinates.
    _prop(center, x, z, halfX, halfZ, top) {
        this.colliders.push({ x: center.x + x, z: center.z + z, halfX, halfZ, top });
    }

    // Registers a set-dressing figure (the cat, the giant, the graduates) as
    // destructible: the player can attack it like a crate. `group` is the
    // built mesh group, already positioned in world space. Unlike crates,
    // breaking one doesn't open a resume page — it's just a fun aside — so
    // this only needs a hit test and a collapse animation, not a payload.
    _registerNPC(group, worldX, worldZ, radius, height) {
        const npc = {
            group, broken: false,
            position: new THREE.Vector3(worldX, 0, worldZ),
            radius, height,
            collapseT: 0
        };
        this.npcs.push(npc);
        return npc;
    }

    _updateNPCs(dt) {
        for (const npc of this.npcs) {
            if (!npc.broken) continue;
            // Sinks into the ground and shrinks over half a second, then is
            // removed — reads as a comical squash-and-drop rather than gore.
            npc.collapseT += dt;
            const t = Math.min(1, npc.collapseT / 0.5);
            npc.group.position.y = -t * npc.height * 0.6;
            const scale = Math.max(0.001, 1 - t);
            npc.group.scale.set(scale, scale, scale);
            if (t >= 1 && npc.group.parent) {
                npc.group.parent.remove(npc.group);
            }
        }
    }

    // (b) Hellenic Army — a dense jungle: tall buttressed hardwoods, a bamboo
    // thicket, ferns, hanging vines and undergrowth, packed to the island's rim.
    _dressJungle(group, center) {
        const barkMat = new THREE.MeshLambertMaterial({ color: 0x5b4126 });
        const canopyMats = [0x1e5e21, 0x2a7a2c, 0x35913a, 0x184d1c].map(
            (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true })
        );

        // Big canopy trees ringing the island. Trunks are tall and slim with a
        // flared base; the canopy is a stack of shrinking spheres so it reads as
        // a broadleaf crown rather than a palm.
        const treeSpots = [];
        for (let ring = 0; ring < 2; ring++) {
            const count = ring === 0 ? 9 : 7;
            const radius = ring === 0 ? ZONE_RADIUS - 2.2 : ZONE_RADIUS - 6.4;
            for (let i = 0; i < count; i++) {
                const a = (i / count) * Math.PI * 2 + ring * 0.4;
                const x = Math.cos(a) * radius;
                const z = Math.sin(a) * radius;
                if (Math.abs(x) < 4.6) continue;                 // walking corridor
                if (Math.abs(x) < 6 && z > 4) continue;          // landmark apron
                treeSpots.push([x, z]);
            }
        }

        treeSpots.forEach(([x, z], i) => {
            const tree = new THREE.Group();
            const h = 7 + (i % 3) * 1.6;
            const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.62, h, 8), barkMat);
            trunk.position.y = h / 2;
            trunk.castShadow = true;
            tree.add(trunk);

            // Buttress roots: three wedges splayed around the base.
            for (let r = 0; r < 3; r++) {
                const a = (r / 3) * Math.PI * 2 + i;
                const root = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.6, 4), barkMat);
                root.position.set(Math.cos(a) * 0.5, 0.8, Math.sin(a) * 0.5);
                root.rotation.z = -Math.cos(a) * 0.35;
                root.rotation.x = Math.sin(a) * 0.35;
                tree.add(root);
            }

            // Crown: overlapping spheres, largest at the bottom.
            for (let c = 0; c < 4; c++) {
                const blob = new THREE.Mesh(
                    new THREE.SphereGeometry(2.5 - c * 0.42, 9, 7),
                    canopyMats[(i + c) % canopyMats.length]
                );
                blob.position.set(
                    Math.sin(i + c) * 1.1,
                    h + c * 0.9,
                    Math.cos(i + c) * 1.1
                );
                blob.scale.y = 0.78;
                blob.castShadow = true;
                tree.add(blob);
            }

            // A vine or two dangling from the crown.
            if (i % 2 === 0) {
                const vine = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.06, 0.06, 3.4, 5),
                    canopyMats[0]
                );
                vine.position.set(1.5, h - 0.6, 0.7);
                tree.add(vine);
            }

            tree.position.set(x, 0, z);
            group.add(tree);
            this.occluders.push(tree);
            this._prop(center, x, z, 0.75, 0.75, h);
        });

        // Bamboo thickets: clumps of thin poles with segment rings.
        const bambooMat = new THREE.MeshLambertMaterial({ color: 0x8fae3f });
        [[-9.5, -7], [10, -6.5], [-11, 4.5], [11, 5]].forEach(([bx, bz], k) => {
            const clump = new THREE.Group();
            for (let i = 0; i < 7; i++) {
                const h = 4.5 + Math.random() * 3;
                const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, h, 6), bambooMat);
                pole.position.set(
                    (Math.random() - 0.5) * 1.8,
                    h / 2,
                    (Math.random() - 0.5) * 1.8
                );
                pole.rotation.z = (Math.random() - 0.5) * 0.18;
                pole.castShadow = true;
                clump.add(pole);

                // Leaf sprays near the top of each pole.
                for (let l = 0; l < 3; l++) {
                    const leaf = new THREE.Mesh(
                        new THREE.ConeGeometry(0.16, 1.1, 4),
                        canopyMats[2]
                    );
                    const a = (l / 3) * Math.PI * 2;
                    leaf.position.set(
                        pole.position.x + Math.cos(a) * 0.4,
                        h * 0.86,
                        pole.position.z + Math.sin(a) * 0.4
                    );
                    leaf.rotation.z = Math.cos(a) * 0.9;
                    leaf.rotation.x = -Math.sin(a) * 0.9;
                    clump.add(leaf);
                }
            }
            clump.position.set(bx, 0, bz);
            group.add(clump);
            this.occluders.push(clump);
            this._prop(center, bx, bz, 1.1, 1.1, 5);
        });

        // Ferns and undergrowth: low, walkable, no colliders — they dress the
        // floor without turning the island into an obstacle course.
        const fernMat = new THREE.MeshLambertMaterial({
            color: 0x3f9c3a, side: THREE.DoubleSide, flatShading: true
        });
        for (let i = 0; i < 46; i++) {
            const a = Math.random() * Math.PI * 2;
            const d = 3 + Math.random() * (ZONE_RADIUS - 4);
            const x = Math.cos(a) * d;
            const z = Math.sin(a) * d;
            if (Math.abs(x) < 4.2) continue;
            const fern = new THREE.Group();
            for (let f = 0; f < 5; f++) {
                const frond = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.5, 4), fernMat);
                const fa = (f / 5) * Math.PI * 2;
                frond.position.set(Math.cos(fa) * 0.3, 0.7, Math.sin(fa) * 0.3);
                frond.rotation.z = Math.cos(fa) * 0.8;
                frond.rotation.x = -Math.sin(fa) * 0.8;
                fern.add(frond);
            }
            fern.position.set(x, 0, z);
            fern.scale.setScalar(0.7 + Math.random() * 0.6);
            group.add(fern);
        }

        // A splash of jungle flowers so the green has some relief.
        const petalMats = [0xe0503a, 0xe8a13c, 0xd94f8a].map(
            (c) => new THREE.MeshLambertMaterial({ color: c })
        );
        for (let i = 0; i < 18; i++) {
            const a = Math.random() * Math.PI * 2;
            const d = 5 + Math.random() * (ZONE_RADIUS - 7);
            const x = Math.cos(a) * d;
            const z = Math.sin(a) * d;
            if (Math.abs(x) < 4.2) continue;
            const bloom = new THREE.Mesh(
                new THREE.SphereGeometry(0.26, 8, 6),
                petalMats[i % petalMats.length]
            );
            bloom.position.set(x, 0.5, z);
            group.add(bloom);
        }

        // --- the squad -------------------------------------------------------
        // Soldiers posted around the island: two standing guard either side of
        // the barracks approach, one at ease by the bamboo, and one crouched
        // behind the sandbags. Built from primitives, in the same flat-shaded
        // style as the island's other figures.
        const buildSoldier = (pose) => {
            const soldier = new THREE.Group();
            const olive = new THREE.MeshLambertMaterial({ color: 0x4a5535 });
            const oliveDark = new THREE.MeshLambertMaterial({ color: 0x39422a });
            const skinS = new THREE.MeshLambertMaterial({ color: 0xd9a878 });
            const bootMat = new THREE.MeshLambertMaterial({ color: 0x2a2119 });
            const steel = new THREE.MeshLambertMaterial({ color: 0x4b5058 });

            const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.44, 6, 12), olive);
            torso.position.y = 1.06;
            torso.castShadow = true;
            soldier.add(torso);

            // Webbing across the chest.
            const belt = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.028, 6, 16),
                new THREE.MeshLambertMaterial({ color: 0x6b6244 }));
            belt.position.y = 0.86;
            belt.rotation.x = Math.PI / 2;
            belt.scale.set(1, 1, 0.8);
            soldier.add(belt);

            const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 14), skinS);
            head.position.y = 1.5;
            head.castShadow = true;
            soldier.add(head);

            // Steel helmet.
            const helm = new THREE.Mesh(
                new THREE.SphereGeometry(0.215, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.56),
                olive
            );
            helm.position.y = 1.52;
            helm.scale.set(1.05, 1, 1.1);
            helm.castShadow = true;
            soldier.add(helm);
            const helmBrim = new THREE.Mesh(new THREE.TorusGeometry(0.216, 0.03, 6, 18), olive);
            helmBrim.position.y = 1.5;
            helmBrim.rotation.x = Math.PI / 2;
            helmBrim.scale.set(1.05, 1.1, 1);
            soldier.add(helmBrim);

            [-1, 1].forEach((side) => {
                const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6),
                    new THREE.MeshLambertMaterial({ color: 0x1c1410 }));
                eye.position.set(side * 0.07, 1.46, 0.185);
                soldier.add(eye);

                const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.095, 0.42, 6, 10), oliveDark);
                leg.position.set(side * 0.11, 0.44, 0);
                leg.castShadow = true;
                soldier.add(leg);

                const boot = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.12, 0.24), bootMat);
                boot.position.set(side * 0.11, 0.09, 0.04);
                soldier.add(boot);
            });

            // Arms, and a rifle held across the body or shouldered.
            const armAngles = pose === 'guard' ? [0.22, -0.22] : [0.4, -0.32];
            armAngles.forEach((rz, i) => {
                const side = i === 0 ? -1 : 1;
                const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.4, 6, 10), olive);
                arm.position.set(side * 0.3, 1.02, pose === 'guard' ? 0.05 : 0.02);
                arm.rotation.z = rz;
                arm.castShadow = true;
                soldier.add(arm);

                const hand = new THREE.Mesh(new THREE.SphereGeometry(0.062, 10, 8), skinS);
                hand.position.set(side * 0.34, 0.76, pose === 'guard' ? 0.09 : 0.03);
                soldier.add(hand);
            });

            const rifle = new THREE.Group();
            const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.78, 0.05),
                new THREE.MeshLambertMaterial({ color: 0x5a3f22 }));
            rifle.add(stock);
            const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.5, 8), steel);
            barrel.position.y = 0.6;
            rifle.add(barrel);
            const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.04), steel);
            mag.position.set(0, -0.12, 0.06);
            rifle.add(mag);

            if (pose === 'guard') {
                // Held diagonally across the chest, at port arms.
                rifle.position.set(0.16, 1.06, 0.16);
                rifle.rotation.z = -0.5;
                rifle.rotation.x = -0.15;
            } else {
                // Shouldered, butt down beside the boot.
                rifle.position.set(0.3, 1.0, -0.04);
                rifle.rotation.z = 0.12;
            }
            rifle.castShadow = true;
            soldier.add(rifle);

            return soldier;
        };

        // Positions kept out of the walking corridor (|x| < 4.6) and clear of
        // the barracks apron to the north. Eight soldiers rather than four: two
        // at the barracks porch, two resting further back, and four more
        // posted along the southern approach and the eastern/western rim, so
        // the jungle island reads as properly garrisoned from any direction.
        [
            [-6.2, 2.0, 0.55, 'guard'],
            [6.4, 2.4, -0.5, 'guard'],
            [-8.8, -6.0, 1.9, 'rest'],
            [8.2, -7.2, -2.4, 'rest'],
            [-6.0, -9.5, 2.6, 'guard'],
            [6.2, -9.8, -2.6, 'guard'],
            [-11.2, 0.5, 1.4, 'rest'],
            [11.0, 1.8, -1.4, 'rest']
        ].forEach(([sx, sz, rot, pose]) => {
            const soldier = buildSoldier(pose);
            soldier.position.set(sx, 0, sz);
            soldier.rotation.y = rot;
            group.add(soldier);
            this.occluders.push(soldier);
            this._prop(center, sx, sz, 0.45, 0.45, 1.7);
            this._registerNPC(soldier, center.x + sx, center.z + sz, 0.6, 1.7);
        });
    }

    // (d) Cortical.io — Vienna. Red-and-white ground (see GROUND_PAINTER) plus a
    // second palace, a giant stein of beer, chocolate, a Sachertorte, a coffee
    // house table, a waltzing violin and a Riesenrad-style ferris wheel.
    _dressVienna(group, center) {
        // --- a second, smaller palace (Belvedere-ish) on the west side ---
        const wallMat = new THREE.MeshLambertMaterial({ color: 0xf3e6cd });
        const goldMat = new THREE.MeshLambertMaterial({ color: 0xe2b23f });
        const roofMat = new THREE.MeshLambertMaterial({ color: 0x5c6b78 });

        const palace = new THREE.Group();
        const block = new THREE.Mesh(new THREE.BoxGeometry(7, 4.2, 3.4), wallMat);
        block.position.y = 2.1;
        block.castShadow = true;
        palace.add(block);

        // Mansard roof and a central pavilion, the giveaway Baroque silhouette.
        const roof = new THREE.Mesh(new THREE.BoxGeometry(7.4, 1.1, 3.8), roofMat);
        roof.position.y = 4.7;
        roof.castShadow = true;
        palace.add(roof);

        const pavilion = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.8, 3.6), wallMat);
        pavilion.position.y = 5.5;
        palace.add(pavilion);
        const pavRoof = new THREE.Mesh(new THREE.ConeGeometry(2.3, 1.8, 4), roofMat);
        pavRoof.position.y = 7.2;
        pavRoof.rotation.y = Math.PI / 4;
        pavRoof.castShadow = true;
        palace.add(pavRoof);
        const finial = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), goldMat);
        finial.position.y = 8.2;
        palace.add(finial);

        // Windows and pilasters across the façade.
        const glass = new THREE.MeshLambertMaterial({ color: 0x3b5566 });
        for (let i = 0; i < 5; i++) {
            const wx = -2.6 + i * 1.3;
            [1.4, 3.1].forEach((wy) => {
                const win = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.05, 0.12), glass);
                win.position.set(wx, wy, 1.74);
                palace.add(win);
            });
            const pil = new THREE.Mesh(new THREE.BoxGeometry(0.16, 4.2, 0.16), goldMat);
            pil.position.set(wx + 0.65, 2.1, 1.72);
            palace.add(pil);
        }

        palace.position.set(-10, 0, 1.5);
        palace.rotation.y = 0.5;
        group.add(palace);
        this.occluders.push(palace);
        this._prop(center, -10, 1.5, 3.6, 2.2, 4.2);

        // --- the beer: an oversized stein, the island's landmark prop ---
        const stein = new THREE.Group();
        const mugMat = new THREE.MeshLambertMaterial({ color: 0xf0ece2 });
        const beerMat = new THREE.MeshLambertMaterial({ color: 0xdc9a1e });
        const foamMat = new THREE.MeshLambertMaterial({ color: 0xfffaf0 });

        const mug = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.0, 2.6, 18, 1, true), mugMat);
        mug.material.side = THREE.DoubleSide;
        mug.position.y = 1.3;
        mug.castShadow = true;
        stein.add(mug);

        const beer = new THREE.Mesh(new THREE.CylinderGeometry(1.06, 0.95, 2.1, 18), beerMat);
        beer.position.y = 1.15;
        stein.add(beer);

        // Foam head: a cap plus a few overflowing blobs.
        const head = new THREE.Mesh(new THREE.CylinderGeometry(1.12, 1.08, 0.5, 18), foamMat);
        head.position.y = 2.45;
        stein.add(head);
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            const blob = new THREE.Mesh(new THREE.SphereGeometry(0.42, 9, 7), foamMat);
            blob.position.set(Math.cos(a) * 0.78, 2.72, Math.sin(a) * 0.78);
            blob.castShadow = true;
            stein.add(blob);
        }

        // Handle: a torus cut to a C and turned to face outward.
        const handle = new THREE.Mesh(
            new THREE.TorusGeometry(0.62, 0.15, 8, 14, Math.PI * 1.15), mugMat
        );
        handle.position.set(-1.25, 1.35, 0);
        handle.rotation.y = Math.PI / 2;
        handle.rotation.z = -Math.PI / 2.4;
        stein.add(handle);

        // Pewter lid, hinged open the way a real Maßkrug's is.
        const lid = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.16, 18),
            new THREE.MeshLambertMaterial({ color: 0xa8adb4 }));
        lid.position.set(0.5, 3.35, -0.6);
        lid.rotation.x = -0.9;
        stein.add(lid);

        stein.position.set(8.6, 0, -5.5);
        group.add(stein);
        this.occluders.push(stein);
        this._prop(center, 8.6, -5.5, 1.3, 1.3, 3);

        // --- chocolate: a stack of foil-wrapped bars and loose squares ---
        const cocoa = new THREE.MeshLambertMaterial({ color: 0x4a2c17 });
        const foil = new THREE.MeshLambertMaterial({ color: 0xc0182f });   // Mozartkugel red
        const goldFoil = new THREE.MeshLambertMaterial({ color: 0xdcb43c });

        const choc = new THREE.Group();
        for (let i = 0; i < 3; i++) {
            const bar = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.36, 1.1),
                i === 1 ? goldFoil : foil);
            bar.position.set((i % 2) * 0.25, 0.18 + i * 0.38, 0);
            bar.rotation.y = i * 0.22;
            bar.castShadow = true;
            choc.add(bar);
        }
        // Unwrapped squares beside the stack, in a broken-off row.
        for (let i = 0; i < 4; i++) {
            const sq = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.5), cocoa);
            sq.position.set(1.7 + (i % 2) * 0.58, 0.1, -0.7 + Math.floor(i / 2) * 0.58);
            sq.rotation.y = i * 0.3;
            choc.add(sq);
        }
        // A couple of Mozartkugel spheres in their red-and-gold foil.
        [[-1.6, 0.5], [-1.2, -0.8]].forEach(([cx, cz], i) => {
            const ball = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8),
                i === 0 ? foil : goldFoil);
            ball.position.set(cx, 0.34, cz);
            ball.castShadow = true;
            choc.add(ball);
        });
        choc.position.set(-7.4, 0, -7);
        group.add(choc);

        // --- Sachertorte on a café table, with a coffee cup ---
        const cafe = new THREE.Group();
        const tableTop = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.16, 18),
            new THREE.MeshLambertMaterial({ color: 0x7b4a2a }));
        tableTop.position.y = 1.5;
        tableTop.castShadow = true;
        cafe.add(tableTop);
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.2, 1.5, 8),
            new THREE.MeshLambertMaterial({ color: 0x2f2a26 }));
        stem.position.y = 0.75;
        cafe.add(stem);
        const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 0.12, 14),
            new THREE.MeshLambertMaterial({ color: 0x2f2a26 }));
        foot.position.y = 0.06;
        cafe.add(foot);

        // The torte: dark glaze, a cream rosette, and a wedge cut out.
        const torte = new THREE.Mesh(
            new THREE.CylinderGeometry(0.72, 0.72, 0.42, 20, 1, false, 0, Math.PI * 1.75), cocoa
        );
        torte.position.set(-0.35, 1.79, 0);
        torte.castShadow = true;
        cafe.add(torte);
        const cream = new THREE.Mesh(new THREE.SphereGeometry(0.17, 9, 7), foamMat);
        cream.position.set(-0.35, 2.06, 0.42);
        cafe.add(cream);

        // Coffee: the Wiener Melange it would be served with.
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.2, 0.32, 12), mugMat);
        cup.position.set(0.78, 1.74, 0.25);
        cafe.add(cup);
        const brew = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.05, 12),
            new THREE.MeshLambertMaterial({ color: 0x5b3620 }));
        brew.position.set(0.78, 1.9, 0.25);
        cafe.add(brew);
        const saucer = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.05, 14), mugMat);
        saucer.position.set(0.78, 1.6, 0.25);
        cafe.add(saucer);

        // Two bentwood chairs pulled up to the table.
        [[-1, 0.3], [1, -0.4]].forEach(([sx, sz]) => {
            const chair = new THREE.Group();
            const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 12),
                new THREE.MeshLambertMaterial({ color: 0x6b4326 }));
            seat.position.y = 0.95;
            chair.add(seat);
            const back = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.06, 6, 12, Math.PI),
                new THREE.MeshLambertMaterial({ color: 0x6b4326 }));
            back.position.set(0, 1.35, -0.34);
            back.rotation.x = -0.2;
            chair.add(back);
            for (let l = 0; l < 3; l++) {
                const a = (l / 3) * Math.PI * 2;
                const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.95, 6),
                    new THREE.MeshLambertMaterial({ color: 0x4a2f1c }));
                leg.position.set(Math.cos(a) * 0.28, 0.48, Math.sin(a) * 0.28);
                chair.add(leg);
            }
            chair.position.set(sx * 2.3, 0, sz * 2.3);
            cafe.add(chair);
        });

        cafe.position.set(-8.8, 0, 7.5);
        group.add(cafe);
        this._prop(center, -8.8, 7.5, 1.6, 1.6, 1.9);

        // --- the Riesenrad: Vienna's ferris wheel, turning slowly ---
        const wheel = new THREE.Group();
        const steel = new THREE.MeshLambertMaterial({ color: 0xb03a32 });
        const strut = new THREE.MeshLambertMaterial({ color: 0x54595f });

        const spinner = new THREE.Group();
        const R = 3.4;
        [0.28, -0.28].forEach((zOff) => {
            const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.12, 6, 26), steel);
            rim.position.z = zOff;
            spinner.add(rim);
        });
        // Spokes and the hanging gondolas.
        const cabinMat = new THREE.MeshLambertMaterial({ color: 0xd8232a });
        for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2;
            const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, R * 2, 5), steel);
            spoke.rotation.z = a;
            spinner.add(spoke);

            // Gondolas are parented to the rim but counter-rotated in update()
            // so they hang level as the wheel turns.
            const cabin = new THREE.Group();
            const box = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.5), cabinMat);
            box.position.y = -0.3;
            cabin.add(box);
            const roofC = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.08, 0.6),
                new THREE.MeshLambertMaterial({ color: 0xf0ece2 }));
            roofC.position.y = -0.02;
            cabin.add(roofC);
            cabin.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
            cabin.userData.spinAngle = a;
            spinner.add(cabin);
        }
        spinner.position.y = R + 2.2;
        wheel.add(spinner);
        this.ferrisWheels = this.ferrisWheels || [];
        this.ferrisWheels.push(spinner);

        // A-frame legs carrying the hub.
        [-1, 1].forEach((side) => {
            [-1, 1].forEach((zs) => {
                const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 6.2, 7), strut);
                leg.position.set(side * 1.5, 3.1, zs * 0.9);
                leg.rotation.z = -side * 0.42;
                leg.rotation.x = -zs * 0.2;
                leg.castShadow = true;
                wheel.add(leg);
            });
        });
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 1.1, 10), strut);
        hub.rotation.x = Math.PI / 2;
        hub.position.y = R + 2.2;
        wheel.add(hub);

        wheel.position.set(9.5, 0, 6.5);
        group.add(wheel);
        this.occluders.push(wheel);
        this._prop(center, 9.5, 6.5, 1.9, 1.2, 2.5);

        // --- a waltzing touch: violin resting against a music stand ---
        const violin = new THREE.Group();
        const woodMat = new THREE.MeshLambertMaterial({ color: 0x8a3f1e });
        const bodyV = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), woodMat);
        bodyV.scale.set(0.62, 1, 0.28);
        bodyV.position.y = 0.9;
        violin.add(bodyV);
        const waist = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), woodMat);
        waist.scale.set(0.62, 0.8, 0.28);
        waist.position.y = 1.35;
        violin.add(waist);
        const neck = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, 0.1),
            new THREE.MeshLambertMaterial({ color: 0x3a1d0d }));
        neck.position.y = 1.9;
        violin.add(neck);
        violin.position.set(-6.4, 0, 9);
        violin.rotation.z = 0.3;
        group.add(violin);
    }

    // (e) Upstream — Greek mythology: Medusa, a dryad in her tree, Athena, plus
    // a centaur and a Pegasus for good measure. Both Upstream stints get these,
    // which suits a company the career returns to.
    _dressMythology(group, center) {
        const marble = new THREE.MeshLambertMaterial({ color: 0xe9e3d4 });
        const bronze = new THREE.MeshLambertMaterial({ color: 0xa07e3c });
        const plinthMat = new THREE.MeshLambertMaterial({ color: 0xd3ccb9 });

        // Every figure stands on a plinth, so the island reads as a sanctuary of
        // statues rather than a scattering of props.
        const plinth = (x, z, w = 1.6, h = 1.1) => {
            const base = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), plinthMat);
            base.position.set(x, h / 2, z);
            base.castShadow = true;
            base.receiveShadow = true;
            group.add(base);
            this._prop(center, x, z, w / 2 + 0.2, w / 2 + 0.2, h + 1.6);
            return h;
        };

        // --- Medusa: snake-haired, coiled serpent tail instead of legs ---
        const medusa = new THREE.Group();
        const scaleMat = new THREE.MeshLambertMaterial({ color: 0x4c7a4a });
        const skinMat = new THREE.MeshLambertMaterial({ color: 0xcfc6ad });

        // Coiled tail: a stack of shrinking, offset rings.
        for (let i = 0; i < 4; i++) {
            const coil = new THREE.Mesh(
                new THREE.TorusGeometry(0.95 - i * 0.16, 0.24, 7, 16), scaleMat
            );
            coil.rotation.x = Math.PI / 2;
            coil.position.set(Math.sin(i) * 0.12, 0.24 + i * 0.34, Math.cos(i) * 0.12);
            coil.castShadow = true;
            medusa.add(coil);
        }
        const torsoM = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.7, 4, 10), skinMat);
        torsoM.position.y = 2.15;
        torsoM.castShadow = true;
        medusa.add(torsoM);
        const headM = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), skinMat);
        headM.position.y = 2.9;
        medusa.add(headM);

        // The snakes: each is a short curved chain of spheres with a head.
        for (let s = 0; s < 11; s++) {
            const a = (s / 11) * Math.PI * 2;
            const snake = new THREE.Group();
            for (let seg = 0; seg < 4; seg++) {
                const bead = new THREE.Mesh(
                    new THREE.SphereGeometry(0.11 - seg * 0.012, 7, 6), scaleMat
                );
                bead.position.set(seg * 0.16, seg * 0.19, Math.sin(seg * 1.4) * 0.13);
                snake.add(bead);
            }
            const fang = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 6), scaleMat);
            fang.position.set(0.62, 0.72, 0.1);
            fang.rotation.z = -0.7;
            snake.add(fang);
            snake.position.set(Math.cos(a) * 0.26, 3.05, Math.sin(a) * 0.26);
            snake.rotation.y = -a;
            snake.rotation.z = 0.25;
            medusa.add(snake);
        }

        // Arms raised — the pose that turns you to stone.
        [-1, 1].forEach((side) => {
            const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.62, 4, 8), skinMat);
            arm.position.set(side * 0.5, 2.35, 0.16);
            arm.rotation.z = side * 0.85;
            medusa.add(arm);
        });

        // Two of her victims, already stone, kneeling at the foot of the plinth.
        [[-1.5, 0.9], [1.6, -0.7]].forEach(([vx, vz]) => {
            const victim = new THREE.Group();
            const vt = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.5, 4, 8), marble);
            vt.position.y = 0.75;
            victim.add(vt);
            const vh = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), marble);
            vh.position.y = 1.3;
            victim.add(vh);
            const va = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.4, 4, 6), marble);
            va.position.set(0.3, 1.0, 0.2);
            va.rotation.z = 1.1;
            victim.add(va);
            victim.position.set(vx, 0, vz);
            victim.rotation.y = vx;
            victim.castShadow = true;
            medusa.add(victim);
        });

        // Placed just off the walking corridor rather than out at the rim: at
        // the rim the palms screen them and the player walks past a statue they
        // never see. Sits south-east at (9, -9), clear of the totem at
        // (-9.5, -6.5), the dryad's tree at (7.2, -5.5), and the corridor.
        medusa.position.set(9, plinth(9, -9, 2.0), -9);
        medusa.rotation.y = -0.5;
        group.add(medusa);
        this.occluders.push(medusa);

        // --- Athena: helmet, spear, aegis shield, and her owl ---
        const athena = new THREE.Group();
        const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.72, 1.9, 12), marble);
        robe.position.y = 0.95;
        robe.castShadow = true;
        athena.add(robe);
        // Vertical folds in the peplos.
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            const fold = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 1.85, 5), marble);
            fold.position.set(Math.cos(a) * 0.52, 0.95, Math.sin(a) * 0.52);
            athena.add(fold);
        }
        const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.42, 4, 10), marble);
        chest.position.y = 2.15;
        athena.add(chest);
        const headA = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), marble);
        headA.position.y = 2.75;
        athena.add(headA);

        // Corinthian helmet with a tall crest.
        const helm = new THREE.Mesh(
            new THREE.SphereGeometry(0.34, 12, 10, 0, Math.PI * 2, 0, Math.PI / 1.7), bronze
        );
        helm.position.y = 2.82;
        helm.castShadow = true;
        athena.add(helm);
        const crest = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, 0.86),
            new THREE.MeshLambertMaterial({ color: 0xc03a2b }));
        crest.position.y = 3.14;
        athena.add(crest);
        const nasal = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.3, 0.07), bronze);
        nasal.position.set(0, 2.68, 0.3);
        athena.add(nasal);

        // Spear in the right hand.
        const spear = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4.4, 7), bronze);
        spear.position.set(0.62, 2.2, 0);
        athena.add(spear);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.5, 7), bronze);
        tip.position.set(0.62, 4.6, 0);
        athena.add(tip);

        // Aegis: a round shield with a gorgoneion boss.
        const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.78, 0.12, 20), bronze);
        shield.rotation.z = Math.PI / 2;
        shield.rotation.y = 0.25;
        shield.position.set(-0.66, 2.05, 0.18);
        shield.castShadow = true;
        athena.add(shield);
        const boss = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8),
            new THREE.MeshLambertMaterial({ color: 0x6f8f4f }));
        boss.position.set(-0.76, 2.05, 0.18);
        athena.add(boss);

        // The owl of Athena, perched on her shoulder.
        const owl = new THREE.Group();
        const owlBody = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8),
            new THREE.MeshLambertMaterial({ color: 0x8d7d63 }));
        owlBody.scale.y = 1.25;
        owl.add(owlBody);
        [-1, 1].forEach((side) => {
            const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6),
                new THREE.MeshLambertMaterial({ color: 0xf5d64a }));
            eye.position.set(side * 0.09, 0.09, 0.16);
            owl.add(eye);
        });
        const beak = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.1, 6),
            new THREE.MeshLambertMaterial({ color: 0xd8a13c }));
        beak.position.set(0, 0.03, 0.2);
        beak.rotation.x = Math.PI / 2;
        owl.add(beak);
        owl.position.set(-0.34, 2.62, -0.1);
        athena.add(owl);

        athena.position.set(-7.2, plinth(-7.2, 4.5, 2.2, 1.3), 4.5);
        athena.rotation.y = 0.6;
        group.add(athena);
        this.occluders.push(athena);

        // --- the dryad: a nymph emerging from her oak, half bark half woman ---
        const dryadTree = new THREE.Group();
        const barkMat = new THREE.MeshLambertMaterial({ color: 0x6a4b2c });
        const leafMat = new THREE.MeshLambertMaterial({ color: 0x3f8b3a, flatShading: true });
        const barkSkin = new THREE.MeshLambertMaterial({ color: 0xb0906a });

        const trunkD = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.5, 6.4, 10), barkMat);
        trunkD.position.y = 3.2;
        trunkD.castShadow = true;
        dryadTree.add(trunkD);
        for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2;
            const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.24, 2.4, 6), barkMat);
            branch.position.set(Math.cos(a) * 0.9, 5.4, Math.sin(a) * 0.9);
            branch.rotation.z = -Math.cos(a) * 0.9;
            branch.rotation.x = Math.sin(a) * 0.9;
            dryadTree.add(branch);
        }
        for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2 + 0.4;
            const crown = new THREE.Mesh(new THREE.SphereGeometry(1.8, 9, 7), leafMat);
            crown.position.set(Math.cos(a) * 1.5, 6.8 + Math.sin(i) * 0.5, Math.sin(a) * 1.5);
            crown.scale.y = 0.8;
            crown.castShadow = true;
            dryadTree.add(crown);
        }

        // The dryad herself, stepping out of the south face of the trunk.
        const dryad = new THREE.Group();
        const dTorso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.66, 4, 10), barkSkin);
        dTorso.position.y = 2.4;
        dryad.add(dTorso);
        const dHead = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 10), barkSkin);
        dHead.position.y = 3.05;
        dryad.add(dHead);
        // Hair of leaves.
        for (let i = 0; i < 7; i++) {
            const a = (i / 7) * Math.PI * 2;
            const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.44, 5), leafMat);
            leaf.position.set(Math.cos(a) * 0.24, 3.24, Math.sin(a) * 0.24 - 0.05);
            leaf.rotation.z = Math.cos(a) * 0.7;
            leaf.rotation.x = -Math.sin(a) * 0.7 - 0.3;
            dryad.add(leaf);
        }
        // One arm reaching out of the bark, one still fused to the trunk.
        const dArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.6, 4, 8), barkSkin);
        dArm.position.set(0.42, 2.5, 0.3);
        dArm.rotation.z = -0.9;
        dArm.rotation.x = -0.5;
        dryad.add(dArm);
        const dArmBark = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.55, 4, 8), barkMat);
        dArmBark.position.set(-0.36, 2.45, 0.1);
        dArmBark.rotation.z = 0.5;
        dryad.add(dArmBark);
        // Her lower half is still trunk: a skirt of bark blending her in.
        const dSkirt = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.66, 1.5, 10), barkMat);
        dSkirt.position.y = 1.4;
        dryad.add(dSkirt);

        dryad.position.set(0, 0, 1.25);
        dryadTree.add(dryad);

        dryadTree.position.set(7.2, 0, -5.5);
        dryadTree.rotation.y = -0.5;   // she steps out toward the path
        group.add(dryadTree);
        this.occluders.push(dryadTree);
        this._prop(center, 7.2, -5.5, 1.5, 1.5, 6.4);

        // --- a centaur: horse body, human torso, drawn bow ---
        const centaur = new THREE.Group();
        const hideMat = new THREE.MeshLambertMaterial({ color: 0x7a4b28 });
        const barrel = new THREE.Mesh(new THREE.CapsuleGeometry(0.52, 1.3, 4, 10), hideMat);
        barrel.rotation.z = Math.PI / 2;
        barrel.position.y = 1.35;
        barrel.castShadow = true;
        centaur.add(barrel);
        // Four legs.
        [[-0.75, 0.34], [-0.75, -0.34], [0.8, 0.34], [0.8, -0.34]].forEach(([lx, lz]) => {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.11, 1.35, 7), hideMat);
            leg.position.set(lx, 0.68, lz);
            centaur.add(leg);
            const hoof = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.15, 0.18, 7),
                new THREE.MeshLambertMaterial({ color: 0x2b211a }));
            hoof.position.set(lx, 0.09, lz);
            centaur.add(hoof);
        });
        // Human half rising from the withers.
        const cTorso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.62, 4, 10), hideMat);
        cTorso.position.set(-0.85, 2.25, 0);
        centaur.add(cTorso);
        const cHead = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), hideMat);
        cHead.position.set(-0.85, 2.85, 0);
        centaur.add(cHead);
        // Bow, drawn.
        const bow = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.06, 6, 14, Math.PI * 1.1),
            new THREE.MeshLambertMaterial({ color: 0x54341c }));
        bow.position.set(-1.35, 2.3, 0);
        bow.rotation.y = Math.PI / 2;
        centaur.add(bow);
        const tailC = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.7, 4, 6),
            new THREE.MeshLambertMaterial({ color: 0x3d2515 }));
        tailC.position.set(1.15, 1.5, 0);
        tailC.rotation.z = -0.6;
        centaur.add(tailC);

        centaur.position.set(7.5, 0, 4.5);
        centaur.rotation.y = -1.1;
        group.add(centaur);
        this.occluders.push(centaur);
        this._prop(center, 7.5, 4.5, 1.3, 0.9, 2.9);

        // --- Pegasus on a tall column, wings spread ---
        // Set off the centre line: local x = 0 is the corridor the player walks
        // in on from the south bridge, and a column there is a turnstile.
        const PEG_X = -6.5;
        const PEG_Z = -11.5;
        const column = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.85, 5.5, 14), marble);
        column.position.set(PEG_X, 2.75, PEG_Z);
        column.castShadow = true;
        group.add(column);
        this._prop(center, PEG_X, PEG_Z, 0.95, 0.95, 5.5);

        const pegasus = new THREE.Group();
        const pegMat = new THREE.MeshLambertMaterial({ color: 0xf2efe6 });
        const pegBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.95, 4, 10), pegMat);
        pegBody.rotation.z = Math.PI / 2;
        pegBody.castShadow = true;
        pegasus.add(pegBody);
        const pegNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.8, 8), pegMat);
        pegNeck.position.set(0.72, 0.42, 0);
        pegNeck.rotation.z = -0.6;
        pegasus.add(pegNeck);
        const pegHead = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.32, 4, 8), pegMat);
        pegHead.position.set(1.06, 0.74, 0);
        pegHead.rotation.z = -1.1;
        pegasus.add(pegHead);
        [[-0.5, 0.24], [-0.5, -0.24], [0.42, 0.24], [0.42, -0.24]].forEach(([lx, lz]) => {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.85, 6), pegMat);
            leg.position.set(lx, -0.5, lz);
            leg.rotation.x = lz > 0 ? 0.3 : -0.3;
            pegasus.add(leg);
        });
        // Wings: fans of flat feather planes on each flank.
        [-1, 1].forEach((side) => {
            const wing = new THREE.Group();
            for (let f = 0; f < 6; f++) {
                const feather = new THREE.Mesh(
                    new THREE.BoxGeometry(1.5 - f * 0.14, 0.06, 0.26), pegMat
                );
                feather.position.set(-f * 0.13, f * 0.2, 0);
                feather.rotation.z = 0.5 - f * 0.07;
                wing.add(feather);
            }
            wing.position.set(0, 0.3, side * 0.34);
            wing.rotation.x = side * 0.35;
            wing.castShadow = true;
            pegasus.add(wing);
        });
        pegasus.position.set(PEG_X, 6.4, PEG_Z);
        pegasus.rotation.y = Math.PI * 0.85;   // turned to face the arriving player
        group.add(pegasus);
        this.occluders.push(pegasus);

        // A scatter of laurel and broken column drums, finishing the sanctuary.
        [[-6.5, -10.5], [7, -10], [-7.5, 10.5]].forEach(([dx, dz], i) => {
            const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.62, 0.7, 14), marble);
            drum.position.set(dx, 0.35, dz);
            drum.rotation.z = i === 1 ? Math.PI / 2 : 0;
            drum.castShadow = true;
            group.add(drum);
        });
    }

    // A moon hung in the sky ahead of the island. Dark-by-day like the
    // lanterns, faded in by Game._updateAtmosphere via this.moon — not part
    // of the shared sky sphere, which is one global mesh seen from every
    // island and would otherwise put the moon over the whole chain, not just
    // this one.
    //
    // Placement went through two wrong guesses before this one, both caught
    // by actually projecting the moon's world position through the chase
    // camera's real matrix instead of eyeballing a screenshot:
    //   1. Well north and low — outside the camera's view almost entirely,
    //      since that direction wasn't where the camera happened to look.
    //   2. Almost directly overhead — the chase camera sits only ~7.5 units
    //      above the player at a fairly shallow downward pitch (13 units
    //      back, looking near player-eye-height), so "straight up" needs a
    //      deliberate look-up the default framing never does; projecting
    //      that position landed far outside the ±1 NDC viewport.
    // The camera's resting yaw looks toward +z (see _updateCamera's offset),
    // so due north and at a moderate height — ahead of the player, not
    // overhead — is what actually lands inside the default view.
    _buildMoon(center) {
        const moon = new THREE.Group();
        // MeshBasicMaterial is unlit, so its own colour is what shows — pale
        // and bright, like a moon, with only its opacity faded by day/night
        // rather than the colour (fading colour toward pale would make it
        // look like a dim grey ball by day instead of simply invisible).
        const body = new THREE.Mesh(
            new THREE.SphereGeometry(6, 20, 16),
            new THREE.MeshBasicMaterial({ color: 0xf4f2ea, fog: false, transparent: true, opacity: 0, depthTest: false })
        );
        body.renderOrder = 999; // always drawn over terrain/props at this distance
        moon.add(body);
        this.moonBody = body;

        // A soft halo behind it reads better against the sky than a flat disc.
        const halo = new THREE.Mesh(
            new THREE.SphereGeometry(9, 16, 12),
            new THREE.MeshBasicMaterial({
                color: 0xdfe8ff, fog: false, transparent: true, opacity: 0,
                side: THREE.BackSide, depthTest: false
            })
        );
        halo.renderOrder = 998;
        moon.add(halo);
        this.moonHalo = halo;

        // Deliberately right at the top edge of the default view (verified
        // by projecting through the camera's actual matrix at the default
        // resting yaw — lands at NDC y ≈ 0.94-1.0, the very top of the ±1
        // viewport): barely visible without the player doing anything, and
        // clearly in frame the moment they rotate the camera or the chase
        // angle shifts, rather than either hidden entirely or sitting
        // obviously centred no matter where they look.
        moon.position.set(center.x, 10, center.z + 45);
        this.scene.add(moon);
        this.moon = moon;
    }

    // (f) European Dynamics — pirates: a beached ship, a pirate at the helm, a
    // cutlass in the sand, a tomcat on a barrel, and the treasure they came for.
    _dressPirates(group, center) {
        this._buildMoon(center);

        const hullMat = new THREE.MeshLambertMaterial({ color: 0x5b3a20 });
        const deckMat = new THREE.MeshLambertMaterial({ color: 0x9c6f42 });
        const sailMat = new THREE.MeshLambertMaterial({
            color: 0xf0e8d6, side: THREE.DoubleSide
        });
        const ropeMat = new THREE.MeshLambertMaterial({ color: 0xcbb68d });

        // --- the ship, run aground on the island's west shore ---
        const ship = new THREE.Group();

        // Hull: a stretched, flattened sphere with a squared stern.
        const hull = new THREE.Mesh(new THREE.SphereGeometry(2.4, 16, 12), hullMat);
        hull.scale.set(2.5, 0.72, 0.95);
        hull.position.y = 1.5;
        hull.castShadow = true;
        ship.add(hull);

        const stern = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.6, 3.4), hullMat);
        stern.position.set(-5.2, 2.2, 0);
        stern.castShadow = true;
        ship.add(stern);

        // Bowsprit spearing forward off the prow.
        const bowsprit = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 3, 7), deckMat);
        bowsprit.position.set(7.2, 2.6, 0);
        bowsprit.rotation.z = Math.PI / 2 - 0.25;
        ship.add(bowsprit);

        // Deck plus a low gunwale so the ship reads as open on top.
        const deck = new THREE.Mesh(new THREE.BoxGeometry(11, 0.3, 4), deckMat);
        deck.position.y = 2.55;
        deck.receiveShadow = true;
        ship.add(deck);
        [-1, 1].forEach((side) => {
            const rail = new THREE.Mesh(new THREE.BoxGeometry(11, 0.7, 0.24), hullMat);
            rail.position.set(0, 2.95, side * 1.95);
            ship.add(rail);
        });

        // Masts, yards and square sails.
        [[-2.4, 6.5], [1.8, 8]].forEach(([mx, mh], i) => {
            const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, mh, 8), deckMat);
            mast.position.set(mx, 2.7 + mh / 2, 0);
            mast.castShadow = true;
            ship.add(mast);

            const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4.6, 6), deckMat);
            yard.rotation.x = Math.PI / 2;
            yard.position.set(mx, 2.7 + mh * 0.78, 0);
            ship.add(yard);

            const sail = new THREE.Mesh(new THREE.PlaneGeometry(4.4, mh * 0.5), sailMat);
            sail.position.set(mx, 2.7 + mh * 0.52, 0.05);
            sail.rotation.y = Math.PI / 2;
            sail.castShadow = true;
            ship.add(sail);

            // Jolly Roger at the taller masthead: black flag, skull and bones.
            if (i === 1) {
                const flag = new THREE.Group();
                const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0),
                    new THREE.MeshLambertMaterial({ color: 0x14100e, side: THREE.DoubleSide }));
                flag.add(cloth);
                const skull = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8),
                    new THREE.MeshLambertMaterial({ color: 0xf2ece0 }));
                skull.position.set(0, 0.12, 0.04);
                skull.scale.set(1, 0.9, 0.4);
                flag.add(skull);
                [-1, 1].forEach((s) => {
                    const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.8, 5),
                        new THREE.MeshLambertMaterial({ color: 0xf2ece0 }));
                    bone.position.set(0, -0.22, 0.04);
                    bone.rotation.z = s * 0.7;
                    flag.add(bone);
                });
                flag.position.set(mx + 0.85, 2.7 + mh - 0.7, 0);
                flag.rotation.y = Math.PI / 2;
                ship.add(flag);
            }
        });

        // Shrouds: rope ladders from the rail up to the masthead.
        [-1, 1].forEach((side) => {
            for (let i = 0; i < 4; i++) {
                const shroud = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 6.2, 4), ropeMat);
                shroud.position.set(1.8 - i * 0.25, 6.2, side * (1.1 - i * 0.22));
                shroud.rotation.x = side * 0.16;
                shroud.rotation.z = 0.1;
                ship.add(shroud);
            }
        });

        // Gunports with cannon muzzles poking out of the near side.
        for (let i = 0; i < 4; i++) {
            const cannon = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 0.9, 8),
                new THREE.MeshLambertMaterial({ color: 0x2f3338 }));
            cannon.rotation.x = Math.PI / 2;
            cannon.position.set(-3 + i * 2, 1.9, -1.95);
            ship.add(cannon);
        }

        // Ship's lanterns: dark by day, lit by main.js when the island turns
        // to night (see Game._updateAtmosphere / this.nightLamps). Glass
        // built from a small emissive-ish sphere since MeshLambertMaterial
        // has no true emissive channel — the PointLight sells the glow.
        // Range/intensity bumped up from the first pass, which only lit the
        // ship's own deck and left the rest of the island dark once night
        // fell — see the standalone lamp posts further below for the rest
        // of the island.
        const lanternGlass = new THREE.MeshBasicMaterial({ color: 0x2a2010 });
        this.nightLamps = [];
        [[-5.2, 3.35, 1.4], [-5.2, 3.35, -1.4], [4.8, 3.0, 0]].forEach(([lx, ly, lz]) => {
            const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6),
                new THREE.MeshLambertMaterial({ color: 0x2f2318 }));
            post.position.set(lx, ly - 0.25, lz);
            ship.add(post);

            const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), lanternGlass);
            lantern.position.set(lx, ly, lz);
            ship.add(lantern);

            const light = new THREE.PointLight(0xffb347, 0, 14, 2);
            light.position.set(lx, ly, lz);
            ship.add(light);

            this.nightLamps.push({ glass: lanternGlass, light });
        });

        ship.position.set(-11, 0, -1);
        ship.rotation.y = 0.42;
        ship.rotation.z = 0.07;   // listing, as a beached hull would
        group.add(ship);
        this.occluders.push(ship);
        this._prop(center, -11, -1, 4.6, 3.0, 3.2);

        // --- the pirate: tricorn, eyepatch, peg leg, hook, standing on deck ---
        const pirate = new THREE.Group();
        const coat = new THREE.MeshLambertMaterial({ color: 0x7a2320 });
        const skin = new THREE.MeshLambertMaterial({ color: 0xdcae82 });
        const leather = new THREE.MeshLambertMaterial({ color: 0x3a2a1c });
        const dark = new THREE.MeshLambertMaterial({ color: 0x171310 });

        const pTorso = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.6, 4, 10), coat);
        pTorso.position.y = 1.25;
        pTorso.castShadow = true;
        pirate.add(pTorso);
        const pHead = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), skin);
        pHead.position.y = 1.92;
        pirate.add(pHead);
        const beard = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), dark);
        beard.position.set(0, 1.76, 0.14);
        beard.scale.set(1, 0.9, 0.75);
        pirate.add(beard);

        // Tricorn hat: a brim disc with a crown, and a skull badge.
        const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.08, 3), dark);
        brim.position.y = 2.16;
        brim.rotation.y = 0.3;
        pirate.add(brim);
        const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.34, 10), dark);
        crown.position.y = 2.32;
        pirate.add(crown);

        // Eyepatch and its strap.
        const patch = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.13, 0.05), dark);
        patch.position.set(-0.12, 1.98, 0.28);
        pirate.add(patch);
        const strap = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.025, 5, 14), dark);
        strap.position.y = 1.98;
        strap.rotation.y = Math.PI / 2;
        strap.rotation.x = 0.25;
        pirate.add(strap);
        const goodEye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6),
            new THREE.MeshLambertMaterial({ color: 0xffffff }));
        goodEye.position.set(0.13, 1.98, 0.27);
        pirate.add(goodEye);

        // Arms: one hand, one hook.
        const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.5, 4, 8), coat);
        armL.position.set(-0.44, 1.3, 0.05);
        armL.rotation.z = 0.4;
        pirate.add(armL);
        const hook = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.035, 5, 10, Math.PI * 1.3),
            new THREE.MeshLambertMaterial({ color: 0xb8bcc2 }));
        hook.position.set(-0.66, 0.94, 0.05);
        hook.rotation.y = Math.PI / 2;
        pirate.add(hook);

        const armR = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.5, 4, 8), coat);
        armR.position.set(0.44, 1.3, 0.05);
        armR.rotation.z = -0.4;
        pirate.add(armR);
        const hand = new THREE.Mesh(new THREE.SphereGeometry(0.13, 9, 7), skin);
        hand.position.set(0.64, 0.98, 0.05);
        pirate.add(hand);

        // Legs: one booted, one a peg.
        const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.13, 0.8, 8), leather);
        legL.position.set(-0.19, 0.4, 0);
        pirate.add(legL);
        const boot = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.2, 0.5), leather);
        boot.position.set(-0.19, 0.1, 0.09);
        pirate.add(boot);
        const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.13, 0.85, 7),
            new THREE.MeshLambertMaterial({ color: 0x7a5a34 }));
        peg.position.set(0.19, 0.42, 0);
        pirate.add(peg);

        // Sash and belt buckle.
        const sash = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.26, 12),
            new THREE.MeshLambertMaterial({ color: 0xc9a227 }));
        sash.position.y = 0.98;
        pirate.add(sash);

        pirate.position.set(-11.4, 2.7, 0.6);
        pirate.rotation.y = 0.42 + 2.4;
        pirate.scale.setScalar(1.05);
        group.add(pirate);
        this.occluders.push(pirate);

        // --- the sword: a cutlass driven into the ground, blade up ---
        const sword = new THREE.Group();
        const steel = new THREE.MeshLambertMaterial({ color: 0xd2d7dd });
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.13, 2.3, 0.035), steel);
        blade.position.y = 1.5;
        blade.castShadow = true;
        sword.add(blade);
        // Tapered point, made by scaling the tip block down.
        const point = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.4, 4), steel);
        point.position.y = 2.82;
        sword.add(point);
        const guard = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.045, 6, 12, Math.PI * 1.4),
            new THREE.MeshLambertMaterial({ color: 0xc9a227 }));
        guard.position.y = 0.38;
        guard.rotation.x = Math.PI / 2;
        guard.rotation.z = 0.4;
        sword.add(guard);
        const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.075, 0.55, 8), leather);
        grip.position.y = 0.1;
        sword.add(grip);
        sword.position.set(6.4, 0, -8.5);
        sword.rotation.z = 0.22;
        group.add(sword);

        // --- the tomcat: ginger tabby, curled on a barrel, tail flicking ---
        const barrel = new THREE.Group();
        const stave = new THREE.MeshLambertMaterial({ color: 0x8a5c31 });
        const hoopMat = new THREE.MeshLambertMaterial({ color: 0x4a4237 });
        const cask = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 1.5, 14), stave);
        cask.position.y = 0.75;
        cask.castShadow = true;
        barrel.add(cask);
        [0.35, 1.15].forEach((hy) => {
            const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.87, 0.06, 6, 16), hoopMat);
            hoop.position.y = hy;
            hoop.rotation.x = Math.PI / 2;
            barrel.add(hoop);
        });

        const cat = new THREE.Group();
        const ginger = new THREE.MeshLambertMaterial({ color: 0xd98a3f });
        const cream = new THREE.MeshLambertMaterial({ color: 0xf5e2c4 });
        const catBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.42, 4, 10), ginger);
        catBody.rotation.z = Math.PI / 2;
        catBody.position.y = 0.24;
        catBody.castShadow = true;
        cat.add(catBody);
        const catChest = new THREE.Mesh(new THREE.SphereGeometry(0.16, 9, 7), cream);
        catChest.position.set(0.3, 0.2, 0.1);
        cat.add(catChest);
        const catHead = new THREE.Mesh(new THREE.SphereGeometry(0.23, 12, 10), ginger);
        catHead.position.set(0.46, 0.5, 0);
        cat.add(catHead);
        // Ears, eyes, muzzle.
        [-1, 1].forEach((side) => {
            const ear = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.19, 4), ginger);
            ear.position.set(0.44, 0.69, side * 0.13);
            cat.add(ear);
            const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6),
                new THREE.MeshLambertMaterial({ color: 0x76b83f }));
            eye.position.set(0.64, 0.53, side * 0.1);
            cat.add(eye);
        });
        const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.11, 9, 7), cream);
        muzzle.position.set(0.66, 0.44, 0);
        cat.add(muzzle);
        const catNose = new THREE.Mesh(new THREE.SphereGeometry(0.04, 7, 6),
            new THREE.MeshLambertMaterial({ color: 0xd06a72 }));
        catNose.position.set(0.74, 0.46, 0);
        cat.add(catNose);
        // Tabby stripes.
        for (let i = 0; i < 4; i++) {
            const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.245, 0.028, 5, 12),
                new THREE.MeshLambertMaterial({ color: 0xa85c22 }));
            stripe.position.set(0.06 - i * 0.17, 0.24, 0);
            stripe.rotation.y = Math.PI / 2;
            cat.add(stripe);
        }
        // Curled tail, wrapped around the body.
        const catTail = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.06, 6, 14, Math.PI * 1.5), ginger);
        catTail.position.set(-0.42, 0.24, 0.16);
        catTail.rotation.x = Math.PI / 2;
        cat.add(catTail);
        // Tucked front paws.
        [-1, 1].forEach((side) => {
            const paw = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), cream);
            paw.position.set(0.42, 0.1, side * 0.14);
            cat.add(paw);
        });

        // Scaled up from the original 1:1 build — at life size the cat read as
        // an afterthought next to the pirate and the ship; big enough now to
        // be a real landmark on the barrel, and a fun target to attack.
        cat.scale.setScalar(2.2);
        cat.position.set(0, 1.5, 0);
        cat.rotation.y = -0.6;
        barrel.add(cat);

        barrel.position.set(7.8, 0, 5.2);
        group.add(barrel);
        this.occluders.push(barrel);
        this._prop(center, 7.8, 5.2, 1.0, 1.0, 1.5);
        this._registerNPC(cat, center.x + 7.8, center.z + 5.2, 1.3, 2.4);

        // --- the giant: an old man, twice the height of anyone else on the
        // island, leaning on a driftwood cane. No backstory beyond "the island
        // has a giant" — he's a fun, oversized target, destructible like the
        // cat rather than a lore piece.
        const giant = new THREE.Group();
        const giantSkin = new THREE.MeshLambertMaterial({ color: 0xd9b48f });
        const giantRobe = new THREE.MeshLambertMaterial({ color: 0x5c6b52 });
        const giantHair = new THREE.MeshLambertMaterial({ color: 0xe8e4da });

        const gTorso = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 1.1, 4, 10), giantRobe);
        gTorso.position.y = 1.7;
        gTorso.castShadow = true;
        giant.add(gTorso);

        const gHead = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 12), giantSkin);
        gHead.position.y = 2.75;
        gHead.castShadow = true;
        giant.add(gHead);

        // Bushy white hair and a long beard — the "old" half of "old giant".
        const gHair = new THREE.Mesh(
            new THREE.SphereGeometry(0.44, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), giantHair
        );
        gHair.position.y = 2.86;
        giant.add(gHair);
        const gBeard = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.65, 10), giantHair);
        gBeard.position.set(0, 2.35, 0.18);
        gBeard.rotation.x = 0.15;
        giant.add(gBeard);

        [-1, 1].forEach((side) => {
            const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6),
                new THREE.MeshLambertMaterial({ color: 0xffffff }));
            eye.position.set(side * 0.15, 2.8, 0.38);
            giant.add(eye);

            const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.9, 4, 8), giantRobe);
            arm.position.set(side * 0.66, 1.75, 0);
            arm.rotation.z = side * 0.22;
            arm.castShadow = true;
            giant.add(arm);

            const hand = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), giantSkin);
            hand.position.set(side * 0.82, 1.15, 0);
            giant.add(hand);

            const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.9, 4, 8), giantRobe);
            leg.position.set(side * 0.24, 0.5, 0);
            giant.add(leg);

            const foot = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.2, 0.5), giantSkin);
            foot.position.set(side * 0.24, 0.1, 0.12);
            giant.add(foot);
        });

        // Driftwood cane, planted by the right hand.
        const cane = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 1.5, 8),
            new THREE.MeshLambertMaterial({ color: 0x6b4a2a }));
        cane.position.set(0.85, 0.75, 0.15);
        cane.rotation.z = 0.06;
        cane.castShadow = true;
        giant.add(cane);

        // x = -5.2 keeps clear of the |x| < 4 walking corridor and of the
        // treasure chest at (-6.8, 8.6), while staying close enough to the
        // path to be seen on the way past.
        giant.scale.setScalar(1.6); // twice again over a normal figure's ~2m
        giant.position.set(-5.2, 0, 3.0);
        giant.rotation.y = 2.6;
        group.add(giant);
        this.occluders.push(giant);
        this._prop(center, -5.2, 3.0, 0.9, 0.9, 5.2);
        this._registerNPC(giant, center.x - 5.2, center.z + 3.0, 1.3, 5.2);

        // --- treasure: an open chest spilling coins, and a few empty casks ---
        const chest = new THREE.Group();
        const box = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.85, 1.0), stave);
        box.position.y = 0.42;
        box.castShadow = true;
        chest.add(box);
        const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.5, 12, 1, false, 0, Math.PI), stave);
        lid.rotation.z = Math.PI / 2;
        lid.position.set(0, 0.85, -0.5);
        lid.rotation.x = -1.1;
        chest.add(lid);
        const gold = new THREE.MeshLambertMaterial({ color: 0xf0c33c });
        for (let i = 0; i < 14; i++) {
            const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.04, 10), gold);
            coin.position.set(
                (Math.random() - 0.5) * 1.9,
                0.86 + Math.random() * 0.12,
                (Math.random() - 0.5) * 1.3
            );
            coin.rotation.set(Math.random(), Math.random(), Math.random() * 0.4);
            chest.add(coin);
        }
        chest.position.set(-6.8, 0, 8.6);
        chest.rotation.y = -0.5;
        group.add(chest);
        this._prop(center, -6.8, 8.6, 0.9, 0.7, 1.0);

        // Casks and a rum bottle scattered on the sand.
        [[6.2, -3.2, 0.7], [-7.6, -8.5, 0.85]].forEach(([bx, bz, s]) => {
            const cask2 = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.1, 12), stave);
            cask2.position.set(bx, 0.6 * s, bz);
            cask2.rotation.z = Math.PI / 2;
            cask2.scale.setScalar(s);
            cask2.castShadow = true;
            group.add(cask2);
        });

        // Standalone tiki torches spread across the island, clear of the
        // |x| < 4 walking corridor — the ship's own lanterns only reached
        // its own deck, leaving the rest of the island dark once night fell.
        // Same dark-by-day / lit-by-night wiring as the ship's lanterns, via
        // this.nightLamps.
        const torchWood = new THREE.MeshLambertMaterial({ color: 0x5a3f22 });
        [[8, 5.2], [-6.8, 8.6], [6.4, -8.5], [-8, -3]].forEach(([tx, tz]) => {
            const torch = new THREE.Group();
            const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.8, 7), torchWood);
            pole.position.y = 0.9;
            pole.castShadow = true;
            torch.add(pole);

            const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
                new THREE.MeshLambertMaterial({ color: 0x3a2a18 }));
            bowl.position.y = 1.82;
            bowl.rotation.x = Math.PI;
            torch.add(bowl);

            const flameGlass = new THREE.MeshBasicMaterial({ color: 0x3a2010 });
            const flame = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), flameGlass);
            flame.position.y = 1.9;
            torch.add(flame);

            const light = new THREE.PointLight(0xffa347, 0, 11, 2);
            light.position.y = 1.95;
            torch.add(light);

            torch.position.set(tx, 0, tz);
            group.add(torch);
            this.nightLamps.push({ glass: flameGlass, light });
        });
    }

    // (g) Intracom Telecom — the working town: a taverna, the bus that gets you
    // there, the elders holding court outside it, and a framed certificate.
    _dressTownLife(group, center) {
        // --- the restaurant: a taverna with an awning and terrace tables ---
        const taverna = new THREE.Group();
        const wallMat = new THREE.MeshLambertMaterial({ color: 0xf2ede0 });
        const trimMat = new THREE.MeshLambertMaterial({ color: 0x2f6fa8 });
        const roofMat = new THREE.MeshLambertMaterial({ color: 0xb5523c });

        const shell = new THREE.Mesh(new THREE.BoxGeometry(6.4, 3.6, 4.4), wallMat);
        shell.position.y = 1.8;
        shell.castShadow = true;
        taverna.add(shell);

        // Pitched tile roof.
        const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 2.6, 7, 3), roofMat);
        roof.rotation.z = Math.PI / 2;
        roof.position.y = 4.4;
        roof.scale.set(1, 1, 0.62);
        roof.castShadow = true;
        taverna.add(roof);

        // Door and windows on the south face, with blue shutters.
        const doorMat = new THREE.MeshLambertMaterial({ color: 0x3a2a1a });
        const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.1, 0.12), doorMat);
        door.position.set(0, 1.05, 2.22);
        taverna.add(door);
        [-2.1, 2.1].forEach((wx) => {
            const win = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 0.1),
                new THREE.MeshLambertMaterial({ color: 0x9fc4dd }));
            win.position.set(wx, 2.1, 2.22);
            taverna.add(win);
            [-0.7, 0.7].forEach((off) => {
                const shutter = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, 0.08), trimMat);
                shutter.position.set(wx + off, 2.1, 2.28);
                taverna.add(shutter);
            });
        });

        // Striped awning over the terrace, carried on two posts.
        const awning = new THREE.Group();
        for (let i = 0; i < 8; i++) {
            const strip = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.08, 2.6),
                new THREE.MeshLambertMaterial({ color: i % 2 ? 0xf5f0e4 : 0xb5523c }));
            strip.position.set(-2.8 + i * 0.8, 0, 0);
            awning.add(strip);
        }
        awning.position.set(0, 3.0, 3.6);
        awning.rotation.x = -0.18;
        awning.castShadow = true;
        taverna.add(awning);
        [-2.9, 2.9].forEach((px) => {
            const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.9, 7), trimMat);
            post.position.set(px, 1.45, 4.7);
            taverna.add(post);
        });

        // A hand-painted sign board over the door.
        const board = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.7, 0.14), trimMat);
        board.position.set(0, 3.1, 2.3);
        taverna.add(board);

        taverna.position.set(-9.5, 0, 0.5);
        taverna.rotation.y = 0.32;
        group.add(taverna);
        this.occluders.push(taverna);
        this._prop(center, -9.5, 0.5, 3.4, 2.4, 3.6);

        // Terrace tables under the awning, laid for lunch.
        const clothMat = new THREE.MeshLambertMaterial({ color: 0xd8ebf2 });
        [[-11.5, 5.5], [-7.2, 6.4]].forEach(([tx, tz]) => {
            const table = new THREE.Group();
            const top = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.12, 16), clothMat);
            top.position.y = 1.0;
            top.castShadow = true;
            table.add(top);
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 1.0, 8),
                new THREE.MeshLambertMaterial({ color: 0x6b5a48 }));
            leg.position.y = 0.5;
            table.add(leg);
            // A carafe and two glasses.
            const carafe = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 0.42, 10),
                new THREE.MeshLambertMaterial({ color: 0xe8c46a }));
            carafe.position.y = 1.27;
            table.add(carafe);
            [-0.4, 0.4].forEach((gx) => {
                const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.2, 8),
                    new THREE.MeshLambertMaterial({ color: 0xd6ecf5 }));
                glass.position.set(gx, 1.16, 0.2);
                table.add(glass);
                const chair = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.5),
                    new THREE.MeshLambertMaterial({ color: 0x8a6a4a }));
                chair.position.set(gx * 3, 0.75, 0);
                table.add(chair);
            });
            table.position.set(tx, 0, tz);
            group.add(table);
            this._prop(center, tx, tz, 0.9, 0.9, 1.1);
        });

        // --- the bus, parked at the island's kerb ---
        const bus = new THREE.Group();
        const busBody = new THREE.MeshLambertMaterial({ color: 0x2f7fc4 });
        const glassMat = new THREE.MeshLambertMaterial({ color: 0x1e2f3d });

        const chassis = new THREE.Mesh(new THREE.BoxGeometry(8.4, 2.4, 2.8), busBody);
        chassis.position.y = 1.9;
        chassis.castShadow = true;
        bus.add(chassis);
        // Rounded roof cap.
        const busRoof = new THREE.Mesh(new THREE.CylinderGeometry(1.42, 1.42, 8.4, 12, 1, false, 0, Math.PI), busBody);
        busRoof.rotation.z = Math.PI / 2;
        busRoof.position.y = 3.1;
        bus.add(busRoof);
        // A white livery band down the flanks.
        const band = new THREE.Mesh(new THREE.BoxGeometry(8.5, 0.45, 2.85),
            new THREE.MeshLambertMaterial({ color: 0xf2f2ee }));
        band.position.y = 1.2;
        bus.add(band);

        // Side windows and a windscreen.
        for (let i = 0; i < 5; i++) {
            [-1, 1].forEach((side) => {
                const win = new THREE.Mesh(new THREE.BoxGeometry(1.25, 1.0, 0.1), glassMat);
                win.position.set(-3.1 + i * 1.55, 2.5, side * 1.42);
                bus.add(win);
            });
        }
        const screen = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 2.3), glassMat);
        screen.position.set(4.22, 2.5, 0);
        bus.add(screen);

        // Destination blind above the windscreen.
        const blind = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.4, 1.8),
            new THREE.MeshLambertMaterial({ color: 0x1a1a18 }));
        blind.position.set(4.24, 3.2, 0);
        bus.add(blind);

        // Doors, wheels, mirrors.
        const doorB = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.9, 0.1),
            new THREE.MeshLambertMaterial({ color: 0x24506e }));
        doorB.position.set(2.3, 1.65, 1.42);
        bus.add(doorB);
        const tyre = new THREE.MeshLambertMaterial({ color: 0x1c1b19 });
        [[-2.8, 1], [-2.8, -1], [2.9, 1], [2.9, -1]].forEach(([wx, ws]) => {
            const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.66, 0.42, 14), tyre);
            wheel.rotation.x = Math.PI / 2;
            wheel.position.set(wx, 0.66, ws * 1.32);
            bus.add(wheel);
        });

        bus.position.set(9.5, 0, -4.5);
        bus.rotation.y = -0.35;
        group.add(bus);
        this.occluders.push(bus);
        this._prop(center, 9.5, -4.5, 4.0, 2.0, 3.4);

        // A bus stop pole and sign next to it.
        const stopPole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3, 7),
            new THREE.MeshLambertMaterial({ color: 0x8f959c }));
        stopPole.position.set(6.2, 1.5, -2.2);
        group.add(stopPole);
        const stopSign = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.08),
            new THREE.MeshLambertMaterial({ color: 0x2f7fc4 }));
        stopSign.position.set(6.2, 3.0, -2.2);
        group.add(stopSign);

        // --- the elders: three old-timers with canes and worry beads ---
        const buildElder = (coatColor, hasCane, stoop) => {
            const elder = new THREE.Group();
            const coat = new THREE.MeshLambertMaterial({ color: coatColor });
            const skin = new THREE.MeshLambertMaterial({ color: 0xe0bb92 });
            const whiteHair = new THREE.MeshLambertMaterial({ color: 0xe8e6e0 });

            const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.62, 4, 10), coat);
            torso.position.y = 1.15;
            torso.rotation.x = stoop;   // the years bend them forward
            torso.castShadow = true;
            elder.add(torso);

            const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 10), skin);
            head.position.set(0, 1.78, stoop * 0.4);
            elder.add(head);

            // Bald crown ringed with white hair, plus a full white beard.
            const hairRing = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.06, 6, 14), whiteHair);
            hairRing.position.set(0, 1.8, stoop * 0.4);
            hairRing.rotation.x = Math.PI / 2 - 0.2;
            elder.add(hairRing);
            const beard = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), whiteHair);
            beard.position.set(0, 1.62, stoop * 0.4 + 0.16);
            beard.scale.set(0.9, 1.1, 0.7);
            elder.add(beard);
            const mous = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.07, 0.08), whiteHair);
            mous.position.set(0, 1.76, stoop * 0.4 + 0.24);
            elder.add(mous);

            // A flat cap, the way they actually dress.
            const cap = new THREE.Mesh(
                new THREE.SphereGeometry(0.29, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2),
                new THREE.MeshLambertMaterial({ color: 0x4a4a42 })
            );
            cap.position.set(0, 1.86, stoop * 0.4);
            cap.scale.y = 0.7;
            elder.add(cap);
            const peak = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.22),
                new THREE.MeshLambertMaterial({ color: 0x4a4a42 }));
            peak.position.set(0, 1.87, stoop * 0.4 + 0.26);
            elder.add(peak);

            const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 0.9, 8),
                new THREE.MeshLambertMaterial({ color: 0x3d4048 }));
            legs.position.y = 0.45;
            elder.add(legs);

            [-1, 1].forEach((side) => {
                const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.48, 4, 8), coat);
                arm.position.set(side * 0.4, 1.2, 0.06);
                arm.rotation.z = side * 0.3;
                elder.add(arm);
            });

            if (hasCane) {
                const cane = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 6),
                    new THREE.MeshLambertMaterial({ color: 0x6b4a2a }));
                cane.position.set(0.55, 0.75, 0.25);
                elder.add(cane);
                const crook = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.045, 5, 10, Math.PI),
                    new THREE.MeshLambertMaterial({ color: 0x6b4a2a }));
                crook.position.set(0.55, 1.5, 0.25);
                crook.rotation.y = Math.PI / 2;
                elder.add(crook);
            } else {
                // Worry beads (komboloi) dangling from one hand.
                for (let i = 0; i < 6; i++) {
                    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.05, 7, 6),
                        new THREE.MeshLambertMaterial({ color: 0x8a3f2a }));
                    bead.position.set(-0.56, 0.92 - i * 0.09, 0.14);
                    elder.add(bead);
                }
            }
            return elder;
        };

        // Seated around a bench outside the taverna, mid-argument.
        const bench = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.2, 0.7),
            new THREE.MeshLambertMaterial({ color: 0x7a5a3a }));
        bench.position.set(9.2, 0.85, 6.5);
        bench.rotation.y = -0.4;
        bench.castShadow = true;
        group.add(bench);
        [-1.2, 1.2].forEach((bx) => {
            const legB = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.85, 0.6),
                new THREE.MeshLambertMaterial({ color: 0x5c4229 }));
            legB.position.set(9.2 + bx * Math.cos(-0.4), 0.42, 6.5 + bx * Math.sin(-0.4));
            group.add(legB);
        });

        [
            [8.2, 5.6, 0x6b6f7a, true, 0.16],
            [10.4, 7.2, 0x7a5c4a, false, 0.22],
            [6.6, 8.4, 0x4f6b5c, true, 0.12]
        ].forEach(([ex, ez, color, cane, stoop], i) => {
            const elder = buildElder(color, cane, stoop);
            elder.position.set(ex, 0, ez);
            // Turned toward one another, the way a conversation actually stands.
            elder.rotation.y = Math.atan2(8.4 - ex, 7.0 - ez) + (i - 1) * 0.3;
            group.add(elder);
            this.occluders.push(elder);
            this._prop(center, ex, ez, 0.5, 0.5, 2.0);
        });

        // --- the certificate: framed, on an easel, lit like an exhibit ---
        const easel = new THREE.Group();
        const woodMat = new THREE.MeshLambertMaterial({ color: 0x8a6a42 });
        [-1, 1].forEach((side) => {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.0, 6), woodMat);
            leg.position.set(side * 0.7, 1.5, 0);
            leg.rotation.z = -side * 0.2;
            easel.add(leg);
        });
        const backLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.0, 6), woodMat);
        backLeg.position.set(0, 1.5, -0.6);
        backLeg.rotation.x = 0.28;
        easel.add(backLeg);
        const ledge = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 0.2), woodMat);
        ledge.position.y = 1.2;
        easel.add(ledge);

        // Gilt frame with a parchment face, a wax seal and ribbon.
        const frame = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.5, 0.12),
            new THREE.MeshLambertMaterial({ color: 0xd4af37 }));
        frame.position.set(0, 2.0, 0.05);
        frame.rotation.x = -0.12;
        frame.castShadow = true;
        easel.add(frame);
        const parchment = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.2, 0.04),
            new THREE.MeshLambertMaterial({ color: 0xf7f1dd }));
        parchment.position.set(0, 2.0, 0.13);
        parchment.rotation.x = -0.12;
        easel.add(parchment);
        // Ruled lines of "text" and a signature stroke.
        for (let i = 0; i < 4; i++) {
            const line = new THREE.Mesh(new THREE.BoxGeometry(1.15 - i * 0.12, 0.055, 0.02),
                new THREE.MeshLambertMaterial({ color: 0x8a7f66 }));
            line.position.set(0, 2.25 - i * 0.22, 0.16);
            line.rotation.x = -0.12;
            easel.add(line);
        }
        const seal = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 12),
            new THREE.MeshLambertMaterial({ color: 0xb02b2b }));
        seal.position.set(0.55, 1.62, 0.18);
        seal.rotation.x = Math.PI / 2 - 0.12;
        easel.add(seal);
        [-0.3, 0.3].forEach((rx) => {
            const ribbon = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.36, 0.02),
                new THREE.MeshLambertMaterial({ color: 0xb02b2b }));
            ribbon.position.set(0.55 + rx * 0.2, 1.38, 0.17);
            ribbon.rotation.z = rx;
            easel.add(ribbon);
        });

        easel.position.set(-8.5, 0, -7.5);
        easel.rotation.y = 0.55;
        group.add(easel);
        this.occluders.push(easel);
        this._prop(center, -8.5, -7.5, 1.0, 0.7, 2.8);

        const exhibitLight = new THREE.PointLight(0xfff0cc, 1.0, 10, 2);
        exhibitLight.position.set(-8.5, 3.6, -6.2);
        group.add(exhibitLight);
    }

    // (h) Camunda — the global market: a covered marketplace of stalls, a
    // slowly turning globe, and an airliner banking overhead.
    _dressGlobalMarket(group, center) {
        // --- the marketplace: a row of striped stalls with goods on the trestle ---
        const timber = new THREE.MeshLambertMaterial({ color: 0x8a6440 });
        const crateWood = new THREE.MeshLambertMaterial({ color: 0xb08a58 });

        const buildStall = (canopyA, canopyB, goodsColors) => {
            const stall = new THREE.Group();

            // Four corner posts and a trestle counter.
            [[-1.5, -1], [1.5, -1], [-1.5, 1], [1.5, 1]].forEach(([px, pz]) => {
                const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.6, 6), timber);
                post.position.set(px, 1.3, pz);
                stall.add(post);
            });
            const counter = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.14, 1.3), timber);
            counter.position.set(0, 1.05, 0.5);
            counter.castShadow = true;
            stall.add(counter);

            // Striped canopy, pitched forward over the counter.
            for (let i = 0; i < 7; i++) {
                const strip = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.07, 2.8),
                    new THREE.MeshLambertMaterial({ color: i % 2 ? canopyA : canopyB }));
                strip.position.set(-1.56 + i * 0.52, 2.62, 0.15);
                stall.add(strip);
            }
            const valance = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.34, 0.08),
                new THREE.MeshLambertMaterial({ color: canopyA }));
            valance.position.set(0, 2.44, 1.5);
            stall.add(valance);

            // Produce: heaped spheres in open crates on the counter.
            goodsColors.forEach((color, gi) => {
                const tray = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.22, 0.8), crateWood);
                tray.position.set(-1.05 + gi * 1.05, 1.23, 0.5);
                stall.add(tray);
                const goodMat = new THREE.MeshLambertMaterial({ color });
                for (let g = 0; g < 7; g++) {
                    const item = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), goodMat);
                    item.position.set(
                        -1.05 + gi * 1.05 + (Math.random() - 0.5) * 0.55,
                        1.4 + Math.random() * 0.12,
                        0.5 + (Math.random() - 0.5) * 0.5
                    );
                    stall.add(item);
                }
            });

            // A sack and a stacked crate at the stall's foot.
            const sack = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.3, 4, 8),
                new THREE.MeshLambertMaterial({ color: 0xc7b189 }));
            sack.position.set(-1.7, 0.42, 1.3);
            stall.add(sack);
            const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), crateWood);
            box.position.set(1.7, 0.3, 1.3);
            stall.add(box);

            return stall;
        };

        // The fourth stall (by the globe) was swapped out for the clockwork
        // gear machine below — a workflow engine earns a machine that
        // visibly runs before a fruit table.
        const stalls = [
            { pos: [-10, -6.5], rot: 0.6, a: 0xd0453c, b: 0xf5efe2, goods: [0xe0632d, 0xd8352f, 0xe8b73a] },
            { pos: [-11, 1.5], rot: 1.05, a: 0x2f7fa8, b: 0xf5efe2, goods: [0x6fae3c, 0x3f8f4a, 0xc7d84a] },
            { pos: [-9, 8.5], rot: 1.5, a: 0x4f8a3c, b: 0xf5efe2, goods: [0x9a5ac0, 0xd8437a, 0x5a7fd0] }
        ];
        stalls.forEach(({ pos, rot, a, b, goods }) => {
            const stall = buildStall(a, b, goods);
            stall.position.set(pos[0], 0, pos[1]);
            stall.rotation.y = rot;
            group.add(stall);
            this.occluders.push(stall);
            this._prop(center, pos[0], pos[1], 1.8, 1.4, 2.6);
        });

        // Bunting strung between the stalls, so the row reads as one market.
        const buntingColors = [0xd0453c, 0xe8b73a, 0x2f7fa8, 0x4f8a3c, 0xd8437a];
        for (let i = 0; i < 22; i++) {
            const t = i / 21;
            const flag = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.4, 3),
                new THREE.MeshLambertMaterial({
                    color: buntingColors[i % buntingColors.length], side: THREE.DoubleSide
                }));
            // Slack catenary between the two end stalls on the west side.
            flag.position.set(
                -10 + t * 1.5,
                3.4 - Math.sin(t * Math.PI) * 0.9,
                -6.5 + t * 15
            );
            flag.rotation.x = Math.PI;
            group.add(flag);
        }

        // --- the earth: a globe on a tilted axis, turning in place ---
        const globeGroup = new THREE.Group();

        const globe = new THREE.Mesh(
            new THREE.SphereGeometry(2.6, 32, 24),
            new THREE.MeshLambertMaterial({ map: makeEarthTexture() })
        );
        globe.castShadow = true;
        globeGroup.add(globe);
        this.globes = this.globes || [];
        this.globes.push(globe);

        // Meridian ring and the stand it hangs in, like a library globe.
        const brass = new THREE.MeshLambertMaterial({ color: 0xc9a227 });
        const meridian = new THREE.Mesh(new THREE.TorusGeometry(2.95, 0.1, 8, 30), brass);
        meridian.rotation.y = Math.PI / 2;
        globeGroup.add(meridian);

        // Set off the centre line: local x = 0 is the corridor the player walks
        // in on from the south bridge, and the globe is wide enough to block it.
        const GLOBE_X = 7.5;
        const GLOBE_Z = -9.5;
        globeGroup.position.set(GLOBE_X, 4.6, GLOBE_Z);
        globeGroup.rotation.z = 0.41;   // Earth's axial tilt, near enough
        group.add(globeGroup);
        this.occluders.push(globeGroup);

        const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.3, 2.0, 14), brass);
        pedestal.position.set(GLOBE_X, 1.0, GLOBE_Z);
        pedestal.castShadow = true;
        group.add(pedestal);
        const stemG = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.2, 10), brass);
        stemG.position.set(GLOBE_X, 2.4, GLOBE_Z);
        group.add(stemG);
        this._prop(center, GLOBE_X, GLOBE_Z, 1.5, 1.5, 3.0);

        // --- the hourglass: process, time and orchestration ---
        // Camunda is a workflow engine, so an hourglass belongs here as much as
        // the globe does. The sand actually runs: the upper cone empties and the
        // lower pile grows, looping, driven from _updateProps.
        const hourglass = new THREE.Group();
        const frameMat = new THREE.MeshLambertMaterial({ color: 0x8a5a2b });
        const glassMat = new THREE.MeshLambertMaterial({
            color: 0xd8ecf5, transparent: true, opacity: 0.28
        });
        const sandMat = new THREE.MeshLambertMaterial({ color: 0xe0b552 });

        const BULB_H = 1.5;      // height of each glass cone
        const BULB_R = 1.05;     // radius at the wide end

        // End plates, top and bottom.
        [-1, 1].forEach((side) => {
            const plate = new THREE.Mesh(
                new THREE.CylinderGeometry(BULB_R + 0.22, BULB_R + 0.22, 0.18, 20), frameMat
            );
            plate.position.y = 3.1 + side * (BULB_H + 0.09);
            plate.castShadow = true;
            hourglass.add(plate);
        });

        // Three uprights joining the plates.
        for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI * 2;
            const post = new THREE.Mesh(
                new THREE.CylinderGeometry(0.075, 0.075, (BULB_H + 0.09) * 2, 8), frameMat
            );
            post.position.set(
                Math.cos(a) * (BULB_R + 0.14), 3.1, Math.sin(a) * (BULB_R + 0.14)
            );
            post.castShadow = true;
            hourglass.add(post);
        }

        // The two glass bulbs, meeting at the waist.
        [-1, 1].forEach((side) => {
            const bulb = new THREE.Mesh(
                new THREE.ConeGeometry(BULB_R, BULB_H, 24, 1, true), glassMat
            );
            bulb.material.side = THREE.DoubleSide;
            bulb.position.y = 3.1 + side * BULB_H / 2;
            // Point each cone's apex at the waist between them.
            bulb.rotation.x = side > 0 ? Math.PI : 0;
            hourglass.add(bulb);
        });

        // Sand: an inverted cone filling the top bulb (wide at the top,
        // tapering to the waist, following the glass), and a cone-shaped pile
        // heaping up in the bottom. Both are scaled in _updateProps.
        //
        // ConeGeometry points +y by default, so the top charge is flipped to
        // match the upper bulb's downward taper; without that it renders as a
        // spike poking out through the glass.
        const sandTop = new THREE.Mesh(
            new THREE.ConeGeometry(BULB_R * 0.9, BULB_H * 0.88, 24), sandMat
        );
        sandTop.rotation.x = Math.PI;
        sandTop.position.y = 3.1 + BULB_H * 0.44;
        hourglass.add(sandTop);

        const sandBottom = new THREE.Mesh(
            new THREE.ConeGeometry(BULB_R * 0.86, BULB_H * 0.55, 24), sandMat
        );
        sandBottom.position.y = 3.1 - BULB_H + 0.28;
        hourglass.add(sandBottom);

        // The falling stream at the waist.
        const stream = new THREE.Mesh(
            new THREE.CylinderGeometry(0.045, 0.045, BULB_H * 0.85, 8), sandMat
        );
        stream.position.y = 3.1 - BULB_H * 0.4;
        hourglass.add(stream);

        hourglass.position.set(-6.5, 0, -9.5);
        hourglass.rotation.y = 0.4;
        group.add(hourglass);
        this.occluders.push(hourglass);
        this._prop(center, -6.5, -9.5, 1.4, 1.4, 4.8);

        // A plinth, so it reads as an exhibit rather than dropped on the grass.
        const plinth = new THREE.Mesh(
            new THREE.CylinderGeometry(1.35, 1.6, 1.5, 18), frameMat
        );
        plinth.position.set(-6.5, 0.75, -9.5);
        plinth.castShadow = true;
        plinth.receiveShadow = true;
        group.add(plinth);

        this.hourglasses = this.hourglasses || [];
        this.hourglasses.push({
            top: sandTop, bottom: sandBottom, stream,
            bulbH: BULB_H, baseY: 3.1, phase: 0
        });

        // --- the gear machine: a workflow engine's clockwork, out in the open
        // where the fourth market stall used to stand, beside the globe. Three
        // meshed cogs turn continuously, driven from _updateProps — the big
        // drive gear and two smaller ones meshed to its rim, geared so their
        // teeth counts set the relative speeds and alternate spin direction.
        const gearMachine = new THREE.Group();
        const gearMat = new THREE.MeshLambertMaterial({ color: 0xb0762f });
        const gearMatDark = new THREE.MeshLambertMaterial({ color: 0x8a5a24 });
        const frameBrass = new THREE.MeshLambertMaterial({ color: 0xc9a227 });

        // A toothed disc: a flat cylinder with small tooth blocks around the rim.
        const makeGear = (radius, thickness, teeth, mat) => {
            const gear = new THREE.Group();
            const hub = new THREE.Mesh(
                new THREE.CylinderGeometry(radius, radius, thickness, 24), mat
            );
            hub.rotation.x = Math.PI / 2;
            hub.castShadow = true;
            gear.add(hub);
            const toothW = radius * 0.34;
            for (let i = 0; i < teeth; i++) {
                const a = (i / teeth) * Math.PI * 2;
                const tooth = new THREE.Mesh(
                    new THREE.BoxGeometry(toothW, toothW, thickness), mat
                );
                tooth.position.set(Math.cos(a) * radius, Math.sin(a) * radius, 0);
                tooth.rotation.z = a;
                gear.add(tooth);
            }
            // Axle nub through the centre.
            const axle = new THREE.Mesh(
                new THREE.CylinderGeometry(radius * 0.18, radius * 0.18, thickness + 0.14, 10),
                frameBrass
            );
            axle.rotation.x = Math.PI / 2;
            gear.add(axle);
            return gear;
        };

        // Backboard the gears turn against, so they read as a machine rather
        // than spinning discs floating in mid-air.
        const board = new THREE.Mesh(
            new THREE.BoxGeometry(3.6, 3.6, 0.3),
            new THREE.MeshLambertMaterial({ color: 0x5a3f26 })
        );
        board.position.set(0, 2.1, -0.3);
        board.castShadow = true;
        board.receiveShadow = true;
        gearMachine.add(board);

        // Big drive gear, lower-left, and two smaller driven gears meshed to
        // its rim — spaced so their teeth visually interlock with the driver.
        const bigGear = makeGear(1.1, 0.32, 16, gearMat);
        bigGear.position.set(-0.8, 1.5, 0);
        gearMachine.add(bigGear);

        const midGear = makeGear(0.72, 0.32, 11, gearMatDark);
        midGear.position.set(0.75, 2.35, 0.05);
        gearMachine.add(midGear);

        const smallGear = makeGear(0.5, 0.32, 8, gearMat);
        smallGear.position.set(0.55, 0.85, 0.05);
        gearMachine.add(smallGear);

        // A frame around the board, and four legs planting it on the ground.
        const frame = new THREE.Mesh(new THREE.TorusGeometry(2.15, 0.12, 6, 4), frameBrass);
        frame.rotation.z = Math.PI / 4;
        frame.position.set(0, 2.1, -0.3);
        frame.scale.set(1, 1, 0.5);
        gearMachine.add(frame);
        [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]].forEach(([lx, ly]) => {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.1, 8), frameBrass);
            leg.position.set(lx, 1.05, -0.3 + ly * 0.05);
            leg.castShadow = true;
            gearMachine.add(leg);
        });

        gearMachine.position.set(11, 0, -1.5);
        gearMachine.rotation.y = -1.2;
        group.add(gearMachine);
        this.occluders.push(gearMachine);
        this._prop(center, 11, -1.5, 2.0, 1.6, 4.2);

        this.gearMachines = this.gearMachines || [];
        this.gearMachines.push(
            { mesh: bigGear, speed: 0.9 },
            { mesh: midGear, speed: -0.9 * (16 / 11) },
            { mesh: smallGear, speed: 0.9 * (16 / 8) }
        );

        // --- the airplane: an airliner banking over the island on a loop ---
        const plane = new THREE.Group();
        const fuselageMat = new THREE.MeshLambertMaterial({ color: 0xf2f4f7 });
        const liveryMat = new THREE.MeshLambertMaterial({ color: 0xe25b32 });
        const engineMat = new THREE.MeshLambertMaterial({ color: 0x5a6067 });

        const fuselage = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 4.4, 6, 12), fuselageMat);
        fuselage.rotation.z = Math.PI / 2;
        fuselage.castShadow = true;
        plane.add(fuselage);

        // Nose cone and a tail that tapers up.
        const nose = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), fuselageMat);
        nose.position.x = 2.75;
        nose.scale.x = 1.4;
        plane.add(nose);

        // Cabin windows as a stripe down each side.
        for (let i = 0; i < 12; i++) {
            [-1, 1].forEach((side) => {
                const win = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.04),
                    new THREE.MeshLambertMaterial({ color: 0x2b3a48 }));
                win.position.set(-2 + i * 0.38, 0.12, side * 0.48);
                plane.add(win);
            });
        }
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.16, 1.02), liveryMat);
        stripe.position.y = -0.12;
        plane.add(stripe);

        // Swept wings.
        [-1, 1].forEach((side) => {
            const wing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 3.6), fuselageMat);
            wing.position.set(-0.2, -0.1, side * 2.0);
            wing.rotation.y = side * 0.32;
            wing.rotation.x = -side * 0.06;
            wing.castShadow = true;
            plane.add(wing);

            const winglet = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.1), liveryMat);
            winglet.position.set(-0.75, 0.2, side * 3.6);
            plane.add(winglet);

            const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.28, 1.0, 12), engineMat);
            engine.rotation.z = Math.PI / 2;
            engine.position.set(0.2, -0.42, side * 1.9);
            plane.add(engine);
        });

        // Tailplane and fin.
        const fin = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.6, 0.12), liveryMat);
        fin.position.set(-2.3, 0.9, 0);
        fin.rotation.z = -0.3;
        plane.add(fin);
        [-1, 1].forEach((side) => {
            const tailplane = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.09, 1.3), fuselageMat);
            tailplane.position.set(-2.4, 0.25, side * 0.75);
            tailplane.rotation.y = side * 0.3;
            plane.add(tailplane);
        });

        // Contrails streaming off both engines.
        const trailMat = new THREE.MeshLambertMaterial({
            color: 0xffffff, transparent: true, opacity: 0.32
        });
        [-1, 1].forEach((side) => {
            const trail = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.3, 6, 8), trailMat);
            trail.rotation.z = Math.PI / 2;
            trail.position.set(-3.4, -0.42, side * 1.9);
            plane.add(trail);
        });

        plane.scale.setScalar(1.15);
        group.add(plane);
        // Flown in update(): a wide banked circle above the island, so it is
        // always somewhere in the sky rather than parked on the ground.
        this.flyingPlanes = this.flyingPlanes || [];
        this.flyingPlanes.push({ mesh: plane, radius: 26, height: 22, speed: 0.22, phase: 0 });
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

            // One crest already hangs inside; a second one on the outer face
            // duplicated it for no reason, so it's gone.

            // One card on each front corner of the temple, angled outward so
            // they come into view in sequence as the player walks forward out
            // of the colonnade — rather than both stacked dead-centre over the
            // roof, where the chase camera never looked.
            const sign = makeLabelSprite(`${edu.degree} · ${edu.fieldOfStudy}`, {
                fontSize: 34, worldWidth: 8
            });
            sign.position.set(-HALF_W + 1, entabY - 1.5, HALF_D + 0.9);
            group.add(sign);

            const school = makeLabelSprite(`${edu.school} (${edu.startYear}–${edu.endYear})`, {
                fontSize: 28, color: '#ffe0a0', bg: 'rgba(40,24,12,0.8)', worldWidth: 9
            });
            school.position.set(HALF_W - 1, entabY - 1.5, HALF_D + 0.9);
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

        // A small library along the interior's east side, mirroring the crest
        // on the west: tall shelves stacked with books, and a reading table
        // with a couple of open volumes. Purely decorative set dressing, kept
        // clear of the crates, graduates and the |x| < 5 doorway corridor.
        const shelfMat = new THREE.MeshLambertMaterial({ color: 0x6b4423 });
        const bookColors = [0xb0342f, 0x2f5f8a, 0x3f8a4a, 0xc9a227, 0x7a3f8a, 0xd8752f];
        const buildBookshelf = () => {
            const shelf = new THREE.Group();
            const W = 2.6, H = 4.2, D = 0.6;

            // Frame: back panel plus top/bottom/side boards.
            const back = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.1), shelfMat);
            back.position.set(0, H / 2, -D / 2 + 0.05);
            shelf.add(back);
            [0, H].forEach((y) => {
                const board = new THREE.Mesh(new THREE.BoxGeometry(W, 0.1, D), shelfMat);
                board.position.set(0, y, 0);
                shelf.add(board);
            });
            [-1, 1].forEach((side) => {
                const side_ = new THREE.Mesh(new THREE.BoxGeometry(0.1, H, D), shelfMat);
                side_.position.set(side * W / 2, H / 2, 0);
                shelf.add(side_);
            });

            // Four shelf boards, each packed with a row of upright books.
            const shelfCount = 4;
            for (let s = 1; s < shelfCount; s++) {
                const y = (H / shelfCount) * s;
                const board = new THREE.Mesh(new THREE.BoxGeometry(W, 0.08, D), shelfMat);
                board.position.set(0, y, 0);
                shelf.add(board);
            }
            for (let s = 0; s < shelfCount; s++) {
                const rowY = (H / shelfCount) * s + 0.08;
                const rowH = H / shelfCount - 0.14;
                let bx = -W / 2 + 0.15;
                let i = 0;
                while (bx < W / 2 - 0.15) {
                    const bw = 0.14 + Math.random() * 0.1;
                    const bh = rowH * (0.75 + Math.random() * 0.22);
                    const book = new THREE.Mesh(
                        new THREE.BoxGeometry(bw, bh, D - 0.14),
                        new THREE.MeshLambertMaterial({ color: bookColors[i % bookColors.length] })
                    );
                    book.position.set(bx + bw / 2, rowY + bh / 2, 0);
                    book.rotation.z = (Math.random() - 0.5) * 0.05;
                    book.castShadow = true;
                    shelf.add(book);
                    bx += bw + 0.03;
                    i++;
                }
            }
            return shelf;
        };

        [[HALF_W - 1.2, -3.2, -Math.PI / 2], [HALF_W - 1.2, 3.2, -Math.PI / 2]].forEach(
            ([sx, sz, rotY]) => {
                const shelf = buildBookshelf();
                shelf.position.set(sx, BASE_TOP, sz);
                shelf.rotation.y = rotY;
                group.add(shelf);
                this.occluders.push(shelf);
                this._prop(center, sx, sz, 1.5, 0.5, 4.2);
                this.colliders.push({
                    x: center.x + sx, z: center.z + sz, halfX: 1.4, halfZ: 0.4, top: BASE_TOP + 4.2
                });
            }
        );

        // A reading table between the two shelves, with a couple of books
        // left open on top.
        const tableMat = new THREE.MeshLambertMaterial({ color: 0x8a6440 });
        const table = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.12, 1.1), tableMat);
        table.position.set(HALF_W - 3.2, BASE_TOP + 0.75, 0);
        table.castShadow = true;
        group.add(table);
        [[-0.7, 0], [0.7, 0]].forEach(([lx, lz]) => {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.75, 6), tableMat);
            leg.position.set(HALF_W - 3.2 + lx, BASE_TOP + 0.375, lz);
            group.add(leg);
        });
        bookColors.slice(0, 2).forEach((color, i) => {
            const openBook = new THREE.Mesh(
                new THREE.BoxGeometry(0.5, 0.05, 0.36),
                new THREE.MeshLambertMaterial({ color })
            );
            openBook.position.set(HALF_W - 3.2 + (i - 0.5) * 0.6, BASE_TOP + 0.84, 0.1);
            openBook.rotation.y = (Math.random() - 0.5) * 0.6;
            group.add(openBook);
        });
        this._prop(center, HALF_W - 3.2, 0, 1.2, 0.8, 1.3);

        // Fellow graduates milling around the colonnade — capped and gowned,
        // destructible like the cat and the giant rather than lore-bearing.
        // Kept clear of the columns, the crates and the |x| < 5 doorway
        // corridor at each end.
        [
            [-8, -5, 0.6],
            [8, -6, -0.7],
            [0, 8.5, 3.4]
        ].forEach(([gx, gz, rot]) => {
            const grad = this._buildGraduate();
            grad.position.set(center.x + gx, BASE_TOP, center.z + gz);
            grad.rotation.y = rot;
            group.add(grad);
            this.occluders.push(grad);
            this._prop(center, gx, gz, 0.5, 0.5, 1.9);
            this._registerNPC(grad, center.x + gx, center.z + gz, 1.0, 1.9);
        });

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
        this._updateNPCs(dt);

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
        this._updateSnowfall(dt);
        this._updateProps(dt, time);

        if (this.ocean) {
            this.ocean.position.y = -6 + Math.sin(time * 0.7) * 0.12;
        }
    }

    // Sets how heavily it's snowing over the second Upstream island, 0
    // (none) to 1 (full) — called every frame from Game._updateAtmosphere
    // with an eased value, so the snow ramps in/out with the rest of the
    // "chilly" atmosphere rather than switching on abruptly.
    setSnow(intensity) {
        this._snowIntensity = intensity;
    }

    // Light, continuous snowfall scoped to the second Upstream island: flakes
    // spawn in a disc above it, drift down with a little sideways sway, and
    // are culled on reaching the ground or ageing out — same spawn-timer +
    // per-particle age/move/cull shape as _updateSmoke, just falling instead
    // of rising and spread continuously rather than puffing from one point.
    _updateSnowfall(dt) {
        if (this._snowIntensity < 0.02 && this.snowflakes.length === 0) return;

        if (!this._snowCenter) {
            // Index 6 is the second Upstream visit — see STAGE_BY_ZONE in
            // main.js for the full zone-index-to-company mapping.
            const upstream2nd = this.zones.find((z) => z.index === 6);
            if (!upstream2nd) return;
            this._snowCenter = upstream2nd.center;
            this._snowGeo = new THREE.SphereGeometry(0.05, 5, 4);
            this._snowMat = new THREE.MeshBasicMaterial({
                color: 0xffffff, transparent: true, opacity: 0.85, fog: false
            });
            this._snowTimer = 0;
        }

        // Spawn rate scales with intensity — full chill keeps a light but
        // steady flurry going; fading out just stops making new flakes and
        // lets the existing ones finish falling.
        this._snowTimer -= dt;
        if (this._snowTimer <= 0 && this._snowIntensity > 0.05) {
            this._snowTimer = THREE.MathUtils.lerp(0.35, 0.03, this._snowIntensity);
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.random() * (ZONE_RADIUS - 1);
            const flake = new THREE.Mesh(this._snowGeo, this._snowMat);
            flake.position.set(
                this._snowCenter.x + Math.cos(angle) * radius,
                14 + Math.random() * 6,
                this._snowCenter.z + Math.sin(angle) * radius
            );
            flake.userData.sway = Math.random() * Math.PI * 2;
            flake.userData.fallSpeed = 1.6 + Math.random() * 1.0;
            this.scene.add(flake);
            this.snowflakes.push(flake);
        }

        for (let i = this.snowflakes.length - 1; i >= 0; i--) {
            const flake = this.snowflakes[i];
            flake.position.y -= flake.userData.fallSpeed * dt;
            flake.userData.sway += dt * 1.3;
            flake.position.x += Math.sin(flake.userData.sway) * dt * 0.3;
            if (flake.position.y < -1) {
                this.scene.remove(flake);
                this.snowflakes.splice(i, 1);
            }
        }
    }

    // Animated set dressing: the Vienna ferris wheel, the Camunda globe and the
    // airliner circling above it. All three are optional — an island that was
    // never decorated simply has nothing in these lists.
    _updateProps(dt, time) {
        // Riesenrad: the rim turns, and each gondola counter-rotates so it
        // hangs level instead of tumbling with the wheel.
        for (const wheel of this.ferrisWheels || []) {
            wheel.rotation.z += dt * 0.22;
            for (const child of wheel.children) {
                if (child.userData.spinAngle === undefined) continue;
                child.rotation.z = -wheel.rotation.z;
            }
        }

        for (const globe of this.globes || []) {
            globe.rotation.y += dt * 0.12;
        }

        // Camunda's gear machine: each cog spins about the axle it was built
        // on (local z, since the hub is rotated to face outward). Speeds are
        // set in inverse proportion to tooth count so the meshing reads as
        // real gearing, alternating direction gear-to-gear.
        for (const gear of this.gearMachines || []) {
            gear.mesh.rotation.z += dt * gear.speed;
        }

        // The hourglass runs on a 14-second cycle: the upper cone drains into
        // the lower pile, then it flips back to full and starts again.
        for (const h of this.hourglasses || []) {
            const CYCLE = 14;
            h.phase = (h.phase + dt / CYCLE) % 1;
            const remaining = 1 - h.phase;

            // The upper charge shrinks toward the waist. Its cone is flipped
            // (rotation.x = π), so scaling y shortens it from the apex at the
            // waist upward — the sand level drops, which is what it should do.
            const left = Math.max(0.001, remaining);
            h.top.scale.set(Math.max(0.2, left), left, Math.max(0.2, left));
            h.top.position.y = h.baseY + h.bulbH * 0.44 * left;

            // Lower pile heaps up from the floor of the bottom bulb.
            const filled = Math.max(0.001, h.phase);
            h.bottom.scale.set(Math.max(0.25, filled), filled, Math.max(0.25, filled));
            h.bottom.position.y = h.baseY - h.bulbH + 0.28 * filled;

            // The stream only flows while there is sand left to fall.
            h.stream.visible = remaining > 0.02 && h.phase > 0.02;
        }

        // The airliner flies a banked circle. Position comes from the angle, and
        // the heading is the tangent to that circle, so the nose always leads.
        for (const p of this.flyingPlanes || []) {
            p.phase += dt * p.speed;
            const x = Math.cos(p.phase) * p.radius;
            const z = Math.sin(p.phase) * p.radius;
            p.mesh.position.set(x, p.height + Math.sin(p.phase * 2) * 1.4, z);
            // Local +x is the nose, so face the tangent direction.
            p.mesh.rotation.y = -p.phase - Math.PI / 2;
            p.mesh.rotation.z = -0.28;   // banked into the turn
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
