// The player character: a rigged 3D human loaded from models/hero.glb — a CC0
// stylised character by Quaternius, recoloured to the palette of the author's
// cartoon avatar (img/profile_picture_cartoon.jpg): warm brown swept hair,
// peach skin, dark top.
//
// The model ships with a skeleton and eleven animation clips (Idle, Walk, Run,
// Jump, SwordSlash, …), which drive locomotion. Costume pieces — cap, chains,
// sword, cape, extra arms, the team — are still built from primitives here and
// parented to the model's bones, so they follow the animation.
//
// Walking the island chain walks the career, and the character changes with it:
// a graduation cap at university, plain clothes at the first job, chains at
// European Dynamics, a sword at Upstream, a cape and extra height at Cortical.io,
// four arms at Camunda, and finally a team to shield at the return to Upstream.
// See `setCostume`.

import * as THREE from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';

const GRAVITY = -34;
const JUMP_VELOCITY = 12.5;
const MOVE_SPEED = 9;
const ACCEL = 60;
const FRICTION = 12;
const SPIN_DURATION = 0.55;

const MODEL_URL = new URL('../../models/hero.glb', import.meta.url);

// Target height in world units. The model is normalised to this from its
// skeleton, so the character matches the scale the world was built around.
const TARGET_HEIGHT = 2.0;

// Height of the Hips bone above the feet, as a fraction of TARGET_HEIGHT.
// Costume pieces are authored in feet-origin coordinates and mounted on the
// hips, so this is what converts between the two.
const HIP_HEIGHT = TARGET_HEIGHT * 0.52;

// Palette lifted from the cartoon avatar. The shipped model is very dark and
// slightly metallic, which reads as muddy under this game's lighting; these
// values replace the material colours by name at load time.
const SKIN = 0xf5c9a4;
const SKIN_SHADOW = 0xdfa87e;
const HAIR = 0x8d6031;      // warm mid-brown, matching the avatar's sweep
const STUBBLE = 0x3a2b21;

// Maps the model's material names to the avatar's colours.
const RECOLOUR = {
    Skin: SKIN,
    Hair: HAIR,
    Hair2: 0xa9793f,     // lighter strands, so the hair has depth
    Shirt: 0x4a3526,     // the avatar's dark brown top
    Shirt2: 0x3b2a1e,
    Pants: 0x2f3a4a,
    Shoes: 0x241a13,
    Socks: 0xb8a48a,
    Eyes: 0x140a04
};

