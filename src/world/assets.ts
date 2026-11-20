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

export interface LoadedHdriSet {
  sunset: THREE.Texture;
  midday: THREE.Texture;
  night: THREE.Texture;
}

export interface LoadedGameAssets {
  ferrariGltf: GLTF | null;
  characterGltf: GLTF | null;
  hdris: Partial<LoadedHdriSet>;
  textures: {
    asphalt?: LoadedPbrTextures;
    sand?: LoadedPbrTextures;
    wood?: LoadedPbrTextures;
    concrete?: LoadedPbrTextures;
  };
  cloneCharacter: () => { scene: THREE.Object3D; animations: THREE.AnimationClip[] } | null;
  cloneFerrari: () => THREE.Group | null;
}

function loadTexture(loader: THREE.TextureLoader, url: string, srgb: boolean, repeatX = 1, repeatY = 1): Promise<THREE.Texture> {
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
): Promise<THREE.Texture | undefined> {
  return new Promise((resolve) => {
    rgbe.load(
      url,
      (dataTex) => {
        dataTex.mapping = THREE.EquirectangularReflectionMapping;
        const envTex = pmrem.fromEquirectangular(dataTex).texture;
        dataTex.dispose();
        resolve(envTex);
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
 * Loads artist-authored GLB models (Draco-decoded locally from /draco/),
 * Poly Haven CC0 HDRI lighting/sky maps, and photographic CC0 PBR textures.
 * Gracefully degrades to procedural geometry/textures if any asset is unavailable.
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
          console.warn(`[SolCoast] Could not load GLB ${url}, using procedural fallback.`, err);
          resolve(null);
        },
      );
    });

  const [ferrariGltf, characterGltf, sunset, midday, night, asphalt, sand, wood, concrete] =
    await Promise.all([
      loadGltfSafe('/assets/models/ferrari.glb'),
      loadGltfSafe('/assets/models/character.glb'),
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

  return {
    ferrariGltf,
    characterGltf,
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
    cloneCharacter() {
      if (!characterGltf) return null;
      const cloned = SkeletonUtils.clone(characterGltf.scene);
      return { scene: cloned, animations: characterGltf.animations };
    },
    cloneFerrari() {
      if (!ferrariGltf) return null;
      return ferrariGltf.scene.clone(true);
    },
  };
}
