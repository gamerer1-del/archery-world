// 3D空間の組み立て。Meshy の GLB が届くまでは仮の箱で作る。
// 座標: キャラが原点、前方は -Z、右は +X、上は +Y（単位はメートル）。
import * as THREE from 'three';

export const TARGET_RADIUS = 1.2;
/** 内側から 10・8・6・4・2 点 */
export const RING_SCORES = [10, 8, 6, 4, 2];
const RING_COLORS = [0xf2c230, 0xd8432f, 0x2f6fb5, 0x22282e, 0xf4f1e6];

export interface World {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  archer: THREE.Group; // 体の向き（左右）
  bowPivot: THREE.Group; // 弓の角度（上下）
  string: THREE.Line; // 弦
  nockedArrow: THREE.Object3D; // つがえている矢
  target: THREE.Group;
  targetCenter: THREE.Vector3;
  targetNormal: THREE.Vector3;
  aimLine: THREE.Line;
  cameraHome: { pos: THREE.Vector3; look: THREE.Vector3 };
}

export const BOW_HALF = 0.62; // 弓の半径（弧）

export function createWorld(container: HTMLElement): World {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9cc7e4);
  scene.fog = new THREE.Fog(0x9cc7e4, 60, 160);

  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 400);

  // 光
  scene.add(new THREE.HemisphereLight(0xdff1ff, 0x6b8f4e, 1.1));
  const sun = new THREE.DirectionalLight(0xfff3dc, 2.2);
  sun.position.set(-12, 25, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.left = -20; sc.right = 25; sc.top = 10; sc.bottom = -45; sc.far = 80;
  sun.target.position.set(5, 0, -20);
  scene.add(sun, sun.target);

  // 地面と射場
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshLambertMaterial({ color: 0x7fae5a }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const lane = new THREE.Mesh(
    new THREE.PlaneGeometry(5, 40),
    new THREE.MeshLambertMaterial({ color: 0x96bf6c }),
  );
  lane.rotation.set(-Math.PI / 2, -Math.atan2(10, 30), 0, 'YXZ');
  lane.position.set(5, 0.01, -15);
  lane.receiveShadow = true;
  scene.add(lane);

  // 背景の木（仮: 円柱と円錐）
  const rand = mulberry32(7);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5a3a });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x3f7a3c });
  for (let i = 0; i < 40; i++) {
    const x = -30 + rand() * 80;
    const z = -45 - rand() * 50;
    const s = 0.8 + rand() * 1.2;
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * s, 0.25 * s, 2 * s, 6), trunkMat);
    trunk.position.y = s;
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(1.4 * s, 3.6 * s, 7), leafMat);
    leaf.position.y = 3.4 * s;
    trunk.castShadow = leaf.castShadow = true;
    tree.add(trunk, leaf);
    tree.position.set(x, 0, z);
    scene.add(tree);
  }

  // キャラ（仮の箱）
  const archer = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x2f5d8a });
  const skinMat = new THREE.MeshLambertMaterial({ color: 0xf0c8a0 });
  const legMat = new THREE.MeshLambertMaterial({ color: 0x3a3330 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.3), bodyMat);
  body.position.y = 1.2;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.3), skinMat);
  head.position.y = 1.78;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.82, 0.2), legMat);
  legL.position.set(-0.12, 0.41, 0);
  const legR = legL.clone();
  legR.position.x = 0.12;
  for (const m of [body, head, legL, legR]) m.castShadow = true;
  archer.add(body, head, legL, legR);

  // 弓（上下に傾くピボット）
  const bowPivot = new THREE.Group();
  bowPivot.position.set(0.05, 1.42, 0);
  archer.add(bowPivot);

  const bowWood = new THREE.MeshLambertMaterial({ color: 0x8b4a24 });
  const bowArc = 0.8 * Math.PI;
  const bowGeo = new THREE.TorusGeometry(BOW_HALF, 0.025, 6, 24, bowArc);
  bowGeo.rotateZ(-bowArc / 2); // 弧の中心を +X に
  bowGeo.rotateY(Math.PI / 2); // +X → -Z（前方へふくらむ）
  const bow = new THREE.Mesh(bowGeo, bowWood);
  bow.castShadow = true;
  // 弓の握りがキャラの前 0.55m に来るように
  const bowOffsetZ = -0.55 + BOW_HALF;
  bow.position.z = bowOffsetZ;
  bowPivot.add(bow);

  const tipY = BOW_HALF * Math.sin(bowArc / 2);
  const tipZ = bowOffsetZ - BOW_HALF * Math.cos(bowArc / 2);
  const stringGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, tipY, tipZ),
    new THREE.Vector3(0, 0, tipZ),
    new THREE.Vector3(0, -tipY, tipZ),
  ]);
  const string = new THREE.Line(stringGeo, new THREE.LineBasicMaterial({ color: 0xf5f5f5 }));
  string.userData.restZ = tipZ;
  bowPivot.add(string);

  const nockedArrow = makeArrow();
  nockedArrow.userData.restZ = tipZ;
  nockedArrow.position.z = tipZ;
  bowPivot.add(nockedArrow);

  archer.position.set(0, 0, 0);
  scene.add(archer);

  // 的（スタンド付き）。距離はステージで変える
  const target = new THREE.Group();
  const face = new THREE.Group();
  RING_SCORES.forEach((_, i) => {
    const inner = (TARGET_RADIUS / RING_SCORES.length) * i;
    const outer = (TARGET_RADIUS / RING_SCORES.length) * (i + 1);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(inner, outer, 48),
      new THREE.MeshLambertMaterial({ color: RING_COLORS[i] }),
    );
    ring.position.z = 0.06 + 0.001 * (RING_SCORES.length - i);
    face.add(ring);
  });
  const backing = new THREE.Mesh(
    new THREE.CylinderGeometry(TARGET_RADIUS + 0.08, TARGET_RADIUS + 0.08, 0.12, 48),
    new THREE.MeshLambertMaterial({ color: 0xd9c49a }),
  );
  backing.rotation.x = Math.PI / 2;
  backing.castShadow = true;
  face.add(backing);
  target.add(face);
  const legMatT = new THREE.MeshLambertMaterial({ color: 0x6d4c2e });
  for (const sx of [-0.7, 0.7]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3.4, 0.1), legMatT);
    leg.position.set(sx, -1.1, -0.25);
    leg.rotation.x = -0.15;
    leg.castShadow = true;
    target.add(leg);
  }
  scene.add(target);

  // 狙いの点線
  const aimLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.35, gapSize: 0.25, transparent: true, opacity: 0.9 }),
  );
  aimLine.visible = false;
  aimLine.frustumCulled = false;
  scene.add(aimLine);

  // カメラ: キャラの斜め後ろ。キャラが左下、的が右上に見える
  const cameraHome = { pos: new THREE.Vector3(2, 2.25, 4.5), look: new THREE.Vector3(-0.5, -2, -25) };
  camera.position.copy(cameraHome.pos);
  camera.lookAt(cameraHome.look);

  return {
    scene, camera, renderer, archer, bowPivot, string, nockedArrow, target,
    targetCenter: new THREE.Vector3(), targetNormal: new THREE.Vector3(), aimLine, cameraHome,
  };
}

