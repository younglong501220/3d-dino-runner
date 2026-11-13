import * as THREE from 'three';

export const LANES = [-3.3, 0, 3.3] as const;
export const TRACK_WIDTH = 11.4;
export const OBSTACLE_SPAWN_Z = -135;
export const OBSTACLE_DESPAWN_Z = 14;

export interface DinoEntity {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  headGroup: THREE.Group;
  tailGroup: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  collider: THREE.Mesh;
  laneIndex: number;
  targetX: number;
  vy: number;
  isGrounded: boolean;
  duckTimer: number;
  runPhase: number;
  dispose: () => void;
}

export interface ObstacleUserData {
  type: 'cactus' | 'ptero';
  colorHex: number;
  wingL: THREE.Group | null;
  wingR: THREE.Group | null;
  baseY: number;
  flapPhase: number;
  ownedGeometries: THREE.BufferGeometry[];
}

export interface CoinUserData {
  baseY: number;
  bobPhase: number;
  collected: boolean;
  collectProgress: number;
}

export function createDino(): DinoEntity {
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const ownedGeometries: THREE.BufferGeometry[] = [];
  const greenMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.55, metalness: 0.05 });
  const bellyMat = new THREE.MeshStandardMaterial({ color: 0x86efac, roughness: 0.72, metalness: 0.02 });
  const spikeMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.42, metalness: 0.12 });
  const eyeBlackMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.18, metalness: 0.25 });
  const eyeWhiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const ownedMaterials: THREE.Material[] = [greenMat, bellyMat, spikeMat, eyeBlackMat, eyeWhiteMat];

  const addBox = (
    parent: THREE.Object3D,
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number
  ) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    ownedGeometries.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // Torso & belly
  addBox(bodyGroup, 0.96, 0.92, 1.15, greenMat, 0, 1.05, 0.05);
  addBox(bodyGroup, 0.72, 0.68, 0.2, bellyMat, 0, 0.98, -0.46);

  // Head & jaw & eyes & crest
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 1.78, -0.35);
  bodyGroup.add(headGroup);

  addBox(headGroup, 0.88, 0.72, 0.95, greenMat, 0, 0, -0.1);
  addBox(headGroup, 0.7, 0.22, 0.52, greenMat, 0, -0.26, -0.48);
  addBox(headGroup, 0.14, 0.18, 0.14, eyeBlackMat, -0.42, 0.14, -0.3);
  addBox(headGroup, 0.14, 0.18, 0.14, eyeBlackMat, 0.42, 0.14, -0.3);
  addBox(headGroup, 0.06, 0.08, 0.06, eyeWhiteMat, -0.46, 0.18, -0.34);
  addBox(headGroup, 0.06, 0.08, 0.06, eyeWhiteMat, 0.46, 0.18, -0.34);
  addBox(headGroup, 0.18, 0.18, 0.24, spikeMat, 0, 0.42, 0.12);

  // Back spikes
  addBox(bodyGroup, 0.2, 0.22, 0.22, spikeMat, 0, 1.56, 0.35);
  addBox(bodyGroup, 0.18, 0.2, 0.22, spikeMat, 0, 1.25, 0.68);

  // Tail
  const tailGroup = new THREE.Group();
  tailGroup.position.set(0, 0.95, 0.65);
  bodyGroup.add(tailGroup);
  addBox(tailGroup, 0.54, 0.46, 0.62, greenMat, 0, 0, 0.28);
  addBox(tailGroup, 0.32, 0.28, 0.45, greenMat, 0, 0.06, 0.72);

  // Tiny T-Rex arms
  addBox(bodyGroup, 0.18, 0.18, 0.42, greenMat, -0.52, 1.05, -0.45);
  addBox(bodyGroup, 0.18, 0.18, 0.42, greenMat, 0.52, 1.05, -0.45);

  // Left & Right Legs
  const leftLeg = new THREE.Group();
  leftLeg.position.set(-0.27, 0.65, 0.06);
  bodyGroup.add(leftLeg);
  addBox(leftLeg, 0.28, 0.56, 0.34, greenMat, 0, -0.28, 0);
  addBox(leftLeg, 0.3, 0.16, 0.48, spikeMat, 0, -0.56, -0.07);

  const rightLeg = new THREE.Group();
  rightLeg.position.set(0.27, 0.65, 0.06);
  bodyGroup.add(rightLeg);
  addBox(rightLeg, 0.28, 0.56, 0.34, greenMat, 0, -0.28, 0);
  addBox(rightLeg, 0.3, 0.16, 0.48, spikeMat, 0, -0.56, -0.07);

  // Invisible Box3 proxy collider
  const colliderGeo = new THREE.BoxGeometry(0.84, 1.92, 1.05);
  const colliderMat = new THREE.MeshBasicMaterial({ visible: false });
  ownedGeometries.push(colliderGeo);
  ownedMaterials.push(colliderMat);
  const collider = new THREE.Mesh(colliderGeo, colliderMat);
  collider.position.set(0, 1.02, -0.12);
  bodyGroup.add(collider);

  return {
    root,
    bodyGroup,
    headGroup,
    tailGroup,
    leftLeg,
    rightLeg,
    collider,
    laneIndex: 1,
    targetX: LANES[1],
    vy: 0,
    isGrounded: true,
    duckTimer: 0,
    runPhase: 0,
    dispose: () => {
      ownedGeometries.forEach((g) => g.dispose());
      ownedMaterials.forEach((m) => m.dispose());
    },
  };
}

