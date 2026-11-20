import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

export interface LoadedPbrTextures {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

export interface HdriPair {
  env: THREE.Texture;
  bg: THREE.Texture;
}

export interface LoadedHdriSet {
  sunset: HdriPair;
  midday: HdriPair;
  night: HdriPair;
}

export interface ClonedPerson {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

export interface LoadedGameAssets {
  ferrariGltf: GLTF | null;
  protagonistGltf: GLTF | null;
  pedestrianGltfs: GLTF[];
  mocapClips: THREE.AnimationClip[];
  hdris: Partial<LoadedHdriSet>;
  textures: {
    asphalt?: LoadedPbrTextures;
    sand?: LoadedPbrTextures;
    wood?: LoadedPbrTextures;
    concrete?: LoadedPbrTextures;
  };
  cloneProtagonist: () => ClonedPerson | null;
  clonePedestrian: (variantIndex?: number) => ClonedPerson | null;
  cloneFerrari: () => THREE.Group | null;
}

function loadTexture(
  loader: THREE.TextureLoader,
  url: string,
  srgb: boolean,
  repeatX = 1,
  repeatY = 1,
): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (tex) => {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(repeatX, repeatY);
        tex.anisotropy = 8;
        if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
        resolve(tex);
      },
      undefined,
      reject,
    );
  });
}

async function loadPbrSet(
  loader: THREE.TextureLoader,
  prefix: string,
  repeatX = 1,
  repeatY = 1,
): Promise<LoadedPbrTextures | undefined> {
  try {
    const [map, normalMap, roughnessMap] = await Promise.all([
      loadTexture(loader, `/assets/textures/${prefix}_diff.jpg`, true, repeatX, repeatY),
      loadTexture(loader, `/assets/textures/${prefix}_nor.jpg`, false, repeatX, repeatY),
      loadTexture(loader, `/assets/textures/${prefix}_rough.jpg`, false, repeatX, repeatY),
    ]);
    return { map, normalMap, roughnessMap };
  } catch (err) {
    console.warn(`[SolCoast] Could not load PBR texture set "${prefix}", keeping procedural fallback.`, err);
    return undefined;
  }
}

function loadHdri(
  rgbe: RGBELoader,
  pmrem: THREE.PMREMGenerator,
  url: string,
): Promise<HdriPair | undefined> {
  return new Promise((resolve) => {
    rgbe.load(
      url,
      (dataTex) => {
        dataTex.mapping = THREE.EquirectangularReflectionMapping;
        dataTex.minFilter = THREE.LinearFilter;
        dataTex.magFilter = THREE.LinearFilter;
        const envTex = pmrem.fromEquirectangular(dataTex).texture;
        resolve({ env: envTex, bg: dataTex });
      },
      undefined,
      (err) => {
        console.warn(`[SolCoast] Could not load HDRI ${url}, keeping procedural sky IBL.`, err);
        resolve(undefined);
      },
    );
  });
}

/**
 * Customizes our exclusive street-tough protagonist (`avatar_5.glb`) with
 * matte-black streetwear styling, glossy wrap-around dark shades mounted to the
 * Head bone, and a gleaming gold Cuban link chain + pendant mounted to Spine2.
 */
function equipProtagonistStreetGear(avatarRoot: THREE.Object3D): void {
  // Deepen streetwear black tank & distressed jeans to stealth matte black
  avatarRoot.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (/outfit_top/i.test(obj.name) && obj.material instanceof THREE.MeshStandardMaterial) {
      const mat = obj.material.clone();
      mat.color.setHex(0x282b34);
      mat.roughness = 0.85;
      obj.material = mat;
    }
  });

  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xffca4b,
    metalness: 0.96,
    roughness: 0.16,
  });
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x10131a,
    metalness: 0.7,
    roughness: 0.22,
  });
  const lensMat = new THREE.MeshPhysicalMaterial({
    color: 0x05080f,
    metalness: 0.35,
    roughness: 0.04,
    clearcoat: 1.0,
    envMapIntensity: 2.2,
  });

  // 1. Dark street shades parented directly to the Head bone (eyes at y=+0.088, z=+0.083)
  const headBone = avatarRoot.getObjectByName('Head');
  if (headBone) {
    const shades = new THREE.Group();
    shades.name = 'StreetShades';
    shades.position.set(0, 0.088, 0.104);

    for (const side of [-1, 1]) {
      const lens = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.032, 0.01), lensMat);
      lens.position.set(side * 0.034, 0, 0);
      lens.rotation.y = side * -0.14;
      shades.add(lens);

      const rim = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.036, 0.008), frameMat);
      rim.position.set(side * 0.034, 0, -0.002);
      rim.rotation.y = side * -0.14;
      shades.add(rim);

      const temple = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.01, 0.115), frameMat);
      temple.position.set(side * 0.066, 0.004, -0.054);
      shades.add(temple);
    }

    const browBar = new THREE.Mesh(new THREE.BoxGeometry(0.126, 0.007, 0.01), goldMat);
    browBar.position.set(0, 0.016, 0.002);
    shades.add(browBar);

    headBone.add(shades);
  }

  // 2. Heavy gleaming gold Cuban link chain + medallion parented to Spine2 bone
  const chestBone = avatarRoot.getObjectByName('Spine2');
  if (chestBone) {
    const chainGroup = new THREE.Group();
    chainGroup.name = 'GoldCubanChain';
    chainGroup.position.set(0, 0.135, 0.048);
    chainGroup.rotation.x = 0.72;

    const chain = new THREE.Mesh(new THREE.TorusGeometry(0.088, 0.0095, 10, 28), goldMat);
    chain.scale.set(0.95, 1.24, 1.0);
    chainGroup.add(chain);

    const pendant = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.006, 14), goldMat);
    pendant.rotation.x = Math.PI * 0.5;
    pendant.position.set(0, -0.112, 0.006);
    chainGroup.add(pendant);

    chestBone.add(chainGroup);
  }
}

