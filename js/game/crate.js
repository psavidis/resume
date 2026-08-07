// Breakable crates and collectible fruit.
//
// A crate carries a `payload` describing a slice of the resume; smashing it
// bursts into debris and hands the payload to the UI layer. Crate *kinds* are
// styled differently so the world reads at a glance: wooden crates hold project
// detail, metal ones need a spin, and "?" crates hide the fun extras.

import * as THREE from '../vendor/three.module.js';

const CRATE_SIZE = 1.5;

// Shared geometry/material keeps the draw calls and allocations down; every
// crate of a kind reuses the same GPU resources.
const boxGeo = new THREE.BoxGeometry(CRATE_SIZE, CRATE_SIZE, CRATE_SIZE);
const debrisGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);

const KINDS = {
    wood: { color: 0xb5813f, edge: 0x6d4a1f, label: '📦' },
    tnt: { color: 0xc0392b, edge: 0x7b241c, label: 'TNT' },
    metal: { color: 0x8d99a6, edge: 0x4d5860, label: '⚙' },
    mystery: { color: 0xf1c40f, edge: 0xb8930b, label: '?' },
    checkpoint: { color: 0x27ae60, edge: 0x14663a, label: '✓' }
};

// A canvas texture gives each crate its planked face and glyph without any
// image files. Cached per kind so we build each one only once.
const textureCache = new Map();

function crateTexture(kind) {
    if (textureCache.has(kind)) return textureCache.get(kind);

    const spec = KINDS[kind];
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#' + spec.color.toString(16).padStart(6, '0');
    ctx.fillRect(0, 0, size, size);

    // Border planks
    ctx.strokeStyle = '#' + spec.edge.toString(16).padStart(6, '0');
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, size - 10, size - 10);
    ctx.lineWidth = 5;
    ctx.strokeRect(18, 18, size - 36, size - 36);

    // Wood grain lines for the wooden kinds
    if (kind === 'wood' || kind === 'mystery') {
        ctx.globalAlpha = 0.18;
        for (let i = 0; i < 6; i++) {
            ctx.beginPath();
            ctx.moveTo(20, 24 + i * 15);
            ctx.lineTo(size - 20, 24 + i * 15);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }

    ctx.fillStyle = '#' + spec.edge.toString(16).padStart(6, '0');
    ctx.font = 'bold 46px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(spec.label, size / 2, size / 2 + 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    textureCache.set(kind, tex);
    return tex;
}

const materialCache = new Map();
function crateMaterial(kind) {
    if (!materialCache.has(kind)) {
        materialCache.set(kind, new THREE.MeshLambertMaterial({ map: crateTexture(kind) }));
    }
    return materialCache.get(kind);
}

export class Crate {
    /**
     * @param {object} opts
     * @param {THREE.Vector3} opts.position  world position of the crate centre
     * @param {string} opts.kind             one of KINDS
     * @param {object} opts.payload          resume content revealed on break
     */
    constructor({ position, kind = 'wood', payload = null }) {
        this.kind = kind;
        this.payload = payload;
        this.broken = false;
        this.size = CRATE_SIZE;
        this.hitsRemaining = kind === 'metal' ? 1 : 1;
        this.spinOnly = kind === 'metal'; // metal crates ignore a plain bump

        this.mesh = new THREE.Mesh(boxGeo, crateMaterial(kind));
        this.mesh.position.copy(position);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
        this.mesh.userData.crate = this;

        this.baseY = position.y;
        this.bobPhase = Math.random() * Math.PI * 2;
        this.debris = [];
    }

    get position() {
        return this.mesh.position;
    }

    // Axis-aligned overlap test against the player's capsule footprint.
    intersectsPlayer(playerPos, radius) {
        if (this.broken) return false;
        const half = this.size / 2;
        const dx = Math.abs(playerPos.x - this.mesh.position.x);
        const dz = Math.abs(playerPos.z - this.mesh.position.z);
        const dy = playerPos.y + 1.0 - this.mesh.position.y; // player centre vs crate centre
        return dx < half + radius && dz < half + radius && Math.abs(dy) < half + 1.0;
    }

