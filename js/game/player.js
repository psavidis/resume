// The player character: an original cartoon marsupial assembled from three.js
// primitives (no external model files, nothing borrowed from any game).
// Handles movement, jumping, the spin attack and all the squash-and-stretch.

import * as THREE from '../vendor/three.module.js';

const GRAVITY = -34;
const JUMP_VELOCITY = 12.5;
const MOVE_SPEED = 9;
const ACCEL = 60;
const FRICTION = 12;
const SPIN_DURATION = 0.55;

export class Player {
    constructor() {
        this.group = new THREE.Group();
        this.velocity = new THREE.Vector3();
        this.onGround = true;
        this.spinTimer = 0;
        this.facing = 0;          // yaw the body is rendered at
        this.runCycle = 0;
        this.squash = 1;          // 1 = neutral; <1 squashed, >1 stretched
        this.radius = 0.75;       // collision radius, used by the world
        this.height = 2.0;

        this._build();
    }

    _build() {
        const body = new THREE.Group();
        this.body = body;
        this.group.add(body);

        const fur = new THREE.MeshLambertMaterial({ color: 0xd9622b });
        const belly = new THREE.MeshLambertMaterial({ color: 0xf2d9b0 });
        const dark = new THREE.MeshLambertMaterial({ color: 0x2e2119 });
        const white = new THREE.MeshLambertMaterial({ color: 0xffffff });
        const denim = new THREE.MeshLambertMaterial({ color: 0x2f4a7a });

        // Torso: a slightly tapered box reads more "cartoon" than a sphere.
        const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.52, 0.5, 4, 12), fur);
        torso.position.y = 1.05;
        torso.castShadow = true;
        body.add(torso);

        const bellyPatch = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.34, 4, 12), belly);
        bellyPatch.position.set(0, 1.0, 0.2);
        bellyPatch.scale.set(1, 1, 0.55);
        body.add(bellyPatch);

        // Head
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 14), fur);
        head.position.y = 1.95;
        head.scale.set(1, 0.92, 1.05);
        head.castShadow = true;
        body.add(head);
        this.head = head;

        // Snout
        const snout = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.24, 4, 10), fur);
        snout.rotation.x = Math.PI / 2;
        snout.position.set(0, 1.84, 0.44);
        body.add(snout);

        const nose = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), dark);
        nose.position.set(0, 1.9, 0.66);
        body.add(nose);

        // Eyes: white sclera with a dark pupil, set wide and forward.
        [-1, 1].forEach((side) => {
            const eye = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), white);
            eye.position.set(side * 0.19, 2.12, 0.36);
            body.add(eye);

            const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), dark);
            pupil.position.set(side * 0.2, 2.12, 0.49);
            body.add(pupil);

            // Brow gives the face an expression instead of a blank stare.
            const brow = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.08), dark);
            brow.position.set(side * 0.2, 2.3, 0.42);
            brow.rotation.z = side * 0.25;
            body.add(brow);

            // Ears
            const ear = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 8), fur);
            ear.position.set(side * 0.36, 2.3, -0.05);
            ear.rotation.z = side * 0.35;
            body.add(ear);
        });

        // Spiky tuft of hair, three cones fanned back.
        [-0.16, 0, 0.16].forEach((x, i) => {
            const spike = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.34, 6), fur);
            spike.position.set(x, 2.4, -0.02 - Math.abs(x) * 0.3);
            spike.rotation.x = -0.4;
            spike.rotation.z = -x * 2;
            body.add(spike);
        });

        // Arms — kept as references so the run/spin cycle can swing them.
        this.arms = [-1, 1].map((side) => {
            const arm = new THREE.Group();
            const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.42, 4, 8), fur);
            upper.position.y = -0.26;
            arm.add(upper);

            const hand = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), white);
            hand.position.y = -0.56;
            arm.add(hand);

            arm.position.set(side * 0.6, 1.35, 0);
            body.add(arm);
            return arm;
        });

        // Legs
        this.legs = [-1, 1].map((side) => {
            const leg = new THREE.Group();
            const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.34, 4, 8), denim);
            thigh.position.y = -0.22;
            leg.add(thigh);

            const foot = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.46), dark);
            foot.position.set(0, -0.48, 0.1);
            leg.add(foot);

            leg.position.set(side * 0.25, 0.62, 0);
            body.add(leg);
            return leg;
        });

        // Tail
        const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.4, 4, 8), fur);
        tail.position.set(0, 0.95, -0.5);
        tail.rotation.x = 0.9;
        body.add(tail);
        this.tail = tail;
    }

    get position() {
        return this.group.position;
    }

    startSpin(audio) {
        if (this.spinTimer > 0) return false;
        this.spinTimer = SPIN_DURATION;
        if (audio) audio.spin();
        return true;
    }

    get isSpinning() {
        return this.spinTimer > 0;
    }

    jump(audio) {
        if (!this.onGround) return false;
        this.velocity.y = JUMP_VELOCITY;
        this.onGround = false;
        this.squash = 1.3; // stretch on take-off
        if (audio) audio.jump();
        return true;
    }

    // `input` is a normalised {x, z} direction already rotated into world space.
    update(dt, input) {
        // Horizontal movement with acceleration and friction, so the character
        // has a little weight instead of snapping to full speed.
        const target = new THREE.Vector3(input.x, 0, input.z).multiplyScalar(MOVE_SPEED);
        const accel = (input.x !== 0 || input.z !== 0) ? ACCEL : FRICTION;

        this.velocity.x = THREE.MathUtils.damp(this.velocity.x, target.x, accel * 0.35, dt);
        this.velocity.z = THREE.MathUtils.damp(this.velocity.z, target.z, accel * 0.35, dt);

        this.velocity.y += GRAVITY * dt;

        this.group.position.x += this.velocity.x * dt;
        this.group.position.y += this.velocity.y * dt;
        this.group.position.z += this.velocity.z * dt;

        if (this.spinTimer > 0) this.spinTimer -= dt;

        this._animate(dt);
    }

    // Called by the world after it resolves the ground height under the player.
    land(groundY) {
        if (this.group.position.y <= groundY) {
            if (this.velocity.y < -12) this.squash = 0.72; // impact squash
            this.group.position.y = groundY;
            this.velocity.y = 0;
            this.onGround = true;
        } else {
            this.onGround = false;
        }
    }

    _animate(dt) {
        const speed = Math.hypot(this.velocity.x, this.velocity.z);

        // Face the direction of travel, easing so turns arc rather than snap.
        if (speed > 0.5) {
            const desired = Math.atan2(this.velocity.x, this.velocity.z);
            let diff = desired - this.facing;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            this.facing += diff * Math.min(1, dt * 12);
        }

        if (this.spinTimer > 0) {
            // Spin attack: whip the whole body around several times, arms out.
            const t = 1 - this.spinTimer / SPIN_DURATION;
            this.body.rotation.y = this.facing + t * Math.PI * 6;
            this.arms.forEach((arm, i) => {
                arm.rotation.z = (i === 0 ? 1 : -1) * 1.5;
                arm.rotation.x = 0;
            });
            this.legs.forEach((leg) => { leg.rotation.x = 0; });
        } else {
            this.body.rotation.y = this.facing;

            // Run cycle: swing limbs in opposition, scaled by ground speed.
            this.runCycle += dt * speed * 1.7;
            const swing = Math.sin(this.runCycle) * Math.min(1, speed / MOVE_SPEED);

            if (this.onGround) {
                this.legs.forEach((leg, i) => {
                    leg.rotation.x = swing * (i === 0 ? 1 : -1) * 0.9;
                });
                this.arms.forEach((arm, i) => {
                    arm.rotation.x = swing * (i === 0 ? -1 : 1) * 0.8;
                    arm.rotation.z = (i === 0 ? 1 : -1) * 0.25;
                });
            } else {
                // Airborne pose: legs tucked, arms up.
                this.legs.forEach((leg, i) => {
                    leg.rotation.x = THREE.MathUtils.damp(leg.rotation.x, i === 0 ? 0.6 : -0.3, 8, dt);
                });
                this.arms.forEach((arm, i) => {
                    arm.rotation.x = THREE.MathUtils.damp(arm.rotation.x, -1.4, 8, dt);
                    arm.rotation.z = (i === 0 ? 1 : -1) * 0.5;
                });
            }
        }

        // Squash and stretch relaxes back to neutral; head bobs while running.
        this.squash = THREE.MathUtils.damp(this.squash, 1, 9, dt);
        this.body.scale.set(1 / Math.sqrt(this.squash), this.squash, 1 / Math.sqrt(this.squash));
        this.head.position.y = 1.95 + Math.sin(this.runCycle * 2) * 0.02 * (speed / MOVE_SPEED);
        this.tail.rotation.z = Math.sin(this.runCycle) * 0.2;
    }
}