/**
 * Loads artist-authored GLB models:
 * - Ferrari 458 supercar
 * - Exclusive street-tough protagonist (`avatar_5.glb` + street shades & gold chain)
 * - 6 distinct civilian pedestrian avatars (`avatar_1, 2, 3, 4, 6, 7`)
 * - Studio optical mocap animations (Idle, Walk, Run, Jump)
 * - Poly Haven Pure Sky CC0 HDRIs & photographic CC0 PBR textures
 */
export async function loadGameAssets(renderer: THREE.WebGLRenderer): Promise<LoadedGameAssets> {
  const gltfLoader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath('/draco/');
  gltfLoader.setDRACOLoader(dracoLoader);

  const rgbeLoader = new RGBELoader();
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const texLoader = new THREE.TextureLoader();

  const loadGltfSafe = (url: string): Promise<GLTF | null> =>
    new Promise((resolve) => {
      gltfLoader.load(
        url,
        (gltf) => resolve(gltf),
        undefined,
        (err) => {
          console.warn(`[SolCoast] Could not load GLB ${url}, using fallback.`, err);
          resolve(null);
        },
      );
    });

  const [
    ferrariGltf,
    protagonistGltf,
    av1,
    av2,
    av3,
    av4,
    av6,
    av7,
    animIdle,
    animWalk,
    animRun,
    animJump,
    sunset,
    midday,
    night,
    asphalt,
    sand,
    wood,
    concrete,
  ] = await Promise.all([
    loadGltfSafe('/assets/models/ferrari.glb'),
    loadGltfSafe('/assets/models/avatar_5.glb'), // Exclusive street-tough protagonist!
    loadGltfSafe('/assets/models/avatar_1.glb'),
    loadGltfSafe('/assets/models/avatar_2.glb'),
    loadGltfSafe('/assets/models/avatar_3.glb'),
    loadGltfSafe('/assets/models/avatar_4.glb'),
    loadGltfSafe('/assets/models/avatar_6.glb'),
    loadGltfSafe('/assets/models/avatar_7.glb'),
    loadGltfSafe('/assets/animations/anim_idle.glb'),
    loadGltfSafe('/assets/animations/anim_walk.glb'),
    loadGltfSafe('/assets/animations/anim_run.glb'),
    loadGltfSafe('/assets/animations/anim_jump.glb'),
    loadHdri(rgbeLoader, pmrem, '/assets/hdri/sunset.hdr'),
    loadHdri(rgbeLoader, pmrem, '/assets/hdri/midday.hdr'),
    loadHdri(rgbeLoader, pmrem, '/assets/hdri/night.hdr'),
    loadPbrSet(texLoader, 'asphalt', 1, 1),
    loadPbrSet(texLoader, 'sand', 10, 48),
    loadPbrSet(texLoader, 'wood', 14, 2),
    loadPbrSet(texLoader, 'concrete', 42, 42),
  ]);

  pmrem.dispose();
  dracoLoader.dispose();

  const pedestrianGltfs = [av1, av2, av3, av4, av6, av7].filter((g): g is GLTF => g !== null);

  const mocapClips: THREE.AnimationClip[] = [];
  const pushClip = (gltf: GLTF | null, canonicalName: string) => {
    const raw = gltf?.animations?.[0];
    if (!raw) return;
    const named = raw.clone();
    named.name = canonicalName;
    mocapClips.push(named);
  };
  pushClip(animIdle, 'Idle');
  pushClip(animWalk, 'Walk');
  pushClip(animRun, 'Run');
  pushClip(animJump, 'Jump');

  const prepareAvatar = (gltf: GLTF, isProtagonist: boolean): ClonedPerson => {
    const cloned = SkeletonUtils.clone(gltf.scene);
    cloned.rotation.y = Math.PI; // Native +Z -> -Z forward
    cloned.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        if (/teeth/i.test(obj.name)) {
          obj.visible = false;
          return;
        }
        obj.castShadow = isProtagonist;
        obj.receiveShadow = false;
      }
    });
    if (isProtagonist) {
      equipProtagonistStreetGear(cloned);
    }
    return { scene: cloned, animations: mocapClips };
  };

  return {
    ferrariGltf,
    protagonistGltf,
    pedestrianGltfs,
    mocapClips,
    hdris: {
      ...(sunset ? { sunset } : {}),
      ...(midday ? { midday } : {}),
      ...(night ? { night } : {}),
    },
    textures: {
      asphalt,
      sand,
      wood,
      concrete,
    },
    cloneProtagonist() {
      const src = protagonistGltf ?? pedestrianGltfs[0];
      if (!src || mocapClips.length === 0) return null;
      return prepareAvatar(src, true);
    },
    clonePedestrian(variantIndex = 0) {
      if (pedestrianGltfs.length === 0 || mocapClips.length === 0) return null;
      const gltf =
        pedestrianGltfs[((variantIndex % pedestrianGltfs.length) + pedestrianGltfs.length) % pedestrianGltfs.length];
      return prepareAvatar(gltf, false);
    },
    cloneFerrari() {
      if (!ferrariGltf) return null;
      return ferrariGltf.scene.clone(true);
    },
  };
}
