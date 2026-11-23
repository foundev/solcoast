import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

export type CarModelKind = 'ferrari' | 'spyder' | 'gt' | 'ev' | 'suv' | 'taxi' | 'coupe' | 'jdm';
export type BoatModelKind =
  | 'speedboat'
  | 'cruiser'
  | 'sailboat'
  | 'motorboat'
  | 'watertaxi'
  | 'cruiseship';

export type InteriorPropKind =
  | 'sofa_luxury'
  | 'sofa_club'
  | 'lounge_chair'
  | 'armchair'
  | 'bar_stool'
  | 'dining_chair'
  | 'gallery_bench'
  | 'coffee_table'
  | 'bistro_table'
  | 'dining_table'
  | 'console_table'
  | 'cabinet'
  | 'bed_suite'
  | 'display_shelves'
  | 'metal_shelves'
  | 'chandelier'
  | 'pendant_lamp'
  | 'stage_lights'
  | 'potted_plant_1'
  | 'potted_plant_2'
  | 'coffee_cart'
  | 'chalkboard'
  | 'wine_bottles'
  | 'cake_display'
  | 'boombox'
  | 'marble_bust'
  | 'bronze_shark'
  | 'grandfather_clock'
  | 'spray_paint'
  | 'ornate_mirror'
  | 'grand_piano'
  | 'art_deco_fountain'
  | 'dj_booth_rig'
  | 'espresso_machine'
  | 'pastry_display_case'
  | 'neon_sculpture_arch'
  | 'artist_easel'
  | 'neon_palm_sign'
  | 'hotel_reception_desk'
  | 'cocktail_bar_set'
  | 'fountain_plaza_grand'
  | 'fountain_spanish_courtyard'
  | 'fountain_modern_zen'
  | 'building_hotel_solaire'
  | 'building_club_neon'
  | 'building_cafe_habana'
  | 'building_wynwood_gallery'
  | 'hotel_elevator_doors'
  | 'hotel_soaking_tub'
  | 'hotel_vanity_sink'
  | 'hotel_housekeeping_cart'
  | 'hotel_luggage_cart'
  | 'hotel_room_service_cart'
  | 'hotel_toilet_bidet'
  | 'hotel_tv_minibar'
  | 'hotel_ice_machine'
  | 'prop_lifeguard_tower'
  | 'prop_beach_umbrella'
  | 'prop_beach_lounger'
  | 'prop_basketball_hoop'
  | 'prop_lighthouse_pavilion'
  | 'prop_park_bench'
  | 'prop_fire_hydrant'
  | 'prop_bougainvillea_planter'
  | 'prop_sidewalk_cafe'
  | 'prop_street_lamp'
  | 'prop_traffic_signal'
  | 'prop_bollard';

export type NpcUniformKind = 'concierge' | 'bellhop' | 'maid' | 'bartender' | 'waiter' | 'security';

export const INTERIOR_PROP_KINDS: InteriorPropKind[] = [
  'sofa_luxury',
  'sofa_club',
  'lounge_chair',
  'armchair',
  'bar_stool',
  'dining_chair',
  'gallery_bench',
  'coffee_table',
  'bistro_table',
  'dining_table',
  'console_table',
  'cabinet',
  'bed_suite',
  'display_shelves',
  'metal_shelves',
  'chandelier',
  'pendant_lamp',
  'stage_lights',
  'potted_plant_1',
  'potted_plant_2',
  'coffee_cart',
  'chalkboard',
  'wine_bottles',
  'cake_display',
  'boombox',
  'marble_bust',
  'bronze_shark',
  'grandfather_clock',
  'spray_paint',
  'ornate_mirror',
  'grand_piano',
  'art_deco_fountain',
  'dj_booth_rig',
  'espresso_machine',
  'pastry_display_case',
  'neon_sculpture_arch',
  'artist_easel',
  'neon_palm_sign',
  'hotel_reception_desk',
  'cocktail_bar_set',
  'fountain_plaza_grand',
  'fountain_spanish_courtyard',
  'fountain_modern_zen',
  'building_hotel_solaire',
  'building_club_neon',
  'building_cafe_habana',
  'building_wynwood_gallery',
  'hotel_elevator_doors',
  'hotel_soaking_tub',
  'hotel_vanity_sink',
  'hotel_housekeeping_cart',
  'hotel_luggage_cart',
  'hotel_room_service_cart',
  'hotel_toilet_bidet',
  'hotel_tv_minibar',
  'hotel_ice_machine',
  'prop_lifeguard_tower',
  'prop_beach_umbrella',
  'prop_beach_lounger',
  'prop_basketball_hoop',
  'prop_lighthouse_pavilion',
  'prop_park_bench',
  'prop_fire_hydrant',
  'prop_bougainvillea_planter',
  'prop_sidewalk_cafe',
  'prop_street_lamp',
  'prop_traffic_signal',
  'prop_bollard',
];

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
  preferredWalkClip?: string;
}

