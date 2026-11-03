import * as THREE from 'three';
import { Stick, bindSticks } from './sticks';
import { createWorld, placeTarget, makeArrow, TARGET_RADIUS, RING_SCORES } from './world';

// ---- 調整用の数値（試作で詰める） ----
const ARROWS_PER_ROUND = 5;
const GRAVITY = 9.8;
const SPEED_MIN = 18; // m/s（引き 0%）
const SPEED_MAX = 60; // m/s（引き 100%）
const MIN_DRAW = 0.2; // これ未満で離すと射たずに戻る
const YAW_RATE = THREE.MathUtils.degToRad(35); // 左の丸 左右: 度/秒
const PITCH_RATE = THREE.MathUtils.degToRad(20); // 左の丸 上下: 度/秒
const FINE_MAX = THREE.MathUtils.degToRad(6); // 右の丸の微調整の最大
const MAX_PULL = 0.4; // 弦を引く最大 (m)
const PREVIEW_RATIO = 0.4; // 軌道の点線を見せる割合
const TARGET = { distance: 30, offsetX: 10, height: 1.6 };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const world = createWorld($('game'));
const { scene, camera, renderer, archer, bowPivot, nockedArrow, string, aimLine } = world;
placeTarget(world, TARGET.distance, TARGET.offsetX, TARGET.height);

const left = new Stick($('stick-left'), 'left');
const right = new Stick($('stick-right'), 'right');
bindSticks(document.body, [left, right]);

// ---- 状態 ----
const baseYaw0 = Math.atan2(TARGET.offsetX, TARGET.distance);
const basePitch0 = THREE.MathUtils.degToRad(3);
let baseYaw = baseYaw0;
let basePitch = basePitch0;
let fineYaw = 0;
let finePitch = 0;
let draw = 0; // 0..1
let wind = 0; // 横風 m/s²（+ が右）
let arrowsLeft = ARROWS_PER_ROUND;
let total = 0;
let hits: number[] = [];
let playing = false;
let fullDrawBuzzed = false;

interface Flying {
  obj: THREE.Object3D;
  pos: THREE.Vector3; // 矢じりの位置
  vel: THREE.Vector3;
  age: number;
}
let flying: Flying | null = null;
let settleTimer = 0; // 着弾後、次を構えられるまで
const stuck: THREE.Object3D[] = [];

// ---- 方向の計算 ----
function aimDir(yaw: number, pitch: number, out = new THREE.Vector3()) {
  return out.set(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), -Math.cos(pitch) * Math.cos(yaw));
}
function launchPoint(out = new THREE.Vector3()) {
  // 弓の握りのあたり
  return out.set(0, 0, -0.55).applyMatrix4(bowPivot.matrixWorld);
}
function speedFor(d: number) {
  return SPEED_MIN + (SPEED_MAX - SPEED_MIN) * d;
}

// ---- 右の丸: 引いた反対方向へ飛ぶ ----
// 基準は「左下へ引く = 右上（的の方）へ飛ぶ」。そこからのずれを微調整に使う。
function updateFineAim() {
  const s = right.state;
  if (s.mag <= 0) return;
  const ax = -s.x;
  const ay = -s.y;
  const rx = Math.SQRT1_2;
  const ry = Math.SQRT1_2;
  let theta = Math.atan2(rx * ay - ry * ax, rx * ax + ry * ay); // 反時計回り(+)=より上
  theta = THREE.MathUtils.clamp(theta, -Math.PI / 2, Math.PI / 2);
  const t = theta / (Math.PI / 2);
  finePitch = t * FINE_MAX;
  fineYaw = -t * FINE_MAX;
}

right.onStart = () => {
  if (!canShoot()) return;
  buzz(10);
  fullDrawBuzzed = false;
};
right.onEnd = (last) => {
  if (!canShoot()) return;
  if (last.mag >= MIN_DRAW) shoot(last.mag);
  draw = 0;
  fineYaw = finePitch = 0;
};

function canShoot() {
  return playing && !flying && settleTimer <= 0 && arrowsLeft > 0;
}

function shoot(power: number) {
  archer.updateMatrixWorld(true);
  const dir = aimDir(baseYaw + fineYaw, basePitch + finePitch);
  const obj = makeArrow();
  const pos = launchPoint().addScaledVector(dir, 0.3);
  obj.position.copy(pos);
  scene.add(obj);
  flying = { obj, pos, vel: dir.multiplyScalar(speedFor(power)), age: 0 };
  arrowsLeft--;
  nockedArrow.visible = false;
  buzz(15);
  updateHud();
}