    break(scene) {
        if (this.broken) return false;
        this.broken = true;
        scene.remove(this.mesh);

        // Burst of debris cubes that fall and fade; purely cosmetic, removed
        // once they settle.
        const mat = crateMaterial(this.kind);
        for (let i = 0; i < 10; i++) {
            const piece = new THREE.Mesh(debrisGeo, mat);
            piece.position.copy(this.mesh.position);
            piece.position.x += (Math.random() - 0.5) * 0.8;
            piece.position.y += (Math.random() - 0.5) * 0.8;
            piece.position.z += (Math.random() - 0.5) * 0.8;
            piece.userData.velocity = new THREE.Vector3(
                (Math.random() - 0.5) * 7,
                Math.random() * 7 + 2,
                (Math.random() - 0.5) * 7
            );
            piece.userData.spin = new THREE.Vector3(
                Math.random() * 8, Math.random() * 8, Math.random() * 8
            );
            piece.userData.life = 1.4;
            scene.add(piece);
            this.debris.push(piece);
        }
        return true;
    }

    updateDebris(dt, scene) {
        for (let i = this.debris.length - 1; i >= 0; i--) {
            const piece = this.debris[i];
            piece.userData.life -= dt;
            if (piece.userData.life <= 0) {
                scene.remove(piece);
                this.debris.splice(i, 1);
                continue;
            }
            piece.userData.velocity.y -= 30 * dt;
            piece.position.addScaledVector(piece.userData.velocity, dt);
            piece.rotation.x += piece.userData.spin.x * dt;
            piece.rotation.y += piece.userData.spin.y * dt;
            const floor = this.baseY - this.size / 2;
            if (piece.position.y < floor) {
                piece.position.y = floor;
                piece.userData.velocity.y *= -0.4;
                piece.userData.velocity.x *= 0.7;
                piece.userData.velocity.z *= 0.7;
            }
            piece.scale.setScalar(Math.min(1, piece.userData.life));
        }
    }

    update(dt, time) {
        if (this.broken) return;
        // Mystery and checkpoint crates hover and bob to draw the eye.
        if (this.kind === 'mystery' || this.kind === 'checkpoint') {
            this.mesh.position.y = this.baseY + Math.sin(time * 2 + this.bobPhase) * 0.15;
            this.mesh.rotation.y += dt * 0.8;
        }
    }
}

// ---------------------------------------------------------------------------
// Collectible fruit — the "wumpa" analogue. Represents a skill/technology.

const fruitGeo = new THREE.SphereGeometry(0.32, 12, 10);
const fruitMat = new THREE.MeshLambertMaterial({ color: 0xff8c1a, emissive: 0x3a1800 });
const leafGeo = new THREE.ConeGeometry(0.1, 0.22, 5);
const leafMat = new THREE.MeshLambertMaterial({ color: 0x2e9e4b });

export class Fruit {
    constructor(position, label) {
        this.label = label;
        this.collected = false;

        this.mesh = new THREE.Group();
        const berry = new THREE.Mesh(fruitGeo, fruitMat);
        berry.scale.set(1, 1.15, 1);
        berry.castShadow = true;
        this.mesh.add(berry);

        const leaf = new THREE.Mesh(leafGeo, leafMat);
        leaf.position.y = 0.36;
        leaf.rotation.z = 0.4;
        this.mesh.add(leaf);

        this.mesh.position.copy(position);
        this.baseY = position.y;
        this.phase = Math.random() * Math.PI * 2;
    }

    update(dt, time) {
        if (this.collected) return;
        this.mesh.rotation.y += dt * 2.2;
        this.mesh.position.y = this.baseY + Math.sin(time * 3 + this.phase) * 0.2;
    }

    intersectsPlayer(playerPos) {
        if (this.collected) return false;
        const dx = playerPos.x - this.mesh.position.x;
        const dz = playerPos.z - this.mesh.position.z;
        const dy = (playerPos.y + 1.0) - this.mesh.position.y;
        return dx * dx + dz * dz < 1.6 && Math.abs(dy) < 1.6;
    }

    collect(scene) {
        this.collected = true;
        scene.remove(this.mesh);
    }
}