export interface LoadedGameAssets {
  ferrariGltf: GLTF | null;
  carGltfs: Partial<Record<CarModelKind, GLTF>>;
  boatGltfs: Partial<Record<BoatModelKind, GLTF>>;
  protagonistGltf: GLTF | null;
  pedestrianGltfs: GLTF[];
  staffGltfs: Partial<Record<NpcUniformKind, GLTF>>;
  mocapClips: THREE.AnimationClip[];
  hdris: Partial<LoadedHdriSet>;
  textures: {
    asphalt?: LoadedPbrTextures;
    sand?: LoadedPbrTextures;
    wood?: LoadedPbrTextures;
    concrete?: LoadedPbrTextures;
  };
  cloneProtagonist: () => ClonedPerson | null;
  clonePedestrian: (variantIndex?: number, uniform?: NpcUniformKind) => ClonedPerson | null;
  cloneFerrari: () => THREE.Group | null;
  cloneCarModel: (kind: CarModelKind) => THREE.Group | null;
  cloneBoatModel: (kind: BoatModelKind) => THREE.Group | null;
}

// Curated Miami coastal & streetwear palettes to give 50+ distinct pedestrian looks
// across our 6 civilian base avatars without duplicating GPU textures or geometry!
interface PedOutfitStyle {
  topTint: number;
  bottomTint: number;
  shoeTint: number;
  accessory: 'none' | 'shades' | 'cap' | 'visor';
  capColor: number;
}

const PED_STYLES: PedOutfitStyle[] = [
  { topTint: 0xffffff, bottomTint: 0xffffff, shoeTint: 0xffffff, accessory: 'none', capColor: 0x222630 },
  { topTint: 0xff8ea8, bottomTint: 0xdbe6f4, shoeTint: 0xf4f4f4, accessory: 'shades', capColor: 0xff5e8e },
  { topTint: 0x7ef0e0, bottomTint: 0x9aa4b4, shoeTint: 0xffffff, accessory: 'cap', capColor: 0x162436 },
  { topTint: 0xffe08a, bottomTint: 0x8ea2bd, shoeTint: 0xe6e0d8, accessory: 'shades', capColor: 0x222630 },
  { topTint: 0xb0d8ff, bottomTint: 0xc2b8a8, shoeTint: 0xffffff, accessory: 'visor', capColor: 0xff6e9c },
  { topTint: 0xffb07c, bottomTint: 0x7e8a9c, shoeTint: 0xd8dce4, accessory: 'none', capColor: 0x1c2838 },
  { topTint: 0xd9b8ff, bottomTint: 0xdfe4ee, shoeTint: 0xf8f8f8, accessory: 'shades', capColor: 0x4b2ea0 },
  { topTint: 0x8be89e, bottomTint: 0x8f98a6, shoeTint: 0xffffff, accessory: 'cap', capColor: 0x0f7c78 },
  { topTint: 0xf4f6fa, bottomTint: 0x6c7c96, shoeTint: 0xffd07a, accessory: 'shades', capColor: 0xffffff },
  { topTint: 0xff7c8a, bottomTint: 0x626c7c, shoeTint: 0xe8edf5, accessory: 'none', capColor: 0xd62856 },
  { topTint: 0x66d9ff, bottomTint: 0xd0c6b6, shoeTint: 0xffffff, accessory: 'cap', capColor: 0x1a1e28 },
  { topTint: 0x9ca6b8, bottomTint: 0x747e8e, shoeTint: 0xf0f4f8, accessory: 'visor', capColor: 0x2cf3ff },
];

// Shared lightweight accessory meshes for crowd variety (reused geometry & materials)
let sharedPedAcc: {
  shadesLensGeo: THREE.BoxGeometry;
  shadesBridgeGeo: THREE.BoxGeometry;
  capCrownGeo: THREE.SphereGeometry;
  capBrimGeo: THREE.CylinderGeometry;
  lensMat: THREE.MeshPhysicalMaterial;
  frameMat: THREE.MeshStandardMaterial;
} | null = null;