/** 的を置く（距離 m、左右のずれ m、中心の高さ m） */
export function placeTarget(w: World, distance: number, offsetX: number, height: number) {
  w.target.position.set(offsetX, height, -distance);
  w.target.lookAt(0, height, 0);
  w.target.updateMatrixWorld();
  w.targetCenter.copy(w.target.position);
  w.targetNormal.set(0, 0, 1).applyQuaternion(w.target.quaternion);
}

/** 矢の形（+Z 方向が後ろ、-Z 方向が矢じり）。長さ 0.8m */
export function makeArrow(): THREE.Group {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.8, 5).rotateX(Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0xc9a46a }),
  );
  shaft.position.z = -0.4;
  const head = new THREE.Mesh(
    new THREE.ConeGeometry(0.03, 0.09, 6).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0x555b60 }),
  );
  head.position.z = -0.84;
  const fletchMat = new THREE.MeshLambertMaterial({ color: 0xd8432f, side: THREE.DoubleSide });
  for (let i = 0; i < 3; i++) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.13), fletchMat);
    f.rotation.x = Math.PI / 2;
    f.position.z = -0.08;
    const holder = new THREE.Group();
    holder.add(f);
    f.position.x = 0.03;
    holder.rotation.z = (i * Math.PI * 2) / 3;
    g.add(holder);
  }
  g.add(shaft, head);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