// ---- 矢の飛行と命中判定 ----
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const FWD = new THREE.Vector3(0, 0, -1);
const ARROW_LEN = 0.88;

function stepArrow(dt: number) {
  if (!flying) return;
  const f = flying;
  const sub = 4;
  const h = dt / sub;
  for (let i = 0; i < sub; i++) {
    const prev = tmpA.copy(f.pos);
    f.vel.x += wind * h;
    f.vel.y -= GRAVITY * h;
    f.pos.addScaledVector(f.vel, h);
    f.age += h;

    // 的の面を横切ったか
    const n = world.targetNormal;
    const d0 = tmpB.copy(prev).sub(world.targetCenter).dot(n);
    const d1 = tmpB.copy(f.pos).sub(world.targetCenter).dot(n);
    if (d0 > 0 && d1 <= 0) {
      const t = d0 / (d0 - d1);
      const hit = prev.clone().lerp(f.pos, t);
      const r = hit.distanceTo(world.targetCenter);
      if (r <= TARGET_RADIUS + 0.08) {
        const ring = Math.floor(r / (TARGET_RADIUS / RING_SCORES.length));
        const score = ring < RING_SCORES.length ? RING_SCORES[ring] : 0;
        f.pos.copy(hit).addScaledVector(f.vel.clone().normalize(), 0.12); // 少し刺さる
        land(score, true);
        return;
      }
    }
    if (f.pos.y <= 0.02) {
      f.pos.y = 0.02;
      land(0, false);
      return;
    }
    if (f.age > 5) {
      land(0, false);
      return;
    }
  }
  orientArrow(f);
}

function orientArrow(f: Flying) {
  const dir = tmpA.copy(f.vel).normalize();
  f.obj.quaternion.setFromUnitVectors(FWD, dir);
  // obj の原点は矢の後端なので、矢じりの位置から戻す
  f.obj.position.copy(f.pos).addScaledVector(dir, -ARROW_LEN);
}

function land(score: number, onTarget: boolean) {
  if (!flying) return;
  orientArrow(flying);
  stuck.push(flying.obj);
  flying = null;
  settleTimer = 1.1;
  total += score;
  hits.push(score);
  if (onTarget && score > 0) {
    popup(score === 10 ? 'ど真ん中! 10点' : `${score}点`, score === 10);
    buzz(score === 10 ? [30, 40, 60] : 35);
  } else {
    popup(onTarget ? 'ふち 0点' : 'はずれ', false);
  }
  updateHud();
}

// ---- 軌道の点線 ----
const previewPts: THREE.Vector3[] = [];
function updatePreview() {
  if (draw <= 0 || !canShoot()) {
    aimLine.visible = false;
    return;
  }
  archer.updateMatrixWorld(true);
  const p = launchPoint(new THREE.Vector3());
  const v = aimDir(baseYaw + fineYaw, basePitch + finePitch).multiplyScalar(speedFor(draw));
  const pts: THREE.Vector3[] = [];
  const h = 1 / 60;
  for (let i = 0; i < 300 && p.y > 0; i++) {
    pts.push(p.clone());
    v.y -= GRAVITY * h;
    p.addScaledVector(v, h);
  }
  previewPts.length = 0;
  const n = Math.max(2, Math.floor(pts.length * PREVIEW_RATIO));
  for (let i = 0; i < n; i++) previewPts.push(pts[i]);
  aimLine.geometry.dispose();
  aimLine.geometry = new THREE.BufferGeometry().setFromPoints(previewPts);
  aimLine.computeLineDistances();
  aimLine.visible = true;
}

// ---- 毎フレーム ----
const lookNow = world.cameraHome.look.clone();
const lookGoal = new THREE.Vector3();
let last = performance.now();
let fps = 60;