function getSharedPedAccessories() {
  if (!sharedPedAcc) {
    sharedPedAcc = {
      shadesLensGeo: new THREE.BoxGeometry(0.116, 0.032, 0.014),
      shadesBridgeGeo: new THREE.BoxGeometry(0.122, 0.008, 0.012),
      capCrownGeo: new THREE.SphereGeometry(0.112, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.54),
      capBrimGeo: new THREE.CylinderGeometry(0.115, 0.115, 0.012, 10, 1, false, -Math.PI * 0.45, Math.PI * 0.9),
      lensMat: new THREE.MeshPhysicalMaterial({
        color: 0x09111c,
        metalness: 0.3,
        roughness: 0.08,
        clearcoat: 1.0,
      }),
      frameMat: new THREE.MeshStandardMaterial({
        color: 0x1c222d,
        metalness: 0.5,
        roughness: 0.35,
      }),
    };
  }
  return sharedPedAcc;
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

  // 1. Dark street shades parented directly to the Head bone
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
 * Deterministically styles a civilian pedestrian so 50+ locals across Sol Coast
 * look distinct in outfit color, height/build, and beach/streetwear accessories.
 */
function styleCivilianPedestrian(avatarRoot: THREE.Object3D, variantIndex: number): void {
  const styleIdx = Math.floor(variantIndex / 6) % PED_STYLES.length;
  const style = PED_STYLES[styleIdx];
  const hairTints = [0xffffff, 0x3b2a1e, 0xd4b27a, 0x222026, 0x8a482c, 0xc8c8ce];
  const hairTint = hairTints[(styleIdx + variantIndex) % hairTints.length];

  // Subtle realistic human height & build variation (1.66m .. 1.90m)
  const hSeed = ((variantIndex * 37) % 15) / 14; // 0..1
  const wSeed = ((variantIndex * 23) % 11) / 10; // 0..1
  const scaleY = 0.94 + hSeed * 0.12;
  const scaleXZ = 0.95 + wSeed * 0.10;
  avatarRoot.scale.set(scaleXZ, scaleY, scaleXZ);

  // Apply tasteful outfit & hair tinting when not using the base unmodified look (tier 0)
  if (styleIdx > 0) {
    avatarRoot.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh) || !(obj.material instanceof THREE.MeshStandardMaterial)) return;
      if (/outfit_top|wolf3d_outfit_top/i.test(obj.name)) {
        const m = obj.material.clone();
        m.color.setHex(style.topTint);
        obj.material = m;
      } else if (/outfit_bottom|wolf3d_outfit_bottom/i.test(obj.name)) {
        const m = obj.material.clone();
        m.color.setHex(style.bottomTint);
        obj.material = m;
      } else if (/footwear/i.test(obj.name)) {
        const m = obj.material.clone();
        m.color.setHex(style.shoeTint);
        obj.material = m;
      } else if (/hair/i.test(obj.name) && hairTint !== 0xffffff) {
        const m = obj.material.clone();
        m.color.setHex(hairTint);
        obj.material = m;
      }
    });
  }

  // Optional bone-parented Head accessories (sunglasses, cap, beach visor)
  const headBone = avatarRoot.getObjectByName('Head');
  if (headBone && style.accessory !== 'none') {
    const acc = getSharedPedAccessories();
    if (style.accessory === 'shades') {
      const shades = new THREE.Group();
      shades.position.set(0, 0.088, 0.102);
      const lens = new THREE.Mesh(acc.shadesLensGeo, acc.lensMat);
      const bridge = new THREE.Mesh(acc.shadesBridgeGeo, acc.frameMat);
      bridge.position.y = 0.014;
      shades.add(lens, bridge);
      headBone.add(shades);
    } else if (style.accessory === 'cap' || style.accessory === 'visor') {
      const capMat = new THREE.MeshStandardMaterial({ color: style.capColor, roughness: 0.72 });
      const hat = new THREE.Group();
      hat.position.set(0, 0.125, -0.005);
      if (style.accessory === 'cap') {
        const crown = new THREE.Mesh(acc.capCrownGeo, capMat);
        hat.add(crown);
      }
      const brim = new THREE.Mesh(acc.capBrimGeo, capMat);
      brim.position.set(0, 0.015, 0.068);
      brim.rotation.x = 0.12;
      hat.add(brim);
      headBone.add(hat);
    }
  }
}

/**
 * Applies authentic 5-star hotel staff uniforms & tailored suits:
 * - Strips casual streetwear diffuse/roughness textures (`map = null`) and casual glasses so NO
 *   t-shirts, hoodies, or beachwear bleed through
 * - Tailors crisp wool/cotton fabric colors onto top, trousers & polished leather dress shoes
 * - Mounts sculpted 3D suit lapels, crisp white shirt V-fronts, collars, neckties/bowties,
 *   pocket squares, gold name badges, bellhop pillbox caps, and maid aprons directly to rig bones!
 */
