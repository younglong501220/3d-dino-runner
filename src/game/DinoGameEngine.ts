import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  CoinUserData,
  createDino,
  DinoEntity,
  LANES,
  OBSTACLE_DESPAWN_Z,
  OBSTACLE_SPAWN_Z,
  ObstacleUserData,
  SharedGameAssets,
  TRACK_WIDTH,
} from './models';
import { SoundManager } from './sound';

export type GameState = 'READY' | 'PLAYING' | 'PAUSED' | 'GAMEOVER';
export type WeatherType = 'CLEAR' | 'SUNSET' | 'RAIN' | 'STORM';

export interface HudSnapshot {
  score: number;
  highScore: number;
  speedMultiplier: string;
  boostProgress: number; // 0 to 1 over 10s interval
  weather: WeatherType;
}

export interface GameOverSnapshot {
  finalScore: number;
  highScore: number;
  isNewRecord: boolean;
}

export interface DinoGameCallbacks {
  onStateChange: (state: GameState) => void;
  onHudUpdate: (snapshot: HudSnapshot) => void;
  onCoinCollected: (bonus: number) => void;
  onSpeedBoost: (multiplierLabel: string) => void;
  onGameOver: (snapshot: GameOverSnapshot) => void;
  onSoundChange: (enabled: boolean) => void;
  onFirstMove: () => void;
  onContextLost: (lost: boolean) => void;
}

interface ShatterParticle {
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  life: number;
  maxLife: number;
}

interface TrailParticle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  scale: number;
  life: number;
  maxLife: number;
  color: THREE.Color;
}

interface EdgeStreamParticle {
  side: -1 | 1;
  z: number;
  yOffset: number;
  phase: number;
  speedMul: number;
  scale: number;
}

const STORAGE_KEY = 'dino3d_high_score_v1';
const BASE_SPEED = 27;
const MAX_SPEED = 85;
const SPEED_BOOST_INTERVAL = 10;
const SPEED_BOOST_FACTOR = 1.1;
const COIN_BONUS_SCORE = 50;
const GRAVITY = -48;
const JUMP_VELOCITY = 17.8;
const SWIPE_THRESHOLD = 26;

function loadHighScore(): number {
  try {
    const val = parseInt(localStorage.getItem(STORAGE_KEY) ?? '0', 10);
    return Number.isFinite(val) && val > 0 ? val : 0;
  } catch {
    return 0;
  }
}

function saveHighScore(val: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(Math.floor(val)));
  } catch {
    // Ignore storage write restriction
  }
}