export class SharedGameAssets {
  public readonly obsMaterials = {
    cactusMain: new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.65, metalness: 0.04 }),
    cactusDark: new THREE.MeshStandardMaterial({ color: 0x14532d, roughness: 0.72, metalness: 0.04 }),
    flower: new THREE.MeshStandardMaterial({ color: 0xf43f5e, roughness: 0.38, metalness: 0.08 }),
    pteroBody: new THREE.MeshStandardMaterial({ color: 0x9333ea, roughness: 0.5, metalness: 0.08 }),
    pteroWing: new THREE.MeshStandardMaterial({ color: 0xc084fc, roughness: 0.58, metalness: 0.05 }),
    pteroBeak: new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.32, metalness: 0.28 }),
  };

  public readonly coinGeos = {
    outer: new THREE.BoxGeometry(0.86, 0.86, 0.86),
    core: new THREE.BoxGeometry(0.96, 0.44, 0.44),
    emblem: new THREE.BoxGeometry(0.44, 0.96, 0.44),
  };

  public readonly coinMats = {
    gold: new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      emissive: 0xca8a04,
      emissiveIntensity: 0.32,
      roughness: 0.22,
      metalness: 0.78,
    }),
    shine: new THREE.MeshStandardMaterial({
      color: 0xfef08a,
      emissive: 0xfacc15,
      emissiveIntensity: 0.45,
      roughness: 0.16,
      metalness: 0.55,
    }),
  };

  public readonly particleGeo = new THREE.BoxGeometry(0.28, 0.28, 0.28);

  public createCoinBlock(laneIdx: number, zPos: number, elevated = false): THREE.Group {
    const group = new THREE.Group();
    const baseY = elevated ? 2.25 : 1.02;

    const outerMesh = new THREE.Mesh(this.coinGeos.outer, this.coinMats.gold);
    outerMesh.castShadow = true;
    group.add(outerMesh);

    const barH = new THREE.Mesh(this.coinGeos.core, this.coinMats.shine);
    group.add(barH);

    const barV = new THREE.Mesh(this.coinGeos.emblem, this.coinMats.shine);
    group.add(barV);

    group.position.set(LANES[laneIdx], baseY, zPos);
    const data: CoinUserData = {
      baseY,
      bobPhase: Math.random() * Math.PI * 2,
      collected: false,
      collectProgress: 0,
    };
    group.userData = data;
    return group;
  }

  public createCactusObstacle(laneIdx: number, tall = false): THREE.Group {
    const group = new THREE.Group();
    const height = tall ? 2.45 : 1.75;

    const trunkGeo = new THREE.BoxGeometry(0.75, height, 0.75);
    const trunk = new THREE.Mesh(trunkGeo, this.obsMaterials.cactusMain);
    trunk.position.y = height / 2;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    group.add(trunk);

    const armLGeo = new THREE.BoxGeometry(0.55, 0.36, 0.38);
    const armL = new THREE.Mesh(armLGeo, this.obsMaterials.cactusDark);
    armL.position.set(-0.55, height * 0.55, 0);
    armL.castShadow = true;
    group.add(armL);

    const tipLGeo = new THREE.BoxGeometry(0.36, 0.65, 0.38);
    const tipL = new THREE.Mesh(tipLGeo, this.obsMaterials.cactusMain);
    tipL.position.set(-0.68, height * 0.55 + 0.32, 0);
    tipL.castShadow = true;
    group.add(tipL);

    const armR = new THREE.Mesh(armLGeo, this.obsMaterials.cactusDark);
    armR.position.set(0.55, height * 0.42, 0);
    armR.castShadow = true;
    group.add(armR);

    const tipR = new THREE.Mesh(tipLGeo, this.obsMaterials.cactusMain);
    tipR.position.set(0.68, height * 0.42 + 0.32, 0);
    tipR.castShadow = true;
    group.add(tipR);

    const flowerGeo = new THREE.BoxGeometry(0.34, 0.24, 0.34);
    const flower = new THREE.Mesh(flowerGeo, this.obsMaterials.flower);
    flower.position.y = height + 0.12;
    group.add(flower);

    group.position.set(LANES[laneIdx], 0, OBSTACLE_SPAWN_Z);
    const data: ObstacleUserData = {
      type: 'cactus',
      colorHex: 0x16a34a,
      wingL: null,
      wingR: null,
      baseY: 0,
      flapPhase: 0,
      ownedGeometries: [trunkGeo, armLGeo, tipLGeo, flowerGeo],
    };
    group.userData = data;
    return group;
  }

  public createPterodactylObstacle(laneIdx: number, highFlying = true): THREE.Group {
    const group = new THREE.Group();
    const flyY = highFlying ? 2.15 : 0.95;

    const bodyGeo = new THREE.BoxGeometry(0.65, 0.48, 1.45);
    const body = new THREE.Mesh(bodyGeo, this.obsMaterials.pteroBody);
    body.castShadow = true;
    group.add(body);

    const headGeo = new THREE.BoxGeometry(0.46, 0.42, 0.58);
    const head = new THREE.Mesh(headGeo, this.obsMaterials.pteroBody);
    head.position.set(0, 0.18, 0.78);
    head.castShadow = true;
    group.add(head);

    const beakGeo = new THREE.BoxGeometry(0.24, 0.18, 0.65);
    const beak = new THREE.Mesh(beakGeo, this.obsMaterials.pteroBeak);
    beak.position.set(0, 0.12, 1.25);
    beak.castShadow = true;
    group.add(beak);

    const wingGeo = new THREE.BoxGeometry(1.15, 0.12, 0.72);
    const wingL = new THREE.Group();
    wingL.position.set(-0.32, 0.12, 0);
    const wingLMesh = new THREE.Mesh(wingGeo, this.obsMaterials.pteroWing);
    wingLMesh.position.set(-0.56, 0, 0);
    wingLMesh.castShadow = true;
    wingL.add(wingLMesh);
    group.add(wingL);

    const wingR = new THREE.Group();
    wingR.position.set(0.32, 0.12, 0);
    const wingRMesh = new THREE.Mesh(wingGeo, this.obsMaterials.pteroWing);
    wingRMesh.position.set(0.56, 0, 0);
    wingRMesh.castShadow = true;
    wingR.add(wingRMesh);
    group.add(wingR);

    group.position.set(LANES[laneIdx], flyY, OBSTACLE_SPAWN_Z);
    const data: ObstacleUserData = {
      type: 'ptero',
      colorHex: 0xa855f7,
      wingL,
      wingR,
      baseY: flyY,
      flapPhase: Math.random() * Math.PI * 2,
      ownedGeometries: [bodyGeo, headGeo, beakGeo, wingGeo],
    };
    group.userData = data;
    return group;
  }

  public dispose(): void {
    Object.values(this.obsMaterials).forEach((m) => m.dispose());
    Object.values(this.coinGeos).forEach((g) => g.dispose());
    Object.values(this.coinMats).forEach((m) => m.dispose());
    this.particleGeo.dispose();
  }
}