function styleUniformedStaff(
  avatarRoot: THREE.Object3D,
  uniform: NpcUniformKind,
  variantIndex = 0,
): void {
  const palette: Record<NpcUniformKind, { top: number; bottom: number; shoe: number }> = {
    concierge: { top: 0x162238, bottom: 0x131c2e, shoe: 0x111216 },
    bellhop: { top: 0x8e182a, bottom: 0x171922, shoe: 0x111216 },
    maid: { top: 0x1f2d42, bottom: 0x1a2638, shoe: 0x14161c },
    bartender: { top: 0x161922, bottom: 0x12141b, shoe: 0x111216 },
    waiter: { top: 0xf2f3f5, bottom: 0x14161e, shoe: 0x111216 },
    security: { top: 0x13161e, bottom: 0x10131a, shoe: 0x0f1014 },
  };
  const pal = palette[uniform];
  const hairTints = [0x231b16, 0x5c3a24, 0x9c7244, 0x1c1c22, 0x6b3522, 0x3b281c];
  const hairTint = hairTints[Math.abs(variantIndex) % hairTints.length];

  avatarRoot.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    // Hide casual streetwear glasses on uniformed staff (only security wears dark executive shades)
    if (/glasses/i.test(obj.name)) {
      obj.visible = false;
      return;
    }
    if (!(obj.material instanceof THREE.MeshStandardMaterial)) return;
    if (/hair/i.test(obj.name)) {
      const m = obj.material.clone();
      m.color.setHex(hairTint);
      obj.material = m;
    } else if (/outfit_top|wolf3d_outfit_top/i.test(obj.name)) {
      const m = obj.material.clone();
      m.map = null;
      m.roughnessMap = null;
      m.metalnessMap = null;
      m.color.setHex(pal.top);
      m.roughness = 0.72;
      m.metalness = 0.04;
      m.needsUpdate = true;
      obj.material = m;
    } else if (/outfit_bottom|wolf3d_outfit_bottom/i.test(obj.name)) {
      const m = obj.material.clone();
      m.map = null;
      m.roughnessMap = null;
      m.metalnessMap = null;
      m.color.setHex(pal.bottom);
      m.roughness = 0.76;
      m.metalness = 0.03;
      m.needsUpdate = true;
      obj.material = m;
    } else if (/footwear/i.test(obj.name)) {
      const m = obj.material.clone();
      m.map = null;
      m.roughnessMap = null;
      m.color.setHex(pal.shoe);
      m.roughness = 0.24;
      m.metalness = 0.12;
      m.needsUpdate = true;
      obj.material = m;
    }
  });

  const goldMat = new THREE.MeshStandardMaterial({ color: 0xffca4b, metalness: 0.94, roughness: 0.18 });
  const silverMat = new THREE.MeshStandardMaterial({ color: 0xd8dee6, metalness: 0.92, roughness: 0.18 });
  const whiteCloth = new THREE.MeshStandardMaterial({ color: 0xfafaf8, roughness: 0.82 });
  const crimsonCloth = new THREE.MeshStandardMaterial({ color: 0x8e182a, roughness: 0.7 });
  const navySuit = new THREE.MeshStandardMaterial({ color: 0x162238, roughness: 0.68 });
  const blackSuit = new THREE.MeshStandardMaterial({ color: 0x12141c, roughness: 0.62 });
  const burgundySilk = new THREE.MeshStandardMaterial({ color: 0x7d172b, roughness: 0.35 });

  const headBone = avatarRoot.getObjectByName('Head');
  const neckBone = avatarRoot.getObjectByName('Neck');
  const chestBone = avatarRoot.getObjectByName('Spine2');
  const waistBone = avatarRoot.getObjectByName('Spine') ?? avatarRoot.getObjectByName('Hips');

  // Helper: adds crisp white dress shirt V-placket + collar + sculpted suit lapels + pocket square!
  const addTailoredSuitFront = (
    lapelMat: THREE.Material,
    tieKind: 'necktie-burgundy' | 'necktie-black' | 'bowtie',
    withPocketSquare: boolean,
  ) => {
    if (neckBone) {
      // Crisp folded white dress shirt collar wrapping neck
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.076, 0.045, 14), whiteCloth);
      collar.position.set(0, 0.015, 0.005);
      neckBone.add(collar);
    }
    if (!chestBone) return;
    const suitFront = new THREE.Group();

    // Crisp white dress shirt V-front peeking inside the suit jacket
    const shirtFront = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.21, 0.025), whiteCloth);
    shirtFront.position.set(0, 0.115, 0.112);
    suitFront.add(shirtFront);

    // Sculpted tailored left & right suit jacket lapels framing the white shirt
    for (const side of [-1, 1]) {
      const lapel = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.23, 0.028), lapelMat);
      lapel.position.set(side * 0.062, 0.105, 0.118);
      lapel.rotation.z = side * -0.18;
      suitFront.add(lapel);
    }

    // Two subtle front jacket buttons
    for (const by of [-0.01, -0.065]) {
      const btn = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), blackSuit);
      btn.position.set(0, by, 0.126);
      suitFront.add(btn);
    }

    // Folded crisp white silk breast pocket square
    if (withPocketSquare) {
      const sq = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.016, 0.012), whiteCloth);
      sq.position.set(0.088, 0.115, 0.122);
      sq.rotation.z = 0.08;
      suitFront.add(sq);
    }

    // Silk necktie or black tuxedo bowtie
    if (tieKind === 'bowtie') {
      const bow = new THREE.Group();
      bow.position.set(0, 0.205, 0.128);
      const wingL = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.022, 0.012), blackSuit);
      wingL.position.x = -0.024;
      wingL.rotation.z = 0.16;
      const wingR = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.022, 0.012), blackSuit);
      wingR.position.x = 0.024;
      wingR.rotation.z = -0.16;
      const knot = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.016), blackSuit);
      bow.add(wingL, wingR, knot);
      suitFront.add(bow);
    } else {
      const tieMat = tieKind === 'necktie-burgundy' ? burgundySilk : blackSuit;
      const knot = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.024, 0.018), tieMat);
      knot.position.set(0, 0.202, 0.128);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.185, 0.014), tieMat);
      blade.position.set(0, 0.10, 0.127);
      suitFront.add(knot, blade);
    }

    chestBone.add(suitFront);
  };

  if (uniform === 'concierge') {
    // Crisp 5-star Navy Tailored Suit + White Collared Shirt + Burgundy Silk Tie + Gold Concierge Badge!
    addTailoredSuitFront(navySuit, 'necktie-burgundy', true);
    if (chestBone) {
      const tag = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.022, 0.01), goldMat);
      tag.position.set(-0.085, 0.118, 0.128);
      const pin = new THREE.Mesh(new THREE.SphereGeometry(0.01, 8, 6), goldMat);
      pin.position.set(0.068, 0.155, 0.13);
      chestBone.add(tag, pin);
    }
  } else if (uniform === 'bartender') {
    // Sleek Black Formal Vest/Suit + Crisp White Shirt + Black Bowtie + Silver Buttons + Black Bar Apron!
    addTailoredSuitFront(blackSuit, 'bowtie', true);
    if (chestBone) {
      for (const by of [0.04, 0.0, -0.04]) {
        const sb = new THREE.Mesh(new THREE.SphereGeometry(0.0085, 8, 6), silverMat);
        sb.position.set(0, by, 0.129);
        chestBone.add(sb);
      }
    }
    if (waistBone) {
      const bistroApron = new THREE.Mesh(
        new THREE.CylinderGeometry(0.145, 0.165, 0.42, 18, 1, false, -Math.PI * 0.42, Math.PI * 0.84),
        blackSuit,
      );
      bistroApron.position.set(0, -0.14, 0.005);
      waistBone.add(bistroApron);
    }
  } else if (uniform === 'waiter') {
    // Classic 5-Star White Tuxedo Dinner Jacket + Satin Black Lapels + Black Bowtie + Gold Service Pin!
    addTailoredSuitFront(blackSuit, 'bowtie', true);
    if (chestBone) {
      const pin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.018, 0.01), goldMat);
      pin.position.set(-0.085, 0.118, 0.128);
      chestBone.add(pin);
    }
  } else if (uniform === 'security') {
    // Executive Black Suit + White Shirt + Black Tie + Dark Security Shades + Gold Shield Badge!
    addTailoredSuitFront(blackSuit, 'necktie-black', false);
    if (headBone) {
      const acc = getSharedPedAccessories();
      const shades = new THREE.Group();
      shades.position.set(0, 0.088, 0.104);
      shades.add(new THREE.Mesh(acc.shadesLensGeo, acc.lensMat));
      headBone.add(shades);
    }
    if (chestBone) {
      const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.01, 6), goldMat);
      badge.rotation.x = Math.PI * 0.5;
      badge.position.set(-0.085, 0.12, 0.13);
      chestBone.add(badge);
    }
  } else if (uniform === 'bellhop') {
    // Classic Art Deco Crimson Bellhop Tunic + Gold Standing Collar + Brass Buttons + Pillbox Cap!
    if (headBone) {
      const cap = new THREE.Group();
      cap.position.set(0, 0.175, -0.005);
      cap.rotation.z = -0.14;
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.094, 0.085, 16), crimsonCloth);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.096, 0.096, 0.016, 16), goldMat);
      band.position.y = -0.032;
      const topTrim = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.012, 16), goldMat);
      topTrim.position.y = 0.038;
      cap.add(crown, band, topTrim);
      headBone.add(cap);
    }
    if (neckBone) {
      const standCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.08, 0.05, 14), crimsonCloth);
      standCollar.position.set(0, 0.018, 0.004);
      const collarTrim = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.01, 14), goldMat);
      collarTrim.position.set(0, 0.04, 0.004);
      neckBone.add(standCollar, collarTrim);
    }
    if (chestBone) {
      const gear = new THREE.Group();
      for (const sx of [-0.048, 0.048]) {
        for (const by of [0.01, 0.075, 0.14]) {
          const btn = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 6), goldMat);
          btn.position.set(sx, by, 0.122);
          gear.add(btn);
        }
        const ep = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.015, 0.048), goldMat);
        ep.position.set(sx * 3.1, 0.21, 0.0);
        gear.add(ep);
      }
      chestBone.add(gear);
    }
  } else if (uniform === 'maid') {
    // Classic 5-Star Housekeeping Uniform: White Peter Pan Collar + White Bib/Skirt Apron + Headband!
    if (headBone) {
      const band = new THREE.Mesh(
        new THREE.TorusGeometry(0.108, 0.016, 8, 18, Math.PI),
        whiteCloth,
      );
      band.position.set(0, 0.135, 0.01);
      band.rotation.x = -0.3;
      headBone.add(band);
    }
    if (neckBone) {
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.105, 0.032, 16), whiteCloth);
      collar.position.set(0, 0.005, 0.01);
      neckBone.add(collar);
    }
    if (waistBone) {
      const apron = new THREE.Group();
      const skirt = new THREE.Mesh(
        new THREE.CylinderGeometry(0.145, 0.185, 0.38, 20, 1, false, -Math.PI * 0.44, Math.PI * 0.88),
        whiteCloth,
      );
      skirt.position.set(0, -0.09, 0.005);
      const bib = new THREE.Mesh(
        new THREE.CylinderGeometry(0.118, 0.132, 0.19, 16, 1, false, -Math.PI * 0.28, Math.PI * 0.56),
        whiteCloth,
      );
      bib.position.set(0, 0.18, 0.008);
      const sash = new THREE.Mesh(new THREE.CylinderGeometry(0.142, 0.144, 0.036, 20), whiteCloth);
      sash.position.set(0, 0.09, 0.004);
      apron.add(skirt, bib, sash);
      waistBone.add(apron);
    }
  }
}