function frame(now: number) {
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  fps = fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;

  if (playing) {
    // 左の丸: 向き（左右）と弓の角度（上下）。離すとそのまま保持
    baseYaw += left.state.x * YAW_RATE * dt;
    basePitch += left.state.y * PITCH_RATE * dt;
    baseYaw = THREE.MathUtils.clamp(baseYaw, baseYaw0 - 1.0, baseYaw0 + 1.0);
    basePitch = THREE.MathUtils.clamp(basePitch, THREE.MathUtils.degToRad(-10), THREE.MathUtils.degToRad(45));

    if (right.state.active && canShoot()) {
      draw = right.state.mag;
      updateFineAim();
      if (draw >= 0.999 && !fullDrawBuzzed) {
        fullDrawBuzzed = true;
        buzz(20);
      }
    } else if (!right.state.active) {
      draw = 0;
    }
  }

  // 見た目に反映
  archer.rotation.y = -(baseYaw + fineYaw);
  bowPivot.rotation.x = basePitch + finePitch;
  const pull = draw * MAX_PULL;
  const restZ = string.userData.restZ as number;
  const sp = string.geometry.attributes.position as THREE.BufferAttribute;
  sp.setZ(1, restZ + pull);
  sp.needsUpdate = true;
  nockedArrow.position.z = restZ + pull;
  if (!flying && settleTimer <= 0 && arrowsLeft > 0) nockedArrow.visible = true;

  stepArrow(dt);
  updatePreview();

  if (settleTimer > 0) {
    settleTimer -= dt;
    if (settleTimer <= 0 && arrowsLeft === 0) showResult();
  }

  // カメラ: 矢を少し追う
  if (flying) lookGoal.copy(world.cameraHome.look).lerp(flying.pos, 0.35);
  else if (settleTimer > 0.4 && stuck.length) lookGoal.copy(world.cameraHome.look).lerp(stuck[stuck.length - 1].position, 0.35);
  else lookGoal.copy(world.cameraHome.look);
  lookNow.lerp(lookGoal, 1 - Math.exp(-dt * 4));
  camera.lookAt(lookNow);

  renderer.render(scene, camera);
  if (!debugEl.hidden) updateDebug();
  requestAnimationFrame(frame);
}

// ---- HUD ----
const debugEl = $('debug');
function updateHud() {
  $('arrows-left').textContent = '●'.repeat(arrowsLeft) + '○'.repeat(ARROWS_PER_ROUND - arrowsLeft);
  $('total').textContent = String(total);
  const w = Math.abs(wind);
  $('wind').textContent = w < 0.05 ? 'なし' : `${wind > 0 ? '→' : '←'} ${w.toFixed(1)}`;
  $('dist').textContent = `${TARGET.distance}m`;
}
function updateDebug() {
  const deg = THREE.MathUtils.radToDeg;
  debugEl.textContent =
    `左  x ${fmt(left.state.x)}  y ${fmt(left.state.y)}\n` +
    `右  x ${fmt(right.state.x)}  y ${fmt(right.state.y)}  引き ${Math.round(draw * 100)}%\n` +
    `向き ${deg(baseYaw + fineYaw).toFixed(1)}°  角度 ${deg(basePitch + finePitch).toFixed(1)}°  ` +
    `速さ ${speedFor(draw).toFixed(0)}m/s  ${fps.toFixed(0)}fps`;
}
const fmt = (n: number) => (n >= 0 ? ' ' : '') + n.toFixed(2);

let popupTimer = 0;
function popup(text: string, gold: boolean) {
  const el = $('popup');
  el.textContent = text;
  el.classList.toggle('gold', gold);
  el.classList.add('show');
  clearTimeout(popupTimer);
  popupTimer = window.setTimeout(() => el.classList.remove('show'), 1000);
}

function buzz(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* 対応していない端末 */
  }
}

// ---- ラウンド ----
function newRound() {
  for (const o of stuck) scene.remove(o);
  stuck.length = 0;
  arrowsLeft = ARROWS_PER_ROUND;
  total = 0;
  hits = [];
  baseYaw = baseYaw0;
  basePitch = basePitch0;
  wind = Math.round((Math.random() * 3 - 1.5) * 10) / 10;
  settleTimer = 0;
  playing = true;
  $('result').hidden = true;
  updateHud();
}

function showResult() {
  playing = false;
  $('result-score').textContent = String(total);
  $('result-detail').textContent = `${hits.join(' + ')}（最高 ${ARROWS_PER_ROUND * 10} 点）`;
  $('result').hidden = false;
}

async function enterFullscreen() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
    await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape');
  } catch {
    /* 埋め込み表示などでは使えない。そのまま続ける */
  }
}

$('btn-start').addEventListener('click', () => {
  $('start').hidden = true;
  enterFullscreen();
  newRound();
});
$('btn-retry').addEventListener('click', newRound);
$('btn-debug').addEventListener('click', () => {
  debugEl.hidden = !debugEl.hidden;
});
$('btn-mode').addEventListener('click', (e) => {
  const mode = left.mode === 'fixed' ? 'floating' : 'fixed';
  left.mode = right.mode = mode;
  left.resetPosition();
  right.resetPosition();
  (e.currentTarget as HTMLElement).textContent = mode === 'fixed' ? '丸: 固定' : '丸: 触った所';
});
for (const b of document.querySelectorAll('button')) b.addEventListener('pointerdown', (e) => e.stopPropagation());

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

updateHud();
requestAnimationFrame(frame);