function detectSoftwareWebGL(): boolean {
  try {
    const probeCanvas = document.createElement('canvas');
    const gl = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function formatMultiplier(speed: number): string {
  return `${(speed / BASE_SPEED).toFixed(2).replace(/0$/, '')}x`;
}

export class DinoGameEngine {
  private readonly container: HTMLElement;
  private readonly callbacks: DinoGameCallbacks;
  private readonly sound = new SoundManager();
  private readonly assets = new SharedGameAssets();
  private readonly isSoftwareGl = detectSoftwareWebGL();

  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly envTexture: THREE.Texture;

  private readonly dirLight: THREE.DirectionalLight;
  private readonly gridHelper: THREE.GridHelper;
  private readonly laneDashes: THREE.Mesh[] = [];
  private readonly sideProps: THREE.Mesh[] = [];
  private readonly edgeStrips: THREE.Mesh[] = [];
  private readonly edgeStripMat: THREE.MeshStandardMaterial;
  private readonly edgeStreamMesh: THREE.InstancedMesh;
  private readonly edgeStreamParticles: EdgeStreamParticle[] = [];
  private readonly rainLines: THREE.LineSegments;
  private readonly rainPositions: Float32Array;
  private readonly rainCount = 320;

  private readonly trailMesh: THREE.InstancedMesh;
  private readonly trailPool: TrailParticle[] = [];
  private readonly maxTrailParticles = 120;
  private readonly dino: DinoEntity;

  private readonly activeObstacles: THREE.Group[] = [];
  private readonly activeCoins: THREE.Group[] = [];
  private readonly activeParticles: ShatterParticle[] = [];

  private readonly SKY_DAY = new THREE.Color(0xbfe3ff);
  private readonly SKY_SUNSET = new THREE.Color(0xfecdd3);
  private readonly SKY_RAIN = new THREE.Color(0x64748b);
  private readonly SKY_STORM = new THREE.Color(0x1e293b);
  private readonly SKY_LIGHTNING = new THREE.Color(0xf8fafc);
  private readonly currentSkyColor = new THREE.Color(0xbfe3ff);
  private readonly renderSkyColor = new THREE.Color(0xbfe3ff);

  private readonly baseCameraPos = new THREE.Vector3(0, 4.7, 9.2);
  private readonly cameraLookTarget = new THREE.Vector3(0, 1.8, -14);

  // Reusable math objects (zero GC in animation loop)
  private readonly _dinoBox = new THREE.Box3();
  private readonly _obstacleBox = new THREE.Box3();
  private readonly _coinBox = new THREE.Box3();
  private readonly _explodeOrigin = new THREE.Vector3();
  private readonly _dummyObj = new THREE.Object3D();
  private readonly _tempColor = new THREE.Color();

  private readonly GRID_SIZE = 160;
  private readonly GRID_DIVS = 40;
  private readonly GRID_STEP = 160 / 40;
  private readonly DASH_SPACING = 8;
  private readonly DASH_COUNT = 22;
  private readonly DASH_LOOP_LEN = 22 * 8;
  private readonly EDGE_STRIP_COUNT = 20;
  private readonly EDGE_STRIP_SPACING = 9;
  private readonly EDGE_STRIP_LOOP_LEN = 20 * 9;

  private readonly clock = new THREE.Clock();
  private frameId = 0;
  private gameOverTimeoutId = 0;
  private disposed = false;
  private contextLost = false;

  private gameState: GameState = 'READY';
  private currentWeather: WeatherType = 'CLEAR';
  private score = 0;
  private lastReportedScore = -1;
  private lastReportedBoostStep = -1;
  private lastReportedWeather: WeatherType = 'CLEAR';
  private highScore = loadHighScore();
  private lastMilestone = 0;
  private gameSpeed = BASE_SPEED;
  private speedBoostTimer = 0;
  private spawnCooldown = 0;
  private screenShake = 0;
  private elapsedVisualTime = 0;
  private footDustTimer = 0;
  private airTrailTimer = 0;
  private lightningTimer = 3.5;
  private lightningFlash = 0;

  // Touch tracking
  private touchStartX = 0;
  private touchStartY = 0;
  private touchHandled = false;

  // Disposable static geometries & materials
  private readonly staticDisposables: Array<{ dispose: () => void }> = [];

  constructor(container: HTMLElement, callbacks: DinoGameCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    // 1. Scene & Sky/Fog
    this.scene = new THREE.Scene();
    this.scene.background = this.currentSkyColor;
    this.scene.fog = new THREE.Fog(this.currentSkyColor.getHex(), 38, 138);

    // 2. Camera
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(58, width / height, 0.1, 220);
    this.camera.position.copy(this.baseCameraPos);
    this.camera.lookAt(this.cameraLookTarget);

    // 3. Renderer (with software-WebGL guard & modern sRGB/ACES pipeline)
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2)
    );
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.touchAction = 'none';
    this.container.appendChild(this.renderer.domElement);

    // 4. Studio Environment Reflection (RoomEnvironment)
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    const roomEnv = new RoomEnvironment();
    const envRT = pmremGenerator.fromScene(roomEnv, 0.04);
    this.envTexture = envRT.texture;
    this.scene.environment = this.envTexture;
    roomEnv.dispose();
    pmremGenerator.dispose();
    this.staticDisposables.push(envRT);

    // 5. Warm Key Light + Cool/Sand Hemisphere Fill
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xe2b887, 0.85);
    hemiLight.position.set(0, 30, 0);
    this.scene.add(hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xfffbeb, 1.05);
    this.dirLight.position.set(16, 28, 14);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 1024;
    this.dirLight.shadow.mapSize.height = 1024;
    this.dirLight.shadow.camera.near = 2;
    this.dirLight.shadow.camera.far = 95;
    this.dirLight.shadow.camera.left = -22;
    this.dirLight.shadow.camera.right = 22;
    this.dirLight.shadow.camera.top = 24;
    this.dirLight.shadow.camera.bottom = -32;
    this.dirLight.shadow.bias = -0.0005;
    this.dirLight.shadow.normalBias = 0.02;
    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);
    this.dirLight.target.position.set(0, 0, -12);

    // 6. Infinite Scrolling Track & Desert Scenery
    const groundGroup = new THREE.Group();
    this.scene.add(groundGroup);

    const desertGeo = new THREE.PlaneGeometry(320, 260);
    const desertMat = new THREE.MeshStandardMaterial({
      color: 0xeccca2,
      roughness: 0.95,
      metalness: 0.0,
    });
    const desertMesh = new THREE.Mesh(desertGeo, desertMat);
    desertMesh.rotation.x = -Math.PI / 2;
    desertMesh.position.set(0, -0.06, -90);
    desertMesh.receiveShadow = true;
    groundGroup.add(desertMesh);
    this.staticDisposables.push(desertGeo, desertMat);

    const trackGeo = new THREE.BoxGeometry(TRACK_WIDTH, 0.2, 220);
    const trackMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.85,
      metalness: 0.05,
    });
    const trackMesh = new THREE.Mesh(trackGeo, trackMat);
    trackMesh.position.set(0, -0.1, -85);
    trackMesh.receiveShadow = true;
    groundGroup.add(trackMesh);
    this.staticDisposables.push(trackGeo, trackMat);

    const curbGeo = new THREE.BoxGeometry(0.45, 0.34, 220);
    const curbMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      roughness: 0.6,
      metalness: 0.08,
    });
    const leftCurb = new THREE.Mesh(curbGeo, curbMat);
    leftCurb.position.set(-TRACK_WIDTH / 2 - 0.22, 0.05, -85);
    leftCurb.receiveShadow = true;
    leftCurb.castShadow = true;
    groundGroup.add(leftCurb);

    const rightCurb = new THREE.Mesh(curbGeo, curbMat);
    rightCurb.position.set(TRACK_WIDTH / 2 + 0.22, 0.05, -85);
    rightCurb.receiveShadow = true;
    rightCurb.castShadow = true;
    groundGroup.add(rightCurb);
    this.staticDisposables.push(curbGeo, curbMat);

    // Track Edge Glowing Light Strips
    const edgeStripGeo = new THREE.BoxGeometry(0.16, 0.09, 4.2);
    this.edgeStripMat = new THREE.MeshStandardMaterial({
      color: 0xfef08a,
      emissive: 0xf59e0b,
      emissiveIntensity: 1.4,
      roughness: 0.25,
      metalness: 0.3,
    });
    this.staticDisposables.push(edgeStripGeo, this.edgeStripMat);

    for (let i = 0; i < this.EDGE_STRIP_COUNT; i++) {
      const zPos = 14 - i * this.EDGE_STRIP_SPACING;
      const leftStrip = new THREE.Mesh(edgeStripGeo, this.edgeStripMat);
      leftStrip.position.set(-TRACK_WIDTH / 2 - 0.22, 0.24, zPos);
      this.scene.add(leftStrip);
      this.edgeStrips.push(leftStrip);

      const rightStrip = new THREE.Mesh(edgeStripGeo, this.edgeStripMat);
      rightStrip.position.set(TRACK_WIDTH / 2 + 0.22, 0.24, zPos);
      this.scene.add(rightStrip);
      this.edgeStrips.push(rightStrip);
    }

    // Track Edge Flowing Particle Stream (InstancedMesh)
    const edgeStreamCount = 56;
    const edgeStreamGeo = new THREE.BoxGeometry(0.16, 0.16, 0.55);
    const edgeStreamMat = new THREE.MeshBasicMaterial({
      color: 0xfde047,
      transparent: true,
      opacity: 0.85,
    });
    this.staticDisposables.push(edgeStreamGeo, edgeStreamMat);
    this.edgeStreamMesh = new THREE.InstancedMesh(edgeStreamGeo, edgeStreamMat, edgeStreamCount);
    this.edgeStreamMesh.frustumCulled = false;
    this.scene.add(this.edgeStreamMesh);

    for (let i = 0; i < edgeStreamCount; i++) {
      this.edgeStreamParticles.push({
        side: i % 2 === 0 ? -1 : 1,
        z: 14 - Math.random() * 145,
        yOffset: 0.36 + Math.random() * 0.65,
        phase: Math.random() * Math.PI * 2,
        speedMul: 1.15 + Math.random() * 0.45,
        scale: 0.65 + Math.random() * 0.65,
      });
    }

    this.gridHelper = new THREE.GridHelper(this.GRID_SIZE, this.GRID_DIVS, 0x94a3b8, 0x475569);
    this.gridHelper.position.set(0, 0.02, -65);
    this.gridHelper.scale.x = TRACK_WIDTH / this.GRID_SIZE;
    const gridMat = this.gridHelper.material as THREE.Material;
    gridMat.transparent = true;
    gridMat.opacity = 0.45;
    gridMat.polygonOffset = true;
    gridMat.polygonOffsetFactor = -1;
    gridMat.polygonOffsetUnits = -1;
    groundGroup.add(this.gridHelper);

    const dashGeo = new THREE.BoxGeometry(0.18, 0.03, 2.6);
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xe2e8f0 });
    this.staticDisposables.push(dashGeo, dashMat);

    for (let i = 0; i < this.DASH_COUNT; i++) {
      const zPos = 12 - i * this.DASH_SPACING;
      const leftDash = new THREE.Mesh(dashGeo, dashMat);
      leftDash.position.set(-1.65, 0.02, zPos);
      this.scene.add(leftDash);
      this.laneDashes.push(leftDash);

      const rightDash = new THREE.Mesh(dashGeo, dashMat);
      rightDash.position.set(1.65, 0.02, zPos);
      this.scene.add(rightDash);
      this.laneDashes.push(rightDash);
    }

    const propGeoRock = new THREE.DodecahedronGeometry(1, 0);
    const propMatRock = new THREE.MeshStandardMaterial({ color: 0xc28e64, roughness: 0.9 });
    const propGeoPillar = new THREE.BoxGeometry(1.5, 4, 1.5);
    const propMatPillar = new THREE.MeshStandardMaterial({ color: 0xb47b52, roughness: 0.9 });
    this.staticDisposables.push(propGeoRock, propMatRock, propGeoPillar, propMatPillar);

    for (let i = 0; i < 26; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const isPillar = i % 3 === 0;
      const prop = new THREE.Mesh(
        isPillar ? propGeoPillar : propGeoRock,
        isPillar ? propMatPillar : propMatRock
      );
      const distFromTrack = TRACK_WIDTH / 2 + 3.5 + Math.random() * 18;
      const scale = isPillar ? 0.8 + Math.random() * 1.4 : 0.9 + Math.random() * 1.8;
      prop.scale.set(scale, scale * (isPillar ? 1.3 : 0.75), scale);
      prop.position.set(
        side * distFromTrack,
        isPillar ? scale * 1.4 : scale * 0.3,
        12 - i * 6.5
      );
      prop.rotation.y = Math.random() * Math.PI * 2;
      prop.castShadow = true;
      prop.receiveShadow = true;
      this.scene.add(prop);
      this.sideProps.push(prop);
    }

    // 7. Voxel Dino
    this.dino = createDino();
    this.scene.add(this.dino.root);

    // 7b. Weather Rain Streaks (LineSegments)
    const rainGeo = new THREE.BufferGeometry();
    this.rainPositions = new Float32Array(this.rainCount * 6);
    for (let i = 0; i < this.rainCount; i++) {
      const rx = (Math.random() - 0.5) * 44;
      const ry = Math.random() * 24;
      const rz = 12 - Math.random() * 95;
      const idx = i * 6;
      this.rainPositions[idx] = rx;
      this.rainPositions[idx + 1] = ry;
      this.rainPositions[idx + 2] = rz;
      this.rainPositions[idx + 3] = rx - 0.16;
      this.rainPositions[idx + 4] = ry - 1.25;
      this.rainPositions[idx + 5] = rz + 0.45;
    }
    rainGeo.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3));
    const rainMat = new THREE.LineBasicMaterial({
      color: 0xe2e8f0,
      transparent: true,
      opacity: 0.48,
    });
    this.rainLines = new THREE.LineSegments(rainGeo, rainMat);
    this.rainLines.frustumCulled = false;
    this.rainLines.visible = false;
    this.scene.add(this.rainLines);
    this.staticDisposables.push(rainGeo, rainMat);

    // 7c. Trailing Particle Pool (InstancedMesh for jump, duck, and running dust)
    const trailGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
    const trailMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.88,
    });
    this.staticDisposables.push(trailGeo, trailMat);
    this.trailMesh = new THREE.InstancedMesh(trailGeo, trailMat, this.maxTrailParticles);
    this.trailMesh.frustumCulled = false;
    this.scene.add(this.trailMesh);

    for (let i = 0; i < this.maxTrailParticles; i++) {
      this.trailPool.push({
        active: false,
        x: 0,
        y: -50,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        scale: 0,
        life: 0,
        maxLife: 1,
        color: new THREE.Color(0xffffff),
      });
      this._dummyObj.position.set(0, -50, 0);
      this._dummyObj.scale.setScalar(0.001);
      this._dummyObj.updateMatrix();
      this.trailMesh.setMatrixAt(i, this._dummyObj.matrix);
      this.trailMesh.setColorAt(i, this._tempColor.setHex(0xffffff));
    }
    this.trailMesh.instanceMatrix.needsUpdate = true;
    if (this.trailMesh.instanceColor) {
      this.trailMesh.instanceColor.needsUpdate = true;
    }

    // 8. Pre-warm shaders on GPU devices
    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    // 9. Event Listeners
    this.bindEvents();

    // 10. Initial HUD sync & start loop
    this.callbacks.onHudUpdate({
      score: 0,
      highScore: this.highScore,
      speedMultiplier: '1.0x',
      boostProgress: 0,
      weather: 'CLEAR',
    });
    this.callbacks.onSoundChange(this.sound.isEnabled());
    this.callbacks.onStateChange('READY');

    this.clock.start();
    this.tick();
  }

  public startGame(): void {
    if (this.disposed) return;
    window.clearTimeout(this.gameOverTimeoutId);
    this.sound.unlock();
    this.clearAllObstacles();
    this.clearAllCoins();
    this.clearParticles();
    this.clearTrailParticles();
    this.resetDino();

    this.score = 0;
    this.lastReportedScore = 0;
    this.lastReportedBoostStep = 0;
    this.currentWeather = 'CLEAR';
    this.lastReportedWeather = 'CLEAR';
    this.lastMilestone = 0;
    this.gameSpeed = BASE_SPEED;
    this.speedBoostTimer = 0;
    this.spawnCooldown = 0.6;
    this.screenShake = 0;
    this.footDustTimer = 0;
    this.airTrailTimer = 0;
    this.lightningTimer = 3.5;
    this.lightningFlash = 0;
    this.rainLines.visible = false;
    this.currentSkyColor.copy(this.SKY_DAY);
    this.renderSkyColor.copy(this.SKY_DAY);
    (this.scene.background as THREE.Color).copy(this.SKY_DAY);
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(this.SKY_DAY);
      this.scene.fog.near = 38;
      this.scene.fog.far = 138;
    }
    this.dirLight.intensity = 1.05;

    this.callbacks.onFirstMove();
    this.callbacks.onHudUpdate({
      score: 0,
      highScore: this.highScore,
      speedMultiplier: '1.0x',
      boostProgress: 0,
      weather: 'CLEAR',
    });

    this.gameState = 'PLAYING';
    this.callbacks.onStateChange('PLAYING');
  }

  public pauseGame(): void {
    if (this.disposed || this.gameState !== 'PLAYING') return;
    this.gameState = 'PAUSED';
    this.sound.pause();
    this.callbacks.onStateChange('PAUSED');
  }

  public resumeGame(): void {
    if (this.disposed || this.gameState !== 'PAUSED') return;
    this.sound.unlock();
    this.sound.resume();
    this.clock.getDelta(); // Flush accumulated elapsed delta while paused
    this.gameState = 'PLAYING';
    this.callbacks.onStateChange('PLAYING');
  }

  public togglePause(): void {
    if (this.gameState === 'PLAYING') {
      this.pauseGame();
    } else if (this.gameState === 'PAUSED') {
      this.resumeGame();
    }
  }

  public toggleSound(): void {
    const enabled = this.sound.toggle();
    this.callbacks.onSoundChange(enabled);
  }

  public moveLane(dir: -1 | 1): void {
    if (this.gameState !== 'PLAYING') return;
    const nextLane = Math.max(0, Math.min(2, this.dino.laneIndex + dir));
    if (nextLane !== this.dino.laneIndex) {
      this.dino.laneIndex = nextLane;
      this.dino.targetX = LANES[nextLane];
      this.sound.lane();
    }
  }

  public jump(): void {
    if (this.gameState !== 'PLAYING') return;
    if (this.dino.isGrounded) {
      this.dino.vy = JUMP_VELOCITY;
      this.dino.isGrounded = false;
      this.dino.duckTimer = 0;
      this.sound.jump();
      this.emitTrailParticles(
        10,
        this.dino.root.position.x,
        0.15,
        this.dino.root.position.z + 0.15,
        0.55,
        2.2,
        5.8,
        2.5,
        7.5,
        0.75,
        1.35,
        0.28,
        0.52,
        0x86efac
      );
    }
  }

  public duckOrSlam(): void {
    if (this.gameState !== 'PLAYING') return;
    if (!this.dino.isGrounded) {
      this.dino.vy = Math.min(this.dino.vy, -26);
      this.dino.duckTimer = 0.28;
      this.sound.duck();
      this.emitTrailParticles(
        8,
        this.dino.root.position.x,
        this.dino.root.position.y + 0.8,
        this.dino.root.position.z,
        0.5,
        3.5,
        7.5,
        3,
        6,
        0.7,
        1.2,
        0.22,
        0.4,
        0x38bdf8
      );
    } else {
      this.dino.duckTimer = 0.58;
      this.sound.duck();
      this.emitTrailParticles(
        6,
        this.dino.root.position.x,
        0.18,
        this.dino.root.position.z + 0.35,
        0.6,
        1.2,
        3.2,
        5,
        10,
        0.65,
        1.15,
        0.22,
        0.42,
        0xfde047
      );
    }
  }

  private resetDino(): void {
    this.dino.laneIndex = 1;
    this.dino.targetX = LANES[1];
    this.dino.root.position.set(LANES[1], 0, 0);
    this.dino.root.rotation.set(0, 0, 0);
    this.dino.bodyGroup.scale.set(1, 1, 1);
    this.dino.bodyGroup.position.set(0, 0, 0);
    this.dino.vy = 0;
    this.dino.isGrounded = true;
    this.dino.duckTimer = 0;
    this.dino.runPhase = 0;
    this.dino.root.visible = true;
  }

  private destroyObstacle(obs: THREE.Group): void {
    this.scene.remove(obs);
    const data = obs.userData as ObstacleUserData | undefined;
    if (data && Array.isArray(data.ownedGeometries)) {
      for (let i = 0; i < data.ownedGeometries.length; i++) {
        data.ownedGeometries[i].dispose();
      }
      data.ownedGeometries.length = 0;
    }
  }

  private clearAllObstacles(): void {
    while (this.activeObstacles.length > 0) {
      const obs = this.activeObstacles.pop()!;
      this.destroyObstacle(obs);
    }
  }

  private clearAllCoins(): void {
    while (this.activeCoins.length > 0) {
      const coin = this.activeCoins.pop()!;
      this.scene.remove(coin);
    }
  }

  private clearParticles(): void {
    while (this.activeParticles.length > 0) {
      const p = this.activeParticles.pop()!;
      this.scene.remove(p.mesh);
      p.mat.dispose();
    }
  }

  private clearTrailParticles(): void {
    for (let i = 0; i < this.maxTrailParticles; i++) {
      this.trailPool[i].active = false;
      this._dummyObj.position.set(0, -50, 0);
      this._dummyObj.scale.setScalar(0.001);
      this._dummyObj.updateMatrix();
      this.trailMesh.setMatrixAt(i, this._dummyObj.matrix);
    }
    this.trailMesh.instanceMatrix.needsUpdate = true;
  }

  private emitTrailParticles(
    count: number,
    originX: number,
    originY: number,
    originZ: number,
    spreadX: number,
    vyMin: number,
    vyMax: number,
    vzMin: number,
    vzMax: number,
    scaleMin: number,
    scaleMax: number,
    lifeMin: number,
    lifeMax: number,
    colorHex: number
  ): void {
    let spawned = 0;
    for (let i = 0; i < this.maxTrailParticles && spawned < count; i++) {
      const p = this.trailPool[i];
      if (p.active) continue;
      p.active = true;
      p.x = originX + (Math.random() - 0.5) * spreadX;
      p.y = originY + Math.random() * 0.16;
      p.z = originZ + (Math.random() - 0.5) * 0.3;
      p.vx = (Math.random() - 0.5) * 2.6;
      p.vy = vyMin + Math.random() * (vyMax - vyMin);
      p.vz = vzMin + Math.random() * (vzMax - vzMin);
      p.scale = scaleMin + Math.random() * (scaleMax - scaleMin);
      p.maxLife = lifeMin + Math.random() * (lifeMax - lifeMin);
      p.life = p.maxLife;
      p.color.setHex(colorHex);
      spawned++;
    }
  }

  private spawnObstacleWave(): void {
    const laneIndices = [0, 1, 2];
    for (let i = laneIndices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = laneIndices[i];
      laneIndices[i] = laneIndices[j];
      laneIndices[j] = temp;
    }

    const doubleObstacle =
      this.score > 80 && Math.random() < Math.min(0.55, 0.25 + this.score * 0.0004);
    const count = doubleObstacle ? 2 : 1;

    for (let i = 0; i < count; i++) {
      const lane = laneIndices[i];
      const pteroChance = this.score > 50 ? 0.34 : 0.12;
      if (Math.random() < pteroChance) {
        const highFlying = Math.random() < 0.6;
        const obs = this.assets.createPterodactylObstacle(lane, highFlying);
        this.scene.add(obs);
        this.activeObstacles.push(obs);
      } else {
        const tall = this.score > 120 && Math.random() < 0.35;
        const obs = this.assets.createCactusObstacle(lane, tall);
        this.scene.add(obs);
        this.activeObstacles.push(obs);
      }
    }

    // Always place coin blocks on safe open lanes (avoiding obstacle lanes)
    if (Math.random() < 0.68) {
      const safeLane = laneIndices[count];
      const elevated = Math.random() < 0.28;
      const coin = this.assets.createCoinBlock(safeLane, OBSTACLE_SPAWN_Z, elevated);
      this.scene.add(coin);
      this.activeCoins.push(coin);
    }

    if (Math.random() < 0.38) {
      const randomLane = Math.floor(Math.random() * 3);
      const coin = this.assets.createCoinBlock(randomLane, OBSTACLE_SPAWN_Z - 12, false);
      this.scene.add(coin);
      this.activeCoins.push(coin);
    }
  }

  private spawnExplosion(originPos: THREE.Vector3, obstacleColorHex: number): void {
    const colors = [0x22c55e, 0x86efac, 0x15803d, obstacleColorHex, 0xfbbf24];
    const count = 42;

    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: colors[i % colors.length],
        roughness: 0.5,
      });
      const mesh = new THREE.Mesh(this.assets.particleGeo, mat);
      mesh.castShadow = true;
      mesh.position.set(
        originPos.x + (Math.random() - 0.5) * 1.1,
        originPos.y + 0.6 + Math.random() * 1.3,
        originPos.z + (Math.random() - 0.5) * 1.1
      );
      const scale = 0.65 + Math.random() * 1.15;
      mesh.scale.setScalar(scale);

      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 11;
      this.scene.add(mesh);

      this.activeParticles.push({
        mesh,
        mat,
        vx: Math.cos(angle) * speed,
        vy: 6 + Math.random() * 12,
        vz: Math.sin(angle) * speed + 4,
        rx: (Math.random() - 0.5) * 14,
        ry: (Math.random() - 0.5) * 14,
        life: 1.5 + Math.random() * 0.7,
        maxLife: 2.2,
      });
    }
  }

  private checkCollisions(): THREE.Group | null {
    this.dino.root.updateMatrixWorld(true);
    this._dinoBox.setFromObject(this.dino.collider);

    for (let i = 0; i < this.activeObstacles.length; i++) {
      const obs = this.activeObstacles[i];
      if (obs.position.z < -3.2 || obs.position.z > 2.6) continue;

      obs.updateMatrixWorld(true);
      this._obstacleBox.setFromObject(obs);
      this._obstacleBox.expandByScalar(-0.14);

      if (this._dinoBox.intersectsBox(this._obstacleBox)) {
        return obs;
      }
    }
    return null;
  }

  private checkCoinPickups(): void {
    this.dino.root.updateMatrixWorld(true);
    this._dinoBox.setFromObject(this.dino.collider);

    for (let i = 0; i < this.activeCoins.length; i++) {
      const coin = this.activeCoins[i];
      const data = coin.userData as CoinUserData;
      if (data.collected) continue;
      if (coin.position.z < -2.6 || coin.position.z > 2.4) continue;

      coin.updateMatrixWorld(true);
      this._coinBox.setFromObject(coin);
      this._coinBox.expandByScalar(0.16);

      if (this._dinoBox.intersectsBox(this._coinBox)) {
        data.collected = true;
        data.collectProgress = 0;
        this.score += COIN_BONUS_SCORE;
        this.sound.coin();
        this.callbacks.onCoinCollected(COIN_BONUS_SCORE);
      }
    }
  }

  private triggerGameOver(hitObstacle: THREE.Group): void {
    this.gameState = 'GAMEOVER';
    this.callbacks.onStateChange('GAMEOVER');
    this.sound.crash();
    this.screenShake = 0.55;

    this._explodeOrigin.copy(this.dino.root.position);
    this.dino.root.visible = false;
    const obsData = hitObstacle.userData as ObstacleUserData;
    this.spawnExplosion(this._explodeOrigin, obsData.colorHex || 0x16a34a);

    const finalScore = Math.floor(this.score);
    let isNewRecord = false;
    if (finalScore > this.highScore) {
      this.highScore = finalScore;
      saveHighScore(this.highScore);
      isNewRecord = true;
    }

    this.callbacks.onHudUpdate({
      score: finalScore,
      highScore: this.highScore,
      speedMultiplier: formatMultiplier(this.gameSpeed),
      boostProgress: Math.min(1, this.speedBoostTimer / SPEED_BOOST_INTERVAL),
      weather: this.currentWeather,
    });

    window.clearTimeout(this.gameOverTimeoutId);
    this.gameOverTimeoutId = window.setTimeout(() => {
      if (!this.disposed && this.gameState === 'GAMEOVER') {
        this.callbacks.onGameOver({
          finalScore,
          highScore: this.highScore,
          isNewRecord,
        });
      }
    }, 420);
  }

  private updateEnvironmentAtmosphere(dist: number, dt: number): void {
    const cycle = (dist % 900) / 900;
    let targetColor = this.SKY_DAY;
    let lightIntensity = 1.05;
    let targetFogNear = 38;
    let targetFogFar = 138;
    let nextWeather: WeatherType = 'CLEAR';

    if (cycle < 0.28) {
      nextWeather = 'CLEAR';
      targetColor = this.SKY_DAY;
      lightIntensity = 1.05;
      targetFogNear = 38;
      targetFogFar = 138;
    } else if (cycle < 0.50) {
      nextWeather = 'SUNSET';
      targetColor = this.SKY_SUNSET;
      lightIntensity = 0.92;
      targetFogNear = 32;
      targetFogFar = 122;
    } else if (cycle < 0.74) {
      nextWeather = 'RAIN';
      targetColor = this.SKY_RAIN;
      lightIntensity = 0.72;
      targetFogNear = 18;
      targetFogFar = 82;
    } else {
      nextWeather = 'STORM';
      targetColor = this.SKY_STORM;
      lightIntensity = 0.56;
      targetFogNear = 13;
      targetFogFar = 66;
    }

    this.currentWeather = nextWeather;
    const isRaining = nextWeather === 'RAIN' || nextWeather === 'STORM';
    this.rainLines.visible = isRaining;

    // Smooth sky color & fog density transitions
    this.currentSkyColor.lerp(targetColor, Math.min(1, dt * 1.8));
    if (this.scene.fog instanceof THREE.Fog) {
      const fogLerp = Math.min(1, dt * 1.4);
      this.scene.fog.near += (targetFogNear - this.scene.fog.near) * fogLerp;
      this.scene.fog.far += (targetFogFar - this.scene.fog.far) * fogLerp;
    }

    // Lightning effect during storm (and occasional heavy rain)
    if (nextWeather === 'STORM') {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningFlash = 1.0;
        this.lightningTimer = 3.0 + Math.random() * 4.5;
        this.sound.thunder();
      }
    }

    let flashBoost = 0;
    if (this.lightningFlash > 0) {
      this.lightningFlash = Math.max(0, this.lightningFlash - dt * 2.6);
      // Double-pulse lightning envelope
      const pulseA = Math.sin(this.lightningFlash * Math.PI * 3.0);
      flashBoost = Math.max(0, pulseA) * this.lightningFlash;
    }

    this.renderSkyColor.copy(this.currentSkyColor);
    if (flashBoost > 0) {
      this.renderSkyColor.lerp(this.SKY_LIGHTNING, Math.min(0.88, flashBoost * 0.95));
    }

    (this.scene.background as THREE.Color).copy(this.renderSkyColor);
    if (this.scene.fog) {
      this.scene.fog.color.copy(this.renderSkyColor);
    }

    const baseDirIntensity = this.dirLight.intensity + (lightIntensity - this.dirLight.intensity) * 0.04;
    this.dirLight.intensity = baseDirIntensity + flashBoost * 2.2;

    // Rain particle updates when raining
    if (isRaining) {
      const fallSpeed = nextWeather === 'STORM' ? 42 : 30;
      const forwardWind = this.gameSpeed * 0.55;
      for (let i = 0; i < this.rainCount; i++) {
        const idx = i * 6;
        let x = this.rainPositions[idx];
        let y = this.rainPositions[idx + 1] - fallSpeed * dt;
        let z = this.rainPositions[idx + 2] + forwardWind * dt;

        if (y < 0 || z > 14) {
          x = (Math.random() - 0.5) * 44;
          y = 18 + Math.random() * 8;
          z = 12 - Math.random() * 95;
        }
        this.rainPositions[idx] = x;
        this.rainPositions[idx + 1] = y;
        this.rainPositions[idx + 2] = z;
        this.rainPositions[idx + 3] = x - 0.16;
        this.rainPositions[idx + 4] = y - 1.25;
        this.rainPositions[idx + 5] = z + 0.45;
      }
      const posAttr = this.rainLines.geometry.getAttribute('position') as THREE.BufferAttribute;
      posAttr.needsUpdate = true;
    }
  }

  private stepSimulation(dt: number): void {
    this.elapsedVisualTime += dt;

    // 1. Scroll track grid, lane dashes, track edge effects, and roadside props
    const activeScrollSpeed =
      this.gameState === 'PLAYING' ? this.gameSpeed : this.gameState === 'READY' ? 12 : 0;

    if (activeScrollSpeed > 0) {
      this.gridHelper.position.z += activeScrollSpeed * dt;
      if (this.gridHelper.position.z >= -65 + this.GRID_STEP) {
        this.gridHelper.position.z -= this.GRID_STEP;
      }

      for (let i = 0; i < this.laneDashes.length; i++) {
        const dash = this.laneDashes[i];
        dash.position.z += activeScrollSpeed * dt;
        if (dash.position.z > 14) {
          dash.position.z -= this.DASH_LOOP_LEN;
        }
      }

      for (let i = 0; i < this.sideProps.length; i++) {
        const prop = this.sideProps[i];
        prop.position.z += activeScrollSpeed * dt;
        if (prop.position.z > 18) {
          prop.position.z -= 26 * 6.5;
          const side = prop.position.x < 0 ? -1 : 1;
          prop.position.x = side * (TRACK_WIDTH / 2 + 3.5 + Math.random() * 18);
        }
      }

      // Scroll & pulse Track Edge Light Strips
      const edgePulse = 1.1 + Math.sin(this.elapsedVisualTime * 7.5) * 0.55;
      this.edgeStripMat.emissiveIntensity = edgePulse;
      if (this.currentWeather === 'RAIN' || this.currentWeather === 'STORM') {
        this.edgeStripMat.emissive.setHex(0x38bdf8);
        this.edgeStripMat.color.setHex(0xbae6fd);
      } else {
        this.edgeStripMat.emissive.setHex(0xf59e0b);
        this.edgeStripMat.color.setHex(0xfef08a);
      }

      for (let i = 0; i < this.edgeStrips.length; i++) {
        const strip = this.edgeStrips[i];
        strip.position.z += activeScrollSpeed * dt;
        if (strip.position.z > 14) {
          strip.position.z -= this.EDGE_STRIP_LOOP_LEN;
        }
      }

      // Update Track Edge Flowing Particles
      for (let i = 0; i < this.edgeStreamParticles.length; i++) {
        const ep = this.edgeStreamParticles[i];
        ep.z += activeScrollSpeed * ep.speedMul * dt;
        if (ep.z > 14) {
          ep.z = -132 - Math.random() * 16;
        }
        const waveY = ep.yOffset + Math.sin(this.elapsedVisualTime * 5 + ep.phase) * 0.14;
        this._dummyObj.position.set(
          ep.side * (TRACK_WIDTH / 2 + 0.22),
          waveY,
          ep.z
        );
        this._dummyObj.rotation.set(0, 0, 0);
        this._dummyObj.scale.set(ep.scale, ep.scale, ep.scale * 1.4);
        this._dummyObj.updateMatrix();
        this.edgeStreamMesh.setMatrixAt(i, this._dummyObj.matrix);
      }
      this.edgeStreamMesh.instanceMatrix.needsUpdate = true;
    }

    // 2. Playing logic
    if (this.gameState === 'PLAYING') {
      this.score += this.gameSpeed * dt * 0.65;

      // Every 10 seconds, increase gameSpeed by 10% (decoupled from coin bonus)
      this.speedBoostTimer += dt;
      if (this.speedBoostTimer >= SPEED_BOOST_INTERVAL) {
        this.speedBoostTimer -= SPEED_BOOST_INTERVAL;
        if (this.gameSpeed < MAX_SPEED) {
          this.gameSpeed = Math.min(MAX_SPEED, this.gameSpeed * SPEED_BOOST_FACTOR);
          this.sound.speedUp();
          this.callbacks.onSpeedBoost(formatMultiplier(this.gameSpeed));
        }
      }

      this.updateEnvironmentAtmosphere(this.score, dt);

      const intScore = Math.floor(this.score);
      const boostStep = Math.floor((this.speedBoostTimer / SPEED_BOOST_INTERVAL) * 20);
      if (
        intScore !== this.lastReportedScore ||
        boostStep !== this.lastReportedBoostStep ||
        this.currentWeather !== this.lastReportedWeather
      ) {
        this.lastReportedScore = intScore;
        this.lastReportedBoostStep = boostStep;
        this.lastReportedWeather = this.currentWeather;
        this.callbacks.onHudUpdate({
          score: intScore,
          highScore: this.highScore,
          speedMultiplier: formatMultiplier(this.gameSpeed),
          boostProgress: Math.min(1, this.speedBoostTimer / SPEED_BOOST_INTERVAL),
          weather: this.currentWeather,
        });
      }

      const milestoneStep = Math.floor(intScore / 250);
      if (milestoneStep > this.lastMilestone && intScore > 0) {
        this.lastMilestone = milestoneStep;
        this.sound.milestone();
      }

      // Dino lateral lane lerp + roll tilt
      const prevX = this.dino.root.position.x;
      const lerpAlpha = 1 - Math.exp(-16 * dt);
      this.dino.root.position.x += (this.dino.targetX - this.dino.root.position.x) * lerpAlpha;
      const vx = (this.dino.root.position.x - prevX) / Math.max(dt, 0.001);
      const targetRoll = THREE.MathUtils.clamp(-vx * 0.028, -0.32, 0.32);
      this.dino.root.rotation.z += (targetRoll - this.dino.root.rotation.z) * 0.22;

      // Dino jump gravity + landing dust burst
      if (!this.dino.isGrounded) {
        this.dino.vy += GRAVITY * dt;
        this.dino.root.position.y += this.dino.vy * dt;
        if (this.dino.root.position.y <= 0) {
          this.dino.root.position.y = 0;
          const impactVy = Math.abs(this.dino.vy);
          this.dino.vy = 0;
          this.dino.isGrounded = true;
          this.emitTrailParticles(
            impactVy > 20 ? 12 : 7,
            this.dino.root.position.x,
            0.14,
            this.dino.root.position.z + 0.1,
            0.75,
            1.4,
            4.2,
            2,
            6,
            0.65,
            1.2,
            0.22,
            0.42,
            this.currentWeather === 'RAIN' || this.currentWeather === 'STORM'
              ? 0x94a3b8
              : 0xe2c799
          );
        }
      }

      // Ducking squash
      if (this.dino.duckTimer > 0) {
        this.dino.duckTimer -= dt;
      }
      const targetScaleY = this.dino.duckTimer > 0 ? 0.56 : 1.0;
      const targetScaleXZ = this.dino.duckTimer > 0 ? 1.18 : 1.0;
      this.dino.bodyGroup.scale.y += (targetScaleY - this.dino.bodyGroup.scale.y) * 0.28;
      this.dino.bodyGroup.scale.x += (targetScaleXZ - this.dino.bodyGroup.scale.x) * 0.28;
      this.dino.bodyGroup.scale.z += (targetScaleXZ - this.dino.bodyGroup.scale.z) * 0.28;

      // Dino leg/tail/head run cycle & footstep / air trailing particles
      if (this.dino.isGrounded) {
        this.dino.runPhase += dt * (this.gameSpeed * 0.62);
        const swing = Math.sin(this.dino.runPhase) * 0.65;
        this.dino.leftLeg.rotation.x = swing;
        this.dino.rightLeg.rotation.x = -swing;
        this.dino.bodyGroup.position.y = Math.abs(Math.cos(this.dino.runPhase)) * 0.08;
        this.dino.tailGroup.rotation.y = Math.sin(this.dino.runPhase * 0.5) * 0.16;
        this.dino.headGroup.rotation.x =
          this.dino.duckTimer > 0 ? 0.25 : Math.sin(this.dino.runPhase * 2) * 0.04;

        this.footDustTimer -= dt;
        const dustInterval = this.dino.duckTimer > 0 ? 0.032 : 0.065;
        if (this.footDustTimer <= 0) {
          this.footDustTimer = dustInterval;
          const dustColor =
            this.dino.duckTimer > 0
              ? 0xfde047
              : this.currentWeather === 'RAIN' || this.currentWeather === 'STORM'
              ? 0x94a3b8
              : 0xd6b88c;
          this.emitTrailParticles(
            this.dino.duckTimer > 0 ? 2 : 1,
            this.dino.root.position.x,
            0.12,
            this.dino.root.position.z + 0.42,
            0.48,
            0.7,
            2.1,
            4.5,
            8.5,
            0.45,
            0.85,
            0.18,
            0.34,
            dustColor
          );
        }
      } else {
        this.dino.leftLeg.rotation.x = -0.45;
        this.dino.rightLeg.rotation.x = 0.35;
        this.dino.bodyGroup.position.y = 0;
        this.dino.headGroup.rotation.x = -this.dino.vy * 0.012;

        this.airTrailTimer -= dt;
        if (this.airTrailTimer <= 0) {
          this.airTrailTimer = 0.04;
          const isSlamming = this.dino.vy < -20;
          this.emitTrailParticles(
            isSlamming ? 2 : 1,
            this.dino.root.position.x,
            this.dino.root.position.y + 0.45,
            this.dino.root.position.z + 0.25,
            0.55,
            isSlamming ? 2.5 : -0.6,
            isSlamming ? 5.5 : 1.2,
            3.5,
            7.5,
            0.45,
            0.9,
            0.18,
            0.32,
            isSlamming ? 0x38bdf8 : 0xa7f3d0
          );
        }
      }

      // Spawn waves
      this.spawnCooldown -= dt;
      if (this.spawnCooldown <= 0) {
        this.spawnObstacleWave();
        const gapDistance = 24 + Math.random() * 14;
        this.spawnCooldown = Math.max(0.36, gapDistance / this.gameSpeed);
      }

      // Move & despawn obstacles
      for (let i = this.activeObstacles.length - 1; i >= 0; i--) {
        const obs = this.activeObstacles[i];
        obs.position.z += this.gameSpeed * dt;

        const data = obs.userData as ObstacleUserData;
        if (data.type === 'ptero' && data.wingL && data.wingR) {
          data.flapPhase += dt * 13;
          const flap = Math.sin(data.flapPhase) * 0.62;
          data.wingL.rotation.z = flap;
          data.wingR.rotation.z = -flap;
          obs.position.y = data.baseY + Math.sin(data.flapPhase * 0.5) * 0.14;
        }

        if (obs.position.z > OBSTACLE_DESPAWN_Z) {
          this.activeObstacles.splice(i, 1);
          this.destroyObstacle(obs);
        }
      }

      // Move, animate & despawn coins
      for (let i = this.activeCoins.length - 1; i >= 0; i--) {
        const coin = this.activeCoins[i];
        const data = coin.userData as CoinUserData;

        if (data.collected) {
          data.collectProgress += dt / 0.32;
          const t = data.collectProgress;

          coin.rotation.y += dt * 18;
          coin.position.y += dt * 5.8;

          if (t < 0.38) {
            const upScale = 1 + (t / 0.38) * 0.85;
            coin.scale.setScalar(upScale);
          } else {
            const downScale = Math.max(0.01, 1.85 * (1 - (t - 0.38) / 0.62));
            coin.scale.setScalar(downScale);
          }

          if (t >= 1) {
            this.activeCoins.splice(i, 1);
            this.scene.remove(coin);
          }
        } else {
          coin.position.z += this.gameSpeed * dt;
          coin.rotation.y += dt * 3.4;
          data.bobPhase += dt * 4.5;
          coin.position.y = data.baseY + Math.sin(data.bobPhase) * 0.16;
          const pulse = 1 + Math.sin(data.bobPhase * 1.4) * 0.08;
          coin.scale.setScalar(pulse);

          if (coin.position.z > OBSTACLE_DESPAWN_Z) {
            this.activeCoins.splice(i, 1);
            this.scene.remove(coin);
          }
        }
      }

      // Check coin pickups & obstacle collisions
      this.checkCoinPickups();
      const hitObstacle = this.checkCollisions();
      if (hitObstacle) {
        this.triggerGameOver(hitObstacle);
      }
    } else if (this.gameState === 'READY') {
      this.dino.runPhase += dt * 10;
      const swing = Math.sin(this.dino.runPhase) * 0.45;
      this.dino.leftLeg.rotation.x = swing;
      this.dino.rightLeg.rotation.x = -swing;
      this.dino.bodyGroup.position.y = Math.abs(Math.cos(this.dino.runPhase)) * 0.06;
    }

    // 3. Shatter particles physics
    for (let i = this.activeParticles.length - 1; i >= 0; i--) {
      const p = this.activeParticles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mat.dispose();
        this.activeParticles.splice(i, 1);
        continue;
      }

      p.vy += GRAVITY * 0.72 * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;

      if (p.mesh.position.y < 0.14) {
        p.mesh.position.y = 0.14;
        p.vy = -p.vy * 0.45;
        p.vx *= 0.8;
        p.vz *= 0.8;
      }

      p.mesh.rotation.x += p.rx * dt;
      p.mesh.rotation.y += p.ry * dt;
      const fadeScale = Math.max(0.01, (p.life / p.maxLife) * 1.1);
      p.mesh.scale.setScalar(fadeScale);
    }

    // 3b. Trailing Particles InstancedMesh update
    let anyTrailUpdated = false;
    for (let i = 0; i < this.maxTrailParticles; i++) {
      const p = this.trailPool[i];
      if (!p.active) continue;
      anyTrailUpdated = true;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        this._dummyObj.position.set(0, -50, 0);
        this._dummyObj.scale.setScalar(0.001);
        this._dummyObj.updateMatrix();
        this.trailMesh.setMatrixAt(i, this._dummyObj.matrix);
        continue;
      }

      p.vy += GRAVITY * 0.25 * dt;
      p.x += p.vx * dt;
      p.y = Math.max(0.06, p.y + p.vy * dt);
      p.z += (p.vz + activeScrollSpeed * 0.35) * dt;

      const lifeRatio = Math.max(0.01, p.life / p.maxLife);
      this._dummyObj.position.set(p.x, p.y, p.z);
      this._dummyObj.rotation.set(lifeRatio * 3, lifeRatio * 2, 0);
      this._dummyObj.scale.setScalar(p.scale * lifeRatio);
      this._dummyObj.updateMatrix();
      this.trailMesh.setMatrixAt(i, this._dummyObj.matrix);
      this.trailMesh.setColorAt(i, p.color);
    }
    if (anyTrailUpdated) {
      this.trailMesh.instanceMatrix.needsUpdate = true;
      if (this.trailMesh.instanceColor) {
        this.trailMesh.instanceColor.needsUpdate = true;
      }
    }

    // 4. Smooth chase camera follow + crash shake
    const targetCamX = this.dino.root.position.x * 0.48;
    const targetCamY = this.baseCameraPos.y + this.dino.root.position.y * 0.35;
    this.camera.position.x += (targetCamX - this.camera.position.x) * 0.12;
    this.camera.position.y += (targetCamY - this.camera.position.y) * 0.12;

    if (this.screenShake > 0) {
      this.screenShake = Math.max(0, this.screenShake - dt * 1.8);
      this.camera.position.x += (Math.random() - 0.5) * this.screenShake * 1.1;
      this.camera.position.y += (Math.random() - 0.5) * this.screenShake * 1.1;
    }

    this.camera.lookAt(
      this.dino.root.position.x * 0.35,
      this.cameraLookTarget.y + this.dino.root.position.y * 0.25,
      this.cameraLookTarget.z
    );
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (typeof gl.fenceSync === 'function') {
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (this.disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          this.frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          this.frameId = window.setTimeout(cb, 80);
        }
      };
      this.frameId = window.setTimeout(poll, 5);
    } else {
      gl.finish();
      this.frameId = window.setTimeout(cb, 80);
    }
  }

  private tick = (): void => {
    if (this.disposed) return;

    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, 0.05);

    if (!this.contextLost) {
      if (this.gameState !== 'PAUSED') {
        this.stepSimulation(dt);
      }
      this.renderer.render(this.scene, this.camera);
    }

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    this.sound.unlock();
    if (
      (this.gameState === 'READY' || this.gameState === 'GAMEOVER') &&
      (e.code === 'Space' || e.code === 'Enter')
    ) {
      e.preventDefault();
      this.startGame();
      return;
    }

    if (
      (this.gameState === 'PLAYING' || this.gameState === 'PAUSED') &&
      (e.code === 'Escape' || e.code === 'KeyP')
    ) {
      e.preventDefault();
      this.togglePause();
      return;
    }

    if (this.gameState !== 'PLAYING') return;

    switch (e.code) {
      case 'ArrowLeft':
      case 'KeyA':
        e.preventDefault();
        this.moveLane(-1);
        break;
      case 'ArrowRight':
      case 'KeyD':
        e.preventDefault();
        this.moveLane(1);
        break;
      case 'ArrowUp':
      case 'KeyW':
      case 'Space':
        e.preventDefault();
        this.jump();
        break;
      case 'ArrowDown':
      case 'KeyS':
        e.preventDefault();
        this.duckOrSlam();
        break;
    }
  };

  private onTouchStart = (e: TouchEvent): void => {
    this.sound.unlock();
    if (e.touches.length > 0) {
      this.touchStartX = e.touches[0].clientX;
      this.touchStartY = e.touches[0].clientY;
      this.touchHandled = false;
    }
  };

  private onTouchMove = (e: TouchEvent): void => {
    if (this.gameState !== 'PLAYING' || this.touchHandled || e.touches.length === 0) return;
    const dx = e.touches[0].clientX - this.touchStartX;
    const dy = e.touches[0].clientY - this.touchStartY;

    if (Math.abs(dx) > SWIPE_THRESHOLD || Math.abs(dy) > SWIPE_THRESHOLD) {
      this.touchHandled = true;
      if (Math.abs(dx) > Math.abs(dy)) {
        this.moveLane(dx > 0 ? 1 : -1);
      } else if (dy < 0) {
        this.jump();
      } else {
        this.duckOrSlam();
      }
    }
  };

  private onTouchEnd = (): void => {
    if (this.gameState === 'PLAYING' && !this.touchHandled) {
      this.jump();
    }
  };

  private onResize = (): void => {
    if (this.disposed) return;
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2)
    );
  };

  private onWebGLContextLost = (e: Event): void => {
    e.preventDefault();
    this.contextLost = true;
    this.callbacks.onContextLost(true);
  };

  private onWebGLContextRestored = (): void => {
    this.contextLost = false;
    this.callbacks.onContextLost(false);
  };

  private bindEvents(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('resize', this.onResize);
    const canvas = this.renderer.domElement;
    canvas.addEventListener('touchstart', this.onTouchStart, { passive: true });
    canvas.addEventListener('touchmove', this.onTouchMove, { passive: true });
    canvas.addEventListener('touchend', this.onTouchEnd, { passive: true });
    canvas.addEventListener('webglcontextlost', this.onWebGLContextLost);
    canvas.addEventListener('webglcontextrestored', this.onWebGLContextRestored);
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    window.clearTimeout(this.frameId);
    window.clearTimeout(this.gameOverTimeoutId);

    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('resize', this.onResize);
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('touchstart', this.onTouchStart);
    canvas.removeEventListener('touchmove', this.onTouchMove);
    canvas.removeEventListener('touchend', this.onTouchEnd);
    canvas.removeEventListener('webglcontextlost', this.onWebGLContextLost);
    canvas.removeEventListener('webglcontextrestored', this.onWebGLContextRestored);

    this.clearAllObstacles();
    this.clearAllCoins();
    this.clearParticles();
    this.edgeStreamMesh.dispose();
    this.trailMesh.dispose();
    this.dino.dispose();
    this.assets.dispose();
    this.sound.dispose();

    const gridMat = this.gridHelper.material as THREE.Material;
    this.gridHelper.geometry.dispose();
    gridMat.dispose();

    for (const item of this.staticDisposables) {
      item.dispose();
    }
    this.staticDisposables.length = 0;

    if (canvas.parentNode === this.container) {
      this.container.removeChild(canvas);
    }
    this.renderer.dispose();
  }
}