/**
 * Loads all artist-authored 3D GLB models:
 * - 8 distinct real 3D car models (Ferrari 458 + 7 CC0 cars: Spyder, GT, EV, SUV, Taxi, Coupe, JDM)
 * - 6 distinct real 3D boat & ship models (Speedboat, Cabin Cruiser, Sailboat, Motorboat, Water Taxi, Cruise Liner)
 * - Exclusive street-tough protagonist (`avatar_5.glb` + shades & gold Cuban chain)
 * - 6 base Ready Player Me civilian avatars generating 50+ distinct styled locals
 * - 7 studio optical mocap clips (Idle, 4 Walk variations, Run, Jump)
 * - Poly Haven Pure Sky CC0 HDRIs & photographic CC0 PBR textures
 */
export const DRACO_DECODER_PATH = '/draco/';

export async function loadGameAssets(renderer: THREE.WebGLRenderer): Promise<LoadedGameAssets> {
  const gltfLoader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
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
    carSpyder,
    carGt,
    carEv,
    carSuv,
    carTaxi,
    carCoupe,
    carJdm,
    boatSpeedboat,
    boatCruiser,
    boatSailboat,
    boatMotorboat,
    boatWatertaxi,
    boatCruiseship,
    protagonistGltf,
    av1,
    av2,
    av3,
    av4,
    av6,
    av7,
    staffConcierge,
    staffSecurity,
    staffBartender,
    staffWaiter,
    staffBellhop,
    staffMaid,
    animIdle,
    animWalk,
    animWalk2,
    animWalkF,
    animWalkF2,
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
    loadGltfSafe('/assets/models/car_spyder.glb'),
    loadGltfSafe('/assets/models/car_gt.glb'),
    loadGltfSafe('/assets/models/car_ev.glb'),
    loadGltfSafe('/assets/models/car_suv.glb'),
    loadGltfSafe('/assets/models/car_taxi.glb'),
    loadGltfSafe('/assets/models/car_coupe.glb'),
    loadGltfSafe('/assets/models/car_jdm.glb'),
    loadGltfSafe('/assets/models/boat_speedboat.glb'),
    loadGltfSafe('/assets/models/boat_cruiser.glb'),
    loadGltfSafe('/assets/models/boat_sailboat.glb'),
    loadGltfSafe('/assets/models/boat_motorboat.glb'),
    loadGltfSafe('/assets/models/boat_watertaxi.glb'),
    loadGltfSafe('/assets/models/boat_cruiseship.glb'),
    loadGltfSafe('/assets/models/avatar_5.glb'), // Exclusive street-tough protagonist!
    loadGltfSafe('/assets/models/avatar_1.glb'),
    loadGltfSafe('/assets/models/avatar_2.glb'),
    loadGltfSafe('/assets/models/avatar_3.glb'),
    loadGltfSafe('/assets/models/avatar_4.glb'),
    loadGltfSafe('/assets/models/avatar_6.glb'),
    loadGltfSafe('/assets/models/avatar_7.glb'),
    loadGltfSafe('/assets/models/staff_concierge_f.glb'),
    loadGltfSafe('/assets/models/staff_security_m.glb'),
    loadGltfSafe('/assets/models/staff_bartender_m.glb'),
    loadGltfSafe('/assets/models/staff_waiter_m.glb'),
    loadGltfSafe('/assets/models/staff_bellhop_m.glb'),
    loadGltfSafe('/assets/models/staff_maid_f.glb'),
    loadGltfSafe('/assets/animations/anim_idle.glb'),
    loadGltfSafe('/assets/animations/anim_walk.glb'),
    loadGltfSafe('/assets/animations/anim_walk2.glb'),
    loadGltfSafe('/assets/animations/anim_walk_f.glb'),
    loadGltfSafe('/assets/animations/anim_walk_f2.glb'),
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

  const carGltfs: Partial<Record<CarModelKind, GLTF>> = {};
  if (ferrariGltf) carGltfs.ferrari = ferrariGltf;
  if (carSpyder) carGltfs.spyder = carSpyder;
  if (carGt) carGltfs.gt = carGt;
  if (carEv) carGltfs.ev = carEv;
  if (carSuv) carGltfs.suv = carSuv;
  if (carTaxi) carGltfs.taxi = carTaxi;
  if (carCoupe) carGltfs.coupe = carCoupe;
  if (carJdm) carGltfs.jdm = carJdm;

  const boatGltfs: Partial<Record<BoatModelKind, GLTF>> = {};
  if (boatSpeedboat) boatGltfs.speedboat = boatSpeedboat;
  if (boatCruiser) boatGltfs.cruiser = boatCruiser;
  if (boatSailboat) boatGltfs.sailboat = boatSailboat;
  if (boatMotorboat) boatGltfs.motorboat = boatMotorboat;
  if (boatWatertaxi) boatGltfs.watertaxi = boatWatertaxi;
  if (boatCruiseship) boatGltfs.cruiseship = boatCruiseship;

  const pedestrianGltfs = [av1, av2, av3, av4, av6, av7].filter((g): g is GLTF => g !== null);
  const staffGltfs: Partial<Record<NpcUniformKind, GLTF>> = {};
  if (staffConcierge) staffGltfs.concierge = staffConcierge;
  if (staffSecurity) staffGltfs.security = staffSecurity;
  if (staffBartender) staffGltfs.bartender = staffBartender;
  if (staffWaiter) staffGltfs.waiter = staffWaiter;
  if (staffBellhop) staffGltfs.bellhop = staffBellhop;
  if (staffMaid) staffGltfs.maid = staffMaid;

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
  pushClip(animWalk2, 'Walk2');
  pushClip(animWalkF, 'WalkF');
  pushClip(animWalkF2, 'WalkF2');
  pushClip(animRun, 'Run');
  pushClip(animJump, 'Jump');

  const walkVariants = ['Walk', 'Walk2', 'WalkF', 'WalkF2'].filter((n) =>
    mocapClips.some((c) => c.name === n),
  );

  const prepareAvatar = (
    gltf: GLTF,
    isProtagonist: boolean,
    variantIndex = 0,
    uniform?: NpcUniformKind,
    isDedicatedStaffGltf = false,
  ): ClonedPerson => {
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
    } else if (isDedicatedStaffGltf) {
      // Dedicated Blender-tailored hotel staff GLB already has sculpted suit/uniform & sleeves!
      // Apply subtle natural hair-color & height variation so two concierges or maids aren't identical twins.
      const hairTints = [0xffffff, 0x4b2e1e, 0x8a5e36, 0x242024, 0x6e3a24, 0xc9a36a];
      const tint = hairTints[Math.abs(variantIndex) % hairTints.length];
      if (tint !== 0xffffff) {
        cloned.traverse((obj) => {
          if (obj instanceof THREE.Mesh && /hair/i.test(obj.name) && obj.material instanceof THREE.MeshStandardMaterial) {
            const m = obj.material.clone();
            m.color.setHex(tint);
            obj.material = m;
          }
        });
      }
      const hSeed = ((Math.abs(variantIndex) * 29) % 9) / 8;
      cloned.scale.setScalar(0.96 + hSeed * 0.06);
    } else if (uniform) {
      styleUniformedStaff(cloned, uniform, variantIndex);
    } else {
      styleCivilianPedestrian(cloned, variantIndex);
    }
    const preferredWalkClip = isProtagonist
      ? 'Walk'
      : walkVariants[variantIndex % Math.max(1, walkVariants.length)] ?? 'Walk';
    return { scene: cloned, animations: mocapClips, preferredWalkClip };
  };

  return {
    ferrariGltf,
    carGltfs,
    boatGltfs,
    protagonistGltf,
    pedestrianGltfs,
    staffGltfs,
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
      return prepareAvatar(src, true, 0);
    },
    clonePedestrian(variantIndex = 0, uniform?: NpcUniformKind) {
      if (mocapClips.length === 0) return null;
      const idx = Math.abs(variantIndex);
      if (uniform && staffGltfs[uniform]) {
        return prepareAvatar(staffGltfs[uniform]!, false, idx, uniform, true);
      }
      if (pedestrianGltfs.length === 0) return null;
      // Fallback if dedicated staff GLB is absent: NEVER pick puffer-jacket av2 or cargo av6!
      const gltf = uniform
        ? pedestrianGltfs[uniform === 'maid' ? 2 : uniform === 'concierge' ? 5 : 3] ?? pedestrianGltfs[0]
        : pedestrianGltfs[idx % pedestrianGltfs.length];
      return prepareAvatar(gltf, false, idx, uniform, false);
    },
    cloneFerrari() {
      if (!ferrariGltf) return null;
      return ferrariGltf.scene.clone(true);
    },
    cloneCarModel(kind: CarModelKind) {
      const g = carGltfs[kind];
      if (!g) return null;
      return g.scene.clone(true);
    },
    cloneBoatModel(kind: BoatModelKind) {
      const g = boatGltfs[kind];
      if (!g) return null;
      return g.scene.clone(true);
    },
  };
}