// Animation clip names, matched loosely because the model prefixes them with
// its armature name ("HumanArmature|Man_Run").
const CLIP = {
    idle: /Idle/i,
    walk: /Walk(?!ing)/i,
    run: /Run(?!ningJump)/i,
    jump: /Jump/i,
    spin: /SwordSlash/i
};

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

        // Costume state. `scaleTarget` is eased in _animate so growing at
        // Cortical.io reads as a transformation rather than a pop.
        this.costume = null;
        this.scaleTarget = 1;
        this.scaleCurrent = 1;

        // Animation state, populated once the glTF resolves.
        this.mixer = null;
        this.actions = {};
        this.currentAction = null;
        this.modelReady = false;

        this._build();
        this.setCostume('toga');
    }

    _build() {
        // `body` is the group everything rotates with. The loaded model and all
        // costume pieces are parented to it, so turning the character turns the
        // whole ensemble.
        const body = new THREE.Group();
        this.body = body;
        this.group.add(body);

        const skin = new THREE.MeshLambertMaterial({ color: SKIN });
        const skinDark = new THREE.MeshLambertMaterial({ color: SKIN_SHADOW });
        const hairMat = new THREE.MeshLambertMaterial({ color: HAIR });
        const dark = new THREE.MeshLambertMaterial({ color: 0x1c1410 });
        const white = new THREE.MeshLambertMaterial({ color: 0xffffff });
        const denim = new THREE.MeshLambertMaterial({ color: 0x2f4a7a });
        const tee = new THREE.MeshLambertMaterial({ color: 0x4a3526 });

        this.materials = { skin, skinDark, hairMat, dark, white, denim, tee };

        // Placeholder torso so the character is never an invisible nothing
        // while the model streams in. Removed on load.
        const placeholder = new THREE.Mesh(
            new THREE.CapsuleGeometry(0.4, 1.0, 4, 12), tee
        );
        placeholder.position.y = 1.0;
        body.add(placeholder);
        this.placeholder = placeholder;

        // Attachment points. Costume pieces hang off these rather than off the
        // bones directly, so a costume never has to know the rig's bone names.
        // They are re-parented to real bones once the skeleton exists.
        this.mounts = {
            root: new THREE.Group(),      // hips — cape, chains, toga
            head: new THREE.Group(),      // head  — laurel wreath
            handR: new THREE.Group()      // right hand — sword
        };
        this.mounts.root.position.y = 1.0;
        this.mounts.head.position.y = 1.8;
        this.mounts.handR.position.set(0.45, 1.1, 0);
        body.add(this.mounts.root, this.mounts.head, this.mounts.handR);

        // The costume pieces were authored against a body whose origin was at
        // the feet, so their coordinates are absolute heights (a cape collar at
        // y = 1.46, and so on). Once mounted on the Hips bone the local origin
        // is the hip instead, so everything hangs about a metre too high and
        // reads far too large. `costumeRoot` re-bases that whole coordinate
        // space in one place, rather than rewriting every piece's numbers.
        this.costumeRoot = new THREE.Group();
        this.costumeRoot.position.y = -HIP_HEIGHT;
        this.mounts.root.add(this.costumeRoot);

        // Extra arms for the Camunda costume: the *additional* pair, since the
        // model brings its own two. Mounted a little under the rig's shoulder
        // sockets (y ≈ 1.91 in costume-root space) so the second pair hangs
        // below the first, and swung by hand in _animate. The earlier value of
        // 0.95 came from the primitive body this costume was first authored
        // against, which left them dangling at the legs.
        this.extraArms = [-1, 1].map((side) => {
            const arm = this._makeArm(side, 1.74, this.costumeRoot);
            arm.visible = false;
            return arm;
        });

        // Costume attachments, built once and toggled by setCostume.
        this.costumes = {
            cap: this._buildCap(this.mounts.head),
            chains: this._buildChains(this.costumeRoot),
            sword: this._buildSword(),
            cape: this._buildCape(this.costumeRoot),
            team: this._buildTeam()
        };
        this.mounts.handR.add(this.costumes.sword);
        this.group.add(this.costumes.team);

        this._loadModel();
    }

    // Loads the rigged character, normalises its scale, recolours it, and wires
    // up the animation mixer. Everything is asynchronous, so the rest of the
    // class must tolerate `modelReady === false`.
    _loadModel() {
        new GLTFLoader().load(MODEL_URL.href, (gltf) => {
            const model = gltf.scene;

            // Skinned meshes report bind-pose bounding boxes, which are useless
            // for sizing. The skeleton's own extent is reliable.
            model.updateMatrixWorld(true);
            let minY = Infinity;
            let maxY = -Infinity;
            model.traverse((o) => {
                if (!o.isBone) return;
                const p = new THREE.Vector3();
                o.getWorldPosition(p);
                minY = Math.min(minY, p.y);
                maxY = Math.max(maxY, p.y);
            });
            const span = (maxY - minY) || 1;
            model.scale.setScalar(TARGET_HEIGHT / span);

            // The model faces +z; so does the rest of this class's maths.
            model.traverse((o) => {
                if (!o.isMesh) return;
                o.castShadow = true;
                o.receiveShadow = true;
                o.frustumCulled = false;   // skinned bounds are unreliable

                // Recolour by material name, and drop the metallic sheen that
                // makes the shipped model look muddy under this game's lights.
                const mats = Array.isArray(o.material) ? o.material : [o.material];
                for (const mat of mats) {
                    const target = RECOLOUR[mat.name];
                    if (target !== undefined) mat.color.setHex(target);
                    if (mat.metalness !== undefined) mat.metalness = 0.0;
                    if (mat.roughness !== undefined) mat.roughness = 0.85;
                }
            });

            this.body.remove(this.placeholder);
            this.body.add(model);
            this.model = model;

            // Re-parent the mounts onto real bones so costumes follow the
            // animation instead of floating at fixed offsets.
            const bones = {};
            model.traverse((o) => { if (o.isBone) bones[o.name] = o; });
            this.bones = bones;

            // This rig names its bones Hips / Head / PalmR; the aliases cover
            // the Mixamo naming other models use, so a swapped-in model with a
            // different skeleton still finds its mounts.
            const pick = (...names) => names.map((n) => bones[n]).find(Boolean);
            const hips = pick('Hips', 'mixamorigHips', 'Root', 'Bone');
            const head = pick('Head', 'mixamorigHead');
            const handR = pick('PalmR', 'MiddleHandR', 'HandRight', 'RightHand',
                'mixamorigRightHand', 'Hand_R', 'hand_r');

            if (hips) this._remount(this.mounts.root, hips);
            if (head) this._remount(this.mounts.head, head);
            if (handR) this._remount(this.mounts.handR, handR);

            // Animation. Every clip is prepared up front so switching is free.
            this.mixer = new THREE.AnimationMixer(model);
            for (const [key, re] of Object.entries(CLIP)) {
                const clip = gltf.animations.find((a) => re.test(a.name));
                if (clip) this.actions[key] = this.mixer.clipAction(clip);
            }
            // The spin attack is a one-shot; everything else loops.
            if (this.actions.spin) {
                this.actions.spin.setLoop(THREE.LoopOnce, 1);
                this.actions.spin.clampWhenFinished = true;
            }
            if (this.actions.jump) {
                this.actions.jump.setLoop(THREE.LoopOnce, 1);
                this.actions.jump.clampWhenFinished = true;
            }

            this.modelReady = true;
            this._playAction('idle');

            // The costume set before the model arrived has to be re-applied,
            // since mounts have moved onto bones since then.
            const stage = this.costume;
            this.costume = null;
            this.setCostume(stage);
        });
    }

    // Moves a mount group under a bone, compensating for the bone's world
    // scale so costume pieces keep the size they were authored at.
    _remount(mount, bone) {
        mount.parent.remove(mount);
        bone.add(mount);
        mount.position.set(0, 0, 0);
        mount.rotation.set(0, 0, 0);

        // Undo only the scale the bone picks up *within the body* — the model's
        // normalising factor and the rig's own bone scales. Using world scale
        // here would also cancel the costume growth multiplier on this.group,
        // which is deliberate and must survive.
        const boneWorld = new THREE.Vector3();
        const bodyWorld = new THREE.Vector3();
        bone.getWorldScale(boneWorld);
        this.body.getWorldScale(bodyWorld);
        const relative = bodyWorld.x !== 0 ? boneWorld.x / bodyWorld.x : 1;
        mount.scale.setScalar(relative !== 0 ? 1 / relative : 1);
    }

    // Cross-fades to a named action. No-op when that action is already running.
    _playAction(name, fade = 0.18) {
        const next = this.actions[name];
        if (!next || this.currentAction === next) return;
        next.reset();
        next.setEffectiveWeight(1);
        next.play();
        if (this.currentAction) this.currentAction.crossFadeTo(next, fade, false);
        this.currentAction = next;
    }

    // One arm of the Camunda second pair, pivoting at its shoulder.
    //
    // Dimensions are taken from the loaded rig's own arm, measured in
    // costume-root space: shoulder socket at (±0.23, 1.91), elbow at 0.35 below
    // it, palm a further 0.39 — a total reach of 0.74. Matching those makes the
    // extra pair read as the same character's arms rather than as spare parts.
    _makeArm(side, shoulderY, parent) {
        const { skin, tee } = this.materials;
        const arm = new THREE.Group();

        const UPPER_LEN = 0.35;
        const FOREARM_LEN = 0.39;

        // Short sleeve, matching the model's own T-shirt.
        const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.14, 6, 12), tee);
        sleeve.position.y = -0.09;
        sleeve.castShadow = true;
        arm.add(sleeve);

        // Upper arm, from the shoulder down to the elbow.
        const upper = new THREE.Mesh(
            new THREE.CapsuleGeometry(0.045, UPPER_LEN - 0.09, 6, 12), skin
        );
        upper.position.y = -UPPER_LEN / 2;
        upper.castShadow = true;
        arm.add(upper);

        // Forearm, tapering slightly toward the wrist.
        const fore = new THREE.Mesh(
            new THREE.CapsuleGeometry(0.038, FOREARM_LEN - 0.1, 6, 12), skin
        );
        fore.position.y = -UPPER_LEN - FOREARM_LEN / 2 + 0.03;
        fore.castShadow = true;
        arm.add(fore);

        // Hand, sized to the rig's own rather than a cartoon glove.
        const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 14, 12), skin);
        hand.position.y = -(UPPER_LEN + FOREARM_LEN) + 0.02;
        hand.scale.set(0.9, 1.15, 0.7);
        hand.castShadow = true;
        arm.add(hand);

        // A rounded deltoid closing the gap at the socket, so the limb reads as
        // attached rather than as a floating stick.
        const deltoid = new THREE.Mesh(new THREE.SphereGeometry(0.068, 14, 12), tee);
        deltoid.position.y = 0.005;
        deltoid.scale.set(1, 0.9, 1);
        deltoid.castShadow = true;
        arm.add(deltoid);

        // Set behind the model's own arms and tucked slightly inboard, so the
        // two pairs read as stacked rather than fighting for the same space.
        arm.position.set(side * 0.185, shoulderY, -0.16);
        parent.add(arm);
        return arm;
    }

    // University: a graduation cap. A full toga was tried first and read as a
    // barrel around the rig's slim frame — the mortarboard says "student" just
    // as clearly and leaves the character's silhouette intact.
    //
    // Mounted on the head bone, so its coordinates are head-local and it
    // follows every nod and turn of the animation.
    _buildCap(parent) {
        const cap = new THREE.Group();
        const felt = new THREE.MeshLambertMaterial({ color: 0x1d2233 });
        const trim = new THREE.MeshLambertMaterial({ color: 0xd4af37 });

        // Head-bone local. The skinned mesh's bounding box includes the arms,
        // so it overstates the crown; this value is set from what actually
        // sits on the hair. At 0 the board covered the eyes like a visor.
        const HEAD_Y = 0.16;

        // Skullcap hugging the crown.
        const crown = new THREE.Mesh(
            new THREE.SphereGeometry(0.148, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.5),
            felt
        );
        crown.position.set(0, HEAD_Y + 0.04, 0.02);
        crown.scale.set(1, 0.62, 1);
        crown.castShadow = true;
        cap.add(crown);

        // The mortarboard itself: a thin square plate, turned 45° so a corner
        // points forward, which is how it actually sits.
        const board = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.022, 0.42), felt);
        board.position.set(0, HEAD_Y + 0.135, 0.02);
        board.rotation.y = Math.PI / 4;
        board.castShadow = true;
        cap.add(board);

        // Button at the centre, and the tassel hanging from it.
        const button = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 10), trim);
        button.position.set(0, HEAD_Y + 0.152, 0.02);
        cap.add(button);

        const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.2, 6), trim);
        cord.position.set(0.1, HEAD_Y + 0.15, 0.02);
        cord.rotation.z = -0.42;
        cap.add(cord);

        // Tassel bundle at the end of the cord, off the right edge.
        const tassel = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.02, 0.1, 10), trim);
        tassel.position.set(0.19, HEAD_Y + 0.075, 0.02);
        cap.add(tassel);
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            const strand = new THREE.Mesh(
                new THREE.CylinderGeometry(0.005, 0.004, 0.09, 5), trim
            );
            strand.position.set(
                0.19 + Math.cos(a) * 0.016, HEAD_Y + 0.02, 0.02 + Math.sin(a) * 0.016
            );
            cap.add(strand);
        }

        cap.visible = false;
        parent.add(cap);
        return cap;
    }

    // European Dynamics: chains — shackled wrists, a waist chain and a heavy
    // trailing length. The bureaucratic years, worn literally.
    _buildChains(body) {
        const chains = new THREE.Group();
        const iron = new THREE.MeshLambertMaterial({ color: 0x6e747c });
        const ironDark = new THREE.MeshLambertMaterial({ color: 0x4a4f56 });

        // A run of interlocking links between two points, alternating the ring
        // planes the way real chain does.
        const linkRun = (from, to, count, radius = 0.075) => {
            const run = new THREE.Group();
            for (let i = 0; i < count; i++) {
                const t = i / (count - 1);
                const link = new THREE.Mesh(
                    new THREE.TorusGeometry(radius, radius * 0.32, 5, 10),
                    i % 2 ? iron : ironDark
                );
                link.position.set(
                    from[0] + (to[0] - from[0]) * t,
                    from[1] + (to[1] - from[1]) * t - Math.sin(t * Math.PI) * 0.12,
                    from[2] + (to[2] - from[2]) * t
                );
                link.rotation.y = i % 2 ? Math.PI / 2 : 0;
                link.rotation.x = Math.PI / 2;
                run.add(link);
            }
            return run;
        };

        // Manacles at both wrists, joined by a slack chain across the front.
        [-1, 1].forEach((side) => {
            const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.055, 6, 14), iron);
            cuff.position.set(side * 0.52, 0.72, 0);
            cuff.rotation.x = Math.PI / 2;
            chains.add(cuff);
        });
        chains.add(linkRun([-0.5, 0.7, 0.06], [0.5, 0.7, 0.06], 9));

        // Waist chain, wrapped twice.
        [1.0, 0.88].forEach((y, i) => {
            const belt = new THREE.Mesh(new THREE.TorusGeometry(0.52 + i * 0.02, 0.05, 6, 20), iron);
            belt.position.y = y;
            belt.rotation.x = Math.PI / 2 + i * 0.12;
            chains.add(belt);
        });

        // A heavy length trailing behind, ending in a ball — the drag of it.
        const trail = linkRun([0, 0.85, -0.5], [0, 0.22, -1.9], 11, 0.1);
        chains.add(trail);
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 12), ironDark);
        ball.position.set(0, 0.3, -2.05);
        ball.castShadow = true;
        chains.add(ball);
        this.chainBall = ball;

        // Shoulder yoke, so the chains look worn rather than draped.
        const yoke = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.05, 6, 16), ironDark);
        yoke.position.set(0, 1.45, 0);
        yoke.rotation.x = Math.PI / 2 - 0.2;
        chains.add(yoke);

        chains.visible = false;
        body.add(chains);
        return chains;
    }

    // Upstream: the hero's sword — a bronze-hilted blade held in the right hand.
    // Built pointing "down" the arm's local axis so it sits in the fist.
    _buildSword() {
        const sword = new THREE.Group();
        const steel = new THREE.MeshLambertMaterial({ color: 0xdfe4ea });
        const bronze = new THREE.MeshLambertMaterial({ color: 0xb8863b });
        const grip = new THREE.MeshLambertMaterial({ color: 0x5c3a1e });

        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.2, 0.045), steel);
        blade.position.y = 1.35;
        blade.castShadow = true;
        sword.add(blade);

        // Fuller down the centre of the blade.
        const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.9, 0.06), bronze);
        fuller.position.y = 1.3;
        sword.add(fuller);

        const point = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.34, 4), steel);
        point.position.y = 2.6;
        sword.add(point);

        const crossguard = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.11, 0.12), bronze);
        crossguard.position.y = 0.24;
        sword.add(crossguard);

        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.36, 8), grip);
        handle.position.y = 0.02;
        sword.add(handle);

        const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), bronze);
        pommel.position.y = -0.19;
        sword.add(pommel);

        // Gripped in the fist and held out to the side, blade up. The arm hangs
        // down from the shoulder, so tilting mostly about z swings the blade
        // outward and vertical — clear of the body, and clear of the camera's
        // line to the head. Rolling it slightly about x keeps the flat of the
        // blade toward the viewer rather than edge-on.
        sword.position.set(0.12, -0.62, 0.02);
        sword.rotation.z = -1.05;
        sword.rotation.x = -0.35;
        sword.visible = false;
        return sword;
    }

    // Cortical.io onward: a cape. Built as a fan of tapering panels hung from
    // the shoulders so it can be made to billow in _animate.
    _buildCape(body) {
        const cape = new THREE.Group();
        const outer = new THREE.MeshLambertMaterial({
            color: 0xb01f2b, side: THREE.DoubleSide
        });
        const lining = new THREE.MeshLambertMaterial({
            color: 0x2a1418, side: THREE.DoubleSide
        });

        // Collar/clasp across the shoulders.
        const collar = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.05, 8, 20), outer);
        collar.position.set(0, 1.80, 0.06);
        collar.rotation.x = Math.PI / 2 - 0.25;
        cape.add(collar);

        const clasp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8),
            new THREE.MeshLambertMaterial({ color: 0xe0c05a }));
        clasp.position.set(0, 1.83, 0.2);
        cape.add(clasp);

        // The cloth: panels fanned across the back, each a little longer at the
        // centre so the hem hangs in a curve.
        this.capePanels = [];
        const PANELS = 7;
        for (let i = 0; i < PANELS; i++) {
            const t = i / (PANELS - 1);
            const spread = (t - 0.5) * 2;               // -1 .. 1 across the back
            const length = 1.25 - Math.abs(spread) * 0.25;

            const panel = new THREE.Group();
            const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.22, length), outer);
            cloth.position.y = -length / 2;
            cloth.castShadow = true;
            panel.add(cloth);

            // Dark lining just behind, so the inside of the cape reads dark.
            const back = new THREE.Mesh(new THREE.PlaneGeometry(0.22, length), lining);
            back.position.set(0, -length / 2, -0.03);
            panel.add(back);

            panel.position.set(spread * 0.22, 1.78, -0.08 - Math.abs(spread) * 0.04);
            panel.rotation.y = spread * 0.35;
            panel.userData.spread = spread;
            cape.add(panel);
            this.capePanels.push(panel);
        }

        cape.visible = false;
        body.add(cape);
        return cape;
    }

    // The final Upstream stint: four teammates the player shields. They are
    // parked in a loose wedge behind the player and follow with a lag, so the
    // group reads as "led" rather than "carried".
    _buildTeam() {
        const team = new THREE.Group();
        this.teamMembers = [];

        // Four distinct silhouettes, so it looks like people rather than clones.
        const kits = [
            { shirt: 0x3f7f6f, hair: 0x2b1d14, height: 0.92 },
            { shirt: 0xa8523f, hair: 0x6b4a2a, height: 1.0 },
            { shirt: 0x4a5c9c, hair: 0x1c1410, height: 0.88 },
            { shirt: 0x7a6ba8, hair: 0x8a6a3a, height: 0.96 }
        ];

        // Behind and to the sides: the player stands between them and whatever
        // is ahead, which is the whole point of the pose. The team group is a
        // child of the player's root, so these offsets are multiplied by the
        // leader's 1.35 costume scale — kept wide enough that the formation
        // still reads as four people flanking a leader rather than a huddle.
        const spots = [[-1.9, -1.7], [1.9, -1.7], [-1.0, -3.1], [1.0, -3.1]];

        kits.forEach((kit, i) => {
            const mate = new THREE.Group();
            const shirt = new THREE.MeshLambertMaterial({ color: kit.shirt });
            const skinM = new THREE.MeshLambertMaterial({ color: SKIN });
            const hairM = new THREE.MeshLambertMaterial({ color: kit.hair });

            const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.4, 4, 10), shirt);
            torso.position.y = 0.85;
            torso.castShadow = true;
            mate.add(torso);

            const headM = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 12), skinM);
            headM.position.y = 1.44;
            headM.castShadow = true;
            mate.add(headM);

            const hairCap = new THREE.Mesh(
                new THREE.SphereGeometry(0.355, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), hairM
            );
            hairCap.position.y = 1.46;
            mate.add(hairCap);

            [-1, 1].forEach((side) => {
                const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6),
                    new THREE.MeshLambertMaterial({ color: 0xffffff }));
                eye.position.set(side * 0.12, 1.46, 0.3);
                mate.add(eye);
                const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6),
                    new THREE.MeshLambertMaterial({ color: 0x1c1410 }));
                pupil.position.set(side * 0.13, 1.46, 0.34);
                mate.add(pupil);

                const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.32, 4, 8), shirt);
                arm.position.set(side * 0.34, 0.86, 0);
                arm.rotation.z = side * 0.22;
                mate.add(arm);

                const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.36, 4, 8),
                    new THREE.MeshLambertMaterial({ color: 0x3a4152 }));
                leg.position.set(side * 0.14, 0.32, 0);
                mate.add(leg);
            });

            // A small smile, so they read as glad to be there.
            const smile = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.022, 5, 10, Math.PI),
                new THREE.MeshLambertMaterial({ color: 0x8a3a3a }));
            smile.position.set(0, 1.34, 0.31);
            smile.rotation.x = Math.PI;
            mate.add(smile);

            mate.scale.setScalar(kit.height);
            mate.userData.spot = spots[i];
            mate.userData.phase = i * 1.4;
            team.add(mate);
            this.teamMembers.push(mate);
        });

        team.visible = false;
        return team;
    }

    // ---- costume switching -------------------------------------------------

    // `stage` is one of the keys below. Called by the game loop whenever the
    // player crosses into a new island, and safe to call every frame: it
    // returns immediately when the stage has not actually changed.
    setCostume(stage) {
        if (this.costume === stage) return;
        this.costume = stage;

        const c = this.costumes;
        // Default: street clothes, nothing equipped, normal size.
        const on = {
            cap: false, chains: false, sword: false, cape: false, team: false,
            extraArms: false, scale: 1
        };

        switch (stage) {
            case 'toga':                       // university
                on.cap = true;
                break;
            case 'plain':                      // Intracom — the cap comes off
                break;
            case 'chains':                     // European Dynamics
                on.chains = true;
                break;
            case 'hero':                       // Upstream, first stint
                on.sword = true;
                on.scale = 1.12;               // a little larger; a hero's build
                break;
            case 'caped':                      // Cortical.io — bigger, cloaked
                on.cape = true;
                on.scale = 1.35;
                break;
            case 'fourArms':                   // Camunda — same size, four arms
                on.cape = true;
                on.extraArms = true;
                on.scale = 1.35;
                break;
            case 'leader':                     // Upstream, second stint
                on.cape = true;
                on.extraArms = true;
                on.sword = true;
                on.team = true;
                on.scale = 1.35;
                break;
            default:
                break;
        }

        c.cap.visible = on.cap;
        c.chains.visible = on.chains;
        c.sword.visible = on.sword;
        c.cape.visible = on.cape;
        c.team.visible = on.team;
        this.extraArms.forEach((arm) => { arm.visible = on.extraArms; });

        this.scaleTarget = on.scale;
    }

    get position() {
        return this.group.position;
    }

    startSpin(audio) {
        if (this.spinTimer > 0) return false;
        this.spinTimer = SPIN_DURATION;
        // Retrigger the one-shot slash clip from the top.
        if (this.actions.spin) {
            this.currentAction = null;   // force _playAction to re-fade in
            this._playAction('spin', 0.05);
        }
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

        // Growing into the later costumes is eased, so the change reads as a
        // transformation rather than a pop between frames.
        this.scaleCurrent = THREE.MathUtils.damp(this.scaleCurrent, this.scaleTarget, 4, dt);
        this.group.scale.setScalar(this.scaleCurrent);

        // Face the direction of travel, easing so turns arc rather than snap.
        if (speed > 0.5) {
            const desired = Math.atan2(this.velocity.x, this.velocity.z);
            let diff = desired - this.facing;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            this.facing += diff * Math.min(1, dt * 12);
        }

        // Limb motion comes from the model's own animation clips now, so this
        // only has to choose which clip should be running and spin the body.
        this.runCycle += dt * speed * 1.7;

        if (this.spinTimer > 0) {
            // Spin attack: the sword-slash clip plays while the whole body
            // whips around, which reads far better than the clip alone.
            const t = 1 - this.spinTimer / SPIN_DURATION;
            this.body.rotation.y = this.facing + t * Math.PI * 6;
        } else {
            this.body.rotation.y = this.facing;

            if (!this.onGround) this._playAction('jump');
            else if (speed > MOVE_SPEED * 0.55) this._playAction('run');
            else if (speed > 0.6) this._playAction('walk');
            else this._playAction('idle');
        }

        // The extra Camunda arms are not part of the rig, so they are still
        // swung by hand, on the opposite beat to the model's own arms. The rest
        // pose is kept close to vertical (a slight outward splay only) to match
        // how the model's own arms hang — a wider splay reads as a scarecrow
        // next to them.
        if (this.extraArms[0].visible) {
            const swing = Math.sin(this.runCycle) * Math.min(1, speed / MOVE_SPEED);
            this.extraArms.forEach((arm, i) => {
                const dir = i === 0 ? 1 : -1;
                if (this.spinTimer > 0) {
                    // Flung out wide during the spin attack.
                    arm.rotation.z = dir * 1.35;
                    arm.rotation.x = 0;
                } else if (this.onGround) {
                    arm.rotation.x = swing * dir * 0.55;
                    arm.rotation.z = dir * 0.18;
                } else {
                    arm.rotation.x = THREE.MathUtils.damp(arm.rotation.x, -0.75, 8, dt);
                    arm.rotation.z = dir * 0.3;
                }
            });
        }

        // Squash and stretch on jumps and landings, applied to the whole body.
        this.squash = THREE.MathUtils.damp(this.squash, 1, 9, dt);
        this.body.scale.set(
            1 / Math.sqrt(this.squash), this.squash, 1 / Math.sqrt(this.squash)
        );

        // Advance the skeletal animation.
        if (this.mixer) this.mixer.update(dt);

        this._animateCostume(dt, speed);
    }

    // Costume pieces that move: the cape billows, the chain ball drags, and the
    // team keeps station behind the player.
    _animateCostume(dt, speed) {
        this._capeTime = (this._capeTime || 0) + dt;

        if (this.costumes.cape.visible && this.capePanels) {
            // Each panel lags a little further out from the centre, so the cloth
            // ripples across the back instead of swinging as one board.
            for (const panel of this.capePanels) {
                const spread = panel.userData.spread;
                const wave = Math.sin(this._capeTime * 5 + spread * 2.2);
                // Faster running blows the cape further back and up.
                const lift = 0.25 + (speed / MOVE_SPEED) * 0.85;
                panel.rotation.x = lift + wave * 0.12 * (0.4 + speed / MOVE_SPEED);
                panel.rotation.z = spread * 0.18 + wave * 0.08;
            }
        }

        if (this.costumes.chains.visible && this.chainBall) {
            // The ball swings behind and bounces, as a dead weight would.
            const swing = Math.sin(this._capeTime * 3.2) * 0.25 * (0.3 + speed / MOVE_SPEED);
            this.chainBall.position.x = swing;
            this.chainBall.position.y = 0.3 + Math.abs(Math.sin(this._capeTime * 6)) * 0.12 *
                (speed / MOVE_SPEED);
        }

        if (this.costumes.team.visible && this.teamMembers) {
            // The team group is parented to the player's root, which does not
            // rotate, so each member is placed in world-space terms around the
            // player's facing: they stay behind whichever way the player turns.
            const cos = Math.cos(this.facing);
            const sin = Math.sin(this.facing);
            for (const mate of this.teamMembers) {
                const [ox, oz] = mate.userData.spot;
                // Rotate the formation offset into the player's facing.
                const tx = ox * cos + oz * sin;
                const tz = -ox * sin + oz * cos;

                // Ease toward the station so they trail rather than teleport.
                mate.position.x = THREE.MathUtils.damp(mate.position.x, tx, 3.5, dt);
                mate.position.z = THREE.MathUtils.damp(mate.position.z, tz, 3.5, dt);

                // Bob while the player runs, as though jogging to keep up.
                const jog = Math.min(1, speed / MOVE_SPEED);
                mate.position.y = Math.abs(
                    Math.sin(this._capeTime * 7 + mate.userData.phase)
                ) * 0.16 * jog;

                // Face the same way the player does.
                mate.rotation.y = this.facing;
            }
        }
    }
}