export type InteriorTextureKey =
  | 'marble'
  | 'parquet'
  | 'brick'
  | 'plaster'
  | 'terracotta'
  | 'tile_white'
  | 'concrete'
  | 'wood_panel';

export const INTERIOR_TEXTURE_KEYS: InteriorTextureKey[] = [
  'marble',
  'parquet',
  'brick',
  'plaster',
  'terracotta',
  'tile_white',
  'concrete',
  'wood_panel',
];

export type InteriorTextureMap = Partial<Record<InteriorTextureKey, LoadedPbrTextures>>;

/**
 * Loads all 8 photographic Poly Haven CC0 interior PBR texture sets (diffuse + normal + roughness)
 * so every room's floors and walls have realistic brick, marble, parquet, plaster, concrete, & tile detail.
 */
export async function loadInteriorTextures(): Promise<InteriorTextureMap> {
  const loader = new THREE.TextureLoader();
  const entries = await Promise.all(
    INTERIOR_TEXTURE_KEYS.map(async (key): Promise<[InteriorTextureKey, LoadedPbrTextures | undefined]> => {
      const set = await loadPbrSet(loader, `int_${key}`, 1, 1);
      return [key, set];
    }),
  );
  const out: InteriorTextureMap = {};
  for (const [k, v] of entries) {
    if (v) out[k] = v;
  }
  return out;
}

/**
 * Loads all 40 CC0 & custom Blender PBR interior furniture & prop GLBs in parallel
 * without blocking initial outdoor world rendering.
 */
export async function loadInteriorPropAssets(): Promise<Map<InteriorPropKind, THREE.Group>> {
  const gltfLoader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
  gltfLoader.setDRACOLoader(dracoLoader);

  const loadOne = (kind: InteriorPropKind): Promise<[InteriorPropKind, THREE.Group | null]> =>
    new Promise((resolve) => {
      gltfLoader.load(
        `/assets/props/${kind}.glb`,
        (gltf) => {
          gltf.scene.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
              obj.castShadow = false;
              obj.receiveShadow = false;
            }
          });
          resolve([kind, gltf.scene]);
        },
        undefined,
        (err) => {
          console.warn(`[SolCoast] Could not load interior prop ${kind}.glb:`, err);
          resolve([kind, null]);
        },
      );
    });

  const entries = await Promise.all(INTERIOR_PROP_KINDS.map(loadOne));
  dracoLoader.dispose();

  const map = new Map<InteriorPropKind, THREE.Group>();
  for (const [kind, scene] of entries) {
    if (scene) map.set(kind, scene);
  }
  return map;
}
