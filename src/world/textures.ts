import * as THREE from 'three';

export interface PbrTextureSet {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  emissiveMap?: THREE.CanvasTexture;
}

/**
 * Generates a tangent-space normal map from a scalar height buffer (0..255).
 */
function heightToNormalTexture(
  height: Float32Array,
  size: number,
  strength: number,
  repeatX = 1,
  repeatY = 1,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const data = img.data;

  const sample = (x: number, y: number) => {
    const wx = ((x % size) + size) % size;
    const wy = ((y % size) + size) % size;
    return height[wy * size + wx];
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hL = sample(x - 1, y);
      const hR = sample(x + 1, y);
      const hU = sample(x, y - 1);
      const hD = sample(x, y + 1);

      let nx = (hL - hR) * strength;
      let ny = (hU - hD) * strength;
      let nz = 1.0;
      const invLen = 1 / Math.hypot(nx, ny, nz);
      nx *= invLen;
      ny *= invLen;
      nz *= invLen;

      const idx = (y * size + x) * 4;
      data[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 8;
  return tex;
}

function hash2(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

/**
 * Realistic asphalt road PBR set with aggregate stone grain, subtle worn tire
 * tracks (slightly glossier in roughness map), double yellow dashed centerline,
 * and crisp white edge lines.
 */
export function createAsphaltPbrSet(): PbrTextureSet {
  const size = 512;
  const diffCanvas = document.createElement('canvas');
  diffCanvas.width = size;
  diffCanvas.height = size;
  const dCtx = diffCanvas.getContext('2d')!;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d')!;

  const height = new Float32Array(size * size);

  const dImg = dCtx.createImageData(size, size);
  const rImg = rCtx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      // Tire wear tracks around lane centers (0.28 and 0.72)
      const trackL = Math.exp(-Math.pow((u - 0.27) / 0.11, 2));
      const trackR = Math.exp(-Math.pow((u - 0.73) / 0.11, 2));
      const wear = Math.max(trackL, trackR);

      const n1 = hash2(x, y);
      const n2 = hash2(Math.floor(x / 3), Math.floor(y / 3));
      const grain = (n1 * 0.65 + n2 * 0.35);

      const base = 34 + grain * 18 - wear * 6;
      const idx = (y * size + x) * 4;
      dImg.data[idx] = Math.round(base);
      dImg.data[idx + 1] = Math.round(base + 1);
      dImg.data[idx + 2] = Math.round(base + 5);
      dImg.data[idx + 3] = 255;

      // Glossier along worn tire tracks so sunset & streetlights shimmer subtly
      const roughVal = Math.round((0.88 - wear * 0.24 + (grain - 0.5) * 0.14) * 255);
      rImg.data[idx] = roughVal;
      rImg.data[idx + 1] = roughVal;
      rImg.data[idx + 2] = roughVal;
      rImg.data[idx + 3] = 255;

      height[y * size + x] = grain * 0.8 - wear * 0.12;
    }
  }
  dCtx.putImageData(dImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);

  // Subtle asphalt tar seam lines
  dCtx.strokeStyle = 'rgba(14, 16, 20, 0.5)';
  dCtx.lineWidth = 2;
  dCtx.beginPath();
  dCtx.moveTo(size * 0.5, 0);
  dCtx.lineTo(size * 0.5, size);
  dCtx.stroke();

  // Crisp weathered white shoulder markings
  dCtx.fillStyle = 'rgba(232, 237, 246, 0.86)';
  dCtx.fillRect(16, 0, 8, size);
  dCtx.fillRect(size - 24, 0, 8, size);

  // Miami double-amber centerline (dashed)
  dCtx.fillStyle = 'rgba(244, 192, 66, 0.92)';
  for (let y = 24; y < size; y += 128) {
    dCtx.fillRect(size * 0.5 - 10, y, 6, 68);
    dCtx.fillRect(size * 0.5 + 4, y, 6, 68);
  }

  // Painted markings have slightly lower roughness
  rCtx.fillStyle = 'rgb(145,145,145)';
  rCtx.fillRect(16, 0, 8, size);
  rCtx.fillRect(size - 24, 0, 8, size);

  const map = new THREE.CanvasTexture(diffCanvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = 8;

  const normalMap = heightToNormalTexture(height, size, 1.8);
  return { map, normalMap, roughnessMap };
}

/**
 * Sun-bleached Miami coastal concrete sidewalk / paver slabs with joints & micro-grain.
 */
export function createSidewalkPbrSet(): PbrTextureSet {
  const size = 256;
  const dCanvas = document.createElement('canvas');
  dCanvas.width = size;
  dCanvas.height = size;
  const dCtx = dCanvas.getContext('2d')!;

  const rCanvas = document.createElement('canvas');
  rCanvas.width = size;
  rCanvas.height = size;
  const rCtx = rCanvas.getContext('2d')!;

  const height = new Float32Array(size * size);
  const dImg = dCtx.createImageData(size, size);
  const rImg = rCtx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = x % 64;
      const gy = y % 64;
      const joint = gx < 2 || gy < 2 ? 1 : 0;
      const g = hash2(x, y) * 0.5 + hash2(Math.floor(x / 4), Math.floor(y / 4)) * 0.5;
      const tileTint = (hash2(Math.floor(x / 64), Math.floor(y / 64)) - 0.5) * 14;
      const lum = (joint ? 148 : 204 + tileTint) + (g - 0.5) * 18;

      const idx = (y * size + x) * 4;
      dImg.data[idx] = Math.round(lum);
      dImg.data[idx + 1] = Math.round(lum - 2);
      dImg.data[idx + 2] = Math.round(lum - 6);
      dImg.data[idx + 3] = 255;

      const rv = Math.round((joint ? 0.96 : 0.78 + (g - 0.5) * 0.14) * 255);
      rImg.data[idx] = rv;
      rImg.data[idx + 1] = rv;
      rImg.data[idx + 2] = rv;
      rImg.data[idx + 3] = 255;

      height[y * size + x] = joint ? 0.1 : 0.75 + g * 0.25;
    }
  }
  dCtx.putImageData(dImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);

  const map = new THREE.CanvasTexture(dCanvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(42, 42);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const roughnessMap = new THREE.CanvasTexture(rCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(42, 42);

  const normalMap = heightToNormalTexture(height, size, 2.2, 42, 42);
  return { map, normalMap, roughnessMap };
}

/**
 * Golden wind-rippled beach sand PBR textures.
 */
export function createBeachSandPbrSet(): PbrTextureSet {
  const size = 256;
  const dCanvas = document.createElement('canvas');
  dCanvas.width = size;
  dCanvas.height = size;
  const dCtx = dCanvas.getContext('2d')!;

  const rCanvas = document.createElement('canvas');
  rCanvas.width = size;
  rCanvas.height = size;
  const rCtx = rCanvas.getContext('2d')!;

  const height = new Float32Array(size * size);
  const dImg = dCtx.createImageData(size, size);
  const rImg = rCtx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ripple = Math.sin((x / size) * Math.PI * 10 + Math.sin((y / size) * Math.PI * 4) * 1.4) * 0.5 + 0.5;
      const grain = hash2(x, y);
      const hVal = ripple * 0.65 + grain * 0.35;
      height[y * size + x] = hVal;

      const idx = (y * size + x) * 4;
      dImg.data[idx] = Math.round(230 + (hVal - 0.5) * 26);
      dImg.data[idx + 1] = Math.round(201 + (hVal - 0.5) * 24);
      dImg.data[idx + 2] = Math.round(150 + (hVal - 0.5) * 22);
      dImg.data[idx + 3] = 255;

      // Occasional tiny quartz sparkle
      const rv = grain > 0.96 ? 90 : Math.round((0.86 + (grain - 0.5) * 0.1) * 255);
      rImg.data[idx] = rv;
      rImg.data[idx + 1] = rv;
      rImg.data[idx + 2] = rv;
      rImg.data[idx + 3] = 255;
    }
  }
  dCtx.putImageData(dImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);

  const map = new THREE.CanvasTexture(dCanvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(10, 48);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const roughnessMap = new THREE.CanvasTexture(rCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(10, 48);

  const normalMap = heightToNormalTexture(height, size, 1.5, 10, 48);
  return { map, normalMap, roughnessMap };
}

/**
 * Weathered coastal boardwalk / pier timber planks with wood grain & normal grooves.
 */
export function createWoodPlankPbrSet(): PbrTextureSet {
  const size = 256;
  const dCanvas = document.createElement('canvas');
  dCanvas.width = size;
  dCanvas.height = size;
  const dCtx = dCanvas.getContext('2d')!;

  const rCanvas = document.createElement('canvas');
  rCanvas.width = size;
  rCanvas.height = size;
  const rCtx = rCanvas.getContext('2d')!;

  const height = new Float32Array(size * size);
  const dImg = dCtx.createImageData(size, size);
  const rImg = rCtx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    const plankIdx = Math.floor(y / 32);
    const localY = y % 32;
    const gap = localY < 2;
    const plankTone = (hash2(plankIdx, 7) - 0.5) * 24;

    for (let x = 0; x < size; x++) {
      const fiber = Math.sin(x * 0.08 + hash2(plankIdx, Math.floor(y / 2)) * 6) * 0.5 + 0.5;
      const grain = hash2(Math.floor(x / 2), y) * 0.5 + fiber * 0.5;
      const idx = (y * size + x) * 4;
      if (gap) {
        dImg.data[idx] = 48;
        dImg.data[idx + 1] = 34;
        dImg.data[idx + 2] = 22;
        dImg.data[idx + 3] = 255;
        rImg.data[idx] = rImg.data[idx + 1] = rImg.data[idx + 2] = 245;
        rImg.data[idx + 3] = 255;
        height[y * size + x] = 0.05;
      } else {
        dImg.data[idx] = Math.round(156 + plankTone + (grain - 0.5) * 20);
        dImg.data[idx + 1] = Math.round(118 + plankTone * 0.8 + (grain - 0.5) * 16);
        dImg.data[idx + 2] = Math.round(82 + plankTone * 0.6 + (grain - 0.5) * 14);
        dImg.data[idx + 3] = 255;
        const rv = Math.round((0.78 + (grain - 0.5) * 0.16) * 255);
        rImg.data[idx] = rImg.data[idx + 1] = rImg.data[idx + 2] = rv;
        rImg.data[idx + 3] = 255;
        height[y * size + x] = 0.72 + grain * 0.25;
      }
    }
  }
  dCtx.putImageData(dImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);

  const map = new THREE.CanvasTexture(dCanvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(14, 2);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const roughnessMap = new THREE.CanvasTexture(rCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(14, 2);

  const normalMap = heightToNormalTexture(height, size, 2.4, 14, 2);
  return { map, normalMap, roughnessMap };
}

/**
 * High-detail architectural PBR facade generator with separate diffuse, roughness
 * (mirror-smooth glass vs matte mullions/stucco), normal depth, and night-lit emissive windows!
 */
export function createBuildingFacadePbr(
  baseHex: number,
  style: 'skyscraper' | 'art-deco' | 'neon-club' | 'warehouse-mural' | 'mediterranean' | 'resort-tower',
  repeatX: number,
  repeatY: number,
): PbrTextureSet {
  const size = 512;
  const dCanvas = document.createElement('canvas');
  dCanvas.width = size;
  dCanvas.height = size;
  const dCtx = dCanvas.getContext('2d')!;

  const rCanvas = document.createElement('canvas');
  rCanvas.width = size;
  rCanvas.height = size;
  const rCtx = rCanvas.getContext('2d')!;

  const eCanvas = document.createElement('canvas');
  eCanvas.width = size;
  eCanvas.height = size;
  const eCtx = eCanvas.getContext('2d')!;

  const height = new Float32Array(size * size);
  height.fill(0.78);

  const baseColor = new THREE.Color(baseHex);
  dCtx.fillStyle = `#${baseColor.getHexString()}`;
  dCtx.fillRect(0, 0, size, size);

  // Default matte roughness for concrete/stucco, black for unlit emissive
  rCtx.fillStyle = style === 'skyscraper' ? 'rgb(160,160,160)' : 'rgb(212,212,212)';
  rCtx.fillRect(0, 0, size, size);
  eCtx.fillStyle = '#000000';
  eCtx.fillRect(0, 0, size, size);

  if (style === 'skyscraper') {
    // Architectural aluminum spandrel slabs & recessed mirror-reflective glass curtain bays
    const floorH = 32;
    const bayW = 32;
    for (let y = 0; y < size; y += floorH) {
      // Floor slab horizontal spandrel
      dCtx.fillStyle = 'rgba(215, 228, 240, 0.25)';
      dCtx.fillRect(0, y, size, 7);
      rCtx.fillStyle = 'rgb(180,180,180)';
      rCtx.fillRect(0, y, size, 7);

      for (let x = 0; x < size; x += bayW) {
        const wx = x + 3;
        const wy = y + 8;
        const ww = bayW - 6;
        const wh = floorH - 10;

        // Subtle variation in interior blinds/tint
        const roomSeed = hash2(x * 0.13, y * 0.17);
        const isLit = roomSeed < 0.42;

        // Glass pane diffuse: deep coastal blue-teal reflecting sky
        const grad = dCtx.createLinearGradient(wx, wy, wx, wy + wh);
        grad.addColorStop(0, isLit ? '#4e6f88' : '#18344c');
        grad.addColorStop(1, isLit ? '#2f4c63' : '#0d2133');
        dCtx.fillStyle = grad;
        dCtx.fillRect(wx, wy, ww, wh);

        // Glass panes are super glossy (low roughness = crisp sky IBL reflection!)
        rCtx.fillStyle = 'rgb(22,22,22)';
        rCtx.fillRect(wx, wy, ww, wh);

        // Warm illuminated interior ceilings at night
        if (isLit) {
          const warm = roomSeed < 0.2 ? '#ffdfa8' : roomSeed < 0.34 ? '#ffd099' : '#c6f1ff';
          const eGrad = eCtx.createLinearGradient(wx, wy, wx, wy + wh);
          eGrad.addColorStop(0, warm);
          eGrad.addColorStop(0.55, warm);
          eGrad.addColorStop(1, '#3d2f22');
          eCtx.fillStyle = eGrad;
          eCtx.fillRect(wx + 2, wy + 2, ww - 4, wh - 4);
        }

        // Recess windows in height map so mullions catch sunlight bevels
        for (let py = wy; py < wy + wh; py++) {
          for (let px = wx; px < wx + ww; px++) {
            height[py * size + px] = 0.28;
          }
        }
      }
    }
  } else if (style === 'art-deco') {
    // Classic South Beach fluted stucco + horizontal eyebrow ledges + recessed hotel windows
    for (let y = 0; y < size; y += 64) {
      // Fluted concrete trim band
      dCtx.fillStyle = 'rgba(255, 255, 255, 0.36)';
      dCtx.fillRect(0, y, size, 8);
      dCtx.fillStyle = 'rgba(0, 0, 0, 0.12)';
      dCtx.fillRect(0, y + 8, size, 3);
      for (let py = y; py < y + 8; py++) {
        for (let px = 0; px < size; px++) height[py * size + px] = 0.96;
      }

      for (let x = 20; x < size - 20; x += 64) {
        const wy = y + 18;
        const ww = 34;
        const wh = 34;
        const seed = hash2(x * 0.2, y * 0.3);
        const lit = seed < 0.55;

        // Window frame & shadow recess
        dCtx.fillStyle = 'rgba(255,255,255,0.65)';
        dCtx.fillRect(x - 3, wy - 3, ww + 6, wh + 6);
        dCtx.fillStyle = lit ? '#6e6a68' : '#1b2c40';
        dCtx.fillRect(x, wy, ww, wh);
        // Subtle venetian blind horizontal lines
        dCtx.fillStyle = 'rgba(255,255,255,0.12)';
        for (let by = wy + 4; by < wy + wh; by += 6) {
          dCtx.fillRect(x, by, ww, 1);
        }

        // Glass window roughness
        rCtx.fillStyle = 'rgb(28,28,28)';
        rCtx.fillRect(x, wy, ww, wh);

        if (lit) {
          eCtx.fillStyle = seed < 0.3 ? '#ffe0a3' : '#ffc694';
          eCtx.fillRect(x + 2, wy + 2, ww - 4, wh - 4);
        }

        for (let py = wy; py < wy + wh; py++) {
          for (let px = x; px < x + ww; px++) height[py * size + px] = 0.2;
        }
      }
    }
  } else if (style === 'warehouse-mural') {
    // Vibrant Wynwood street-art mural brick/stucco warehouse with bold geometric pop-art & gallery doors!
    const muralPalettes = [
      ['#ff2e93', '#2cf3ff', '#ffd166', '#1b1734'],
      ['#ff6b35', '#00d2d3', '#ffe66d', '#22183b'],
      ['#9b5de5', '#f15bb5', '#00f5d4', '#161b33'],
      ['#ff4d6d', '#ffbe0b', '#3a86ff', '#141829'],
    ];
    const pal = muralPalettes[baseHex % muralPalettes.length];
    dCtx.fillStyle = pal[3];
    dCtx.fillRect(0, 0, size, size);

    // Bold diagonal color blocks & retro Miami sun-circles
    dCtx.fillStyle = pal[0];
    dCtx.beginPath();
    dCtx.moveTo(0, size * 0.25);
    dCtx.lineTo(size * 0.65, 0);
    dCtx.lineTo(size, size * 0.42);
    dCtx.lineTo(size * 0.3, size * 0.72);
    dCtx.closePath();
    dCtx.fill();

    dCtx.fillStyle = pal[1];
    dCtx.beginPath();
    dCtx.arc(size * 0.72, size * 0.34, size * 0.22, 0, Math.PI * 2);
    dCtx.fill();

    dCtx.fillStyle = pal[2];
    for (let s = 0; s < 5; s++) {
      dCtx.fillRect(28 + s * 22, size * 0.54 + s * 14, size * 0.48, 12);
    }

    // Subtle painted cinderblock mortar lines
    dCtx.strokeStyle = 'rgba(0,0,0,0.18)';
    dCtx.lineWidth = 2;
    for (let y = 0; y < size; y += 32) {
      dCtx.beginPath();
      dCtx.moveTo(0, y);
      dCtx.lineTo(size, y);
      dCtx.stroke();
    }

    // Clerestory warehouse windows near top + warm gallery glow at night
    for (let x = 24; x < size - 24; x += 76) {
      dCtx.fillStyle = '#182436';
      dCtx.fillRect(x, 22, 54, 42);
      rCtx.fillStyle = 'rgb(28,28,28)';
      rCtx.fillRect(x, 22, 54, 42);
      eCtx.fillStyle = '#ffe5ad';
      eCtx.fillRect(x + 3, 25, 48, 36);
    }
  } else if (style === 'mediterranean') {
    // Coral Heights / Little Havana warm stucco with arched windows & wrought-iron balconies
    for (let y = 0; y < size; y += 85) {
      // Decorative sandstone cornice molding
      dCtx.fillStyle = 'rgba(255, 244, 226, 0.55)';
      dCtx.fillRect(0, y, size, 9);
      for (let x = 26; x < size - 26; x += 84) {
        const wy = y + 22;
        const ww = 38;
        const wh = 48;
        const seed = hash2(x * 0.19, y * 0.27);
        const lit = seed < 0.52;

        // Cream stone arch surround
        dCtx.fillStyle = '#f5ead6';
        dCtx.fillRect(x - 4, wy + 12, ww + 8, wh - 8);
        dCtx.beginPath();
        dCtx.arc(x + ww * 0.5, wy + 14, ww * 0.5 + 4, Math.PI, 0);
        dCtx.fill();

        // Recessed arched window pane
        dCtx.fillStyle = lit ? '#6e5c4e' : '#1b2836';
        dCtx.fillRect(x, wy + 14, ww, wh - 14);
        dCtx.beginPath();
        dCtx.arc(x + ww * 0.5, wy + 14, ww * 0.5, Math.PI, 0);
        dCtx.fill();

        // Dark wrought-iron balcony railing bars across lower half
        dCtx.fillStyle = '#1d222b';
        dCtx.fillRect(x - 6, wy + wh - 16, ww + 12, 3);
        for (let bx = x - 4; bx <= x + ww + 4; bx += 7) {
          dCtx.fillRect(bx, wy + wh - 16, 2, 16);
        }

        rCtx.fillStyle = 'rgb(30,30,30)';
        rCtx.fillRect(x, wy + 4, ww, wh - 4);
        if (lit) {
          eCtx.fillStyle = '#ffd596';
          eCtx.fillRect(x + 3, wy + 10, ww - 6, wh - 24);
        }
        for (let py = wy + 6; py < wy + wh; py++) {
          for (let px = x; px < x + ww; px++) height[py * size + px] = 0.22;
        }
      }
    }
  } else if (style === 'resort-tower') {
    // Sleek North Beach white-and-turquoise oceanfront luxury condo with wide bright glass slabs
    for (let y = 0; y < size; y += 42) {
      // Bright white cantilevered concrete balcony slab edge
      dCtx.fillStyle = '#f4f7fb';
      dCtx.fillRect(0, y, size, 12);
      rCtx.fillStyle = 'rgb(165,165,165)';
      rCtx.fillRect(0, y, size, 12);
      for (let py = y; py < y + 12; py++) {
        for (let px = 0; px < size; px++) height[py * size + px] = 0.96;
      }

      // Panoramic aqua-tinted balcony railing + interior floor-to-ceiling glass
      for (let x = 0; x < size; x += 64) {
        const seed = hash2(x * 0.11, y * 0.23);
        const lit = seed < 0.45;
        const grad = dCtx.createLinearGradient(x, y + 12, x, y + 42);
        grad.addColorStop(0, lit ? '#84c9d4' : '#2a6f86');
        grad.addColorStop(1, lit ? '#498b9e' : '#18495c');
        dCtx.fillStyle = grad;
        dCtx.fillRect(x + 2, y + 12, 60, 29);
        rCtx.fillStyle = 'rgb(18,18,18)';
        rCtx.fillRect(x + 2, y + 12, 60, 29);
        if (lit) {
          eCtx.fillStyle = seed < 0.22 ? '#fff0c2' : '#c6f6ff';
          eCtx.fillRect(x + 6, y + 15, 52, 20);
        }
      }
    }
  } else {
    // Sleek dark architectural lounge/club facade with glossy glass bands & neon strips
    for (let y = 0; y < size; y += 64) {
      dCtx.fillStyle = '#111524';
      dCtx.fillRect(14, y + 18, size - 28, 30);
      rCtx.fillStyle = 'rgb(20,20,20)';
      rCtx.fillRect(14, y + 18, size - 28, 30);

      const accent = (y / 64) % 2 === 0 ? '#ff3d9a' : '#2cf3ff';
      eCtx.fillStyle = accent;
      eCtx.fillRect(18, y + 28, size - 36, 8);

      for (let py = y + 18; py < y + 48; py++) {
        for (let px = 14; px < size - 14; px++) height[py * size + px] = 0.25;
      }
    }
  }

  // Add fine architectural stucco/concrete micro-noise to height map
  for (let i = 0; i < height.length; i++) {
    const x = i % size;
    const y = (i / size) | 0;
    height[i] += (hash2(x, y) - 0.5) * 0.06;
  }

  const map = new THREE.CanvasTexture(dCanvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(repeatX, repeatY);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const roughnessMap = new THREE.CanvasTexture(rCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(repeatX, repeatY);

  const emissiveMap = new THREE.CanvasTexture(eCanvas);
  emissiveMap.wrapS = THREE.RepeatWrapping;
  emissiveMap.wrapT = THREE.RepeatWrapping;
  emissiveMap.repeat.set(repeatX, repeatY);
  emissiveMap.colorSpace = THREE.SRGBColorSpace;

  const normalMap = heightToNormalTexture(height, size, 2.2, repeatX, repeatY);

  return { map, normalMap, roughnessMap, emissiveMap };
}

/**
 * Feathered pinnate Miami palm frond alpha-cutout texture so palm trees look lush
 * and botanical instead of low-poly cones.
 */
export function createPalmFrondTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);

  // Central woody rachis stem
  const stemGrad = ctx.createLinearGradient(0, h, 0, 0);
  stemGrad.addColorStop(0, '#5a6e34');
  stemGrad.addColorStop(1, '#3b7c37');
  ctx.fillStyle = stemGrad;
  ctx.fillRect(w * 0.5 - 4, 16, 8, h - 16);

  // Draw 28 pairs of individual tapered palm leaflets fanning out
  const pairs = 28;
  for (let i = 0; i < pairs; i++) {
    const t = i / (pairs - 1); // 0 = base, 1 = tip
    const y = h - 22 - t * (h - 46);
    const envelope = Math.sin(Math.pow(t, 0.72) * Math.PI);
    const len = 18 + envelope * 108;
    const thickness = 5 + envelope * 4.5;

    for (const side of [-1, 1]) {
      const shade = 24 + Math.round((hash2(i, side + 2) - 0.5) * 26);
      const r = 34 + Math.round(t * 20) + Math.round(shade * 0.25);
      const g = 112 + Math.round(t * 36) + shade;
      const b = 46 + Math.round(t * 14);
      ctx.fillStyle = `rgb(${r},${g},${b})`;

      ctx.beginPath();
      ctx.moveTo(w * 0.5, y);
      const midX = w * 0.5 + side * len * 0.58;
      const midY = y - 14 - t * 12;
      const tipX = w * 0.5 + side * len;
      const tipY = y - 6 - t * 18 + (1 - t) * 14;
      ctx.quadraticCurveTo(midX, midY - thickness * 0.6, tipX, tipY);
      ctx.quadraticCurveTo(midX, midY + thickness * 0.65, w * 0.5, y + thickness * 0.45);
      ctx.closePath();
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Ringed fibrous palm trunk diffuse + normal textures.
 */
export function createPalmBarkPbrSet(): PbrTextureSet {
  const size = 128;
  const dCanvas = document.createElement('canvas');
  dCanvas.width = size;
  dCanvas.height = size;
  const dCtx = dCanvas.getContext('2d')!;
  const height = new Float32Array(size * size);
  const dImg = dCtx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    const ring = Math.sin((y / size) * Math.PI * 18) * 0.5 + 0.5;
    for (let x = 0; x < size; x++) {
      const n = hash2(x, y) * 0.4 + ring * 0.6;
      height[y * size + x] = n;
      const idx = (y * size + x) * 4;
      dImg.data[idx] = Math.round(115 + n * 42);
      dImg.data[idx + 1] = Math.round(96 + n * 35);
      dImg.data[idx + 2] = Math.round(78 + n * 28);
      dImg.data[idx + 3] = 255;
    }
  }
  dCtx.putImageData(dImg, 0, 0);

  const map = new THREE.CanvasTexture(dCanvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(1, 5);
  map.colorSpace = THREE.SRGBColorSpace;

  const normalMap = heightToNormalTexture(height, size, 2.5, 1, 5);
  const roughnessMap = map;
  return { map, normalMap, roughnessMap };
}

/**
 * Soft radial ground contact-shadow (ambient occlusion) texture placed beneath
 * cars and characters so they feel physically grounded on asphalt & sidewalks.
 */
export function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size * 0.5, size * 0.5, size * 0.08, size * 0.5, size * 0.5, size * 0.5);
  grad.addColorStop(0, 'rgba(5, 8, 16, 0.72)');
  grad.addColorStop(0.55, 'rgba(5, 8, 16, 0.36)');
  grad.addColorStop(1, 'rgba(5, 8, 16, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

/**
 * Soft radial smoke puff texture for tire drift smoke.
 */
export function createSmokePuffTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size * 0.5, size * 0.5, 2, size * 0.5, size * 0.5, size * 0.5);
  grad.addColorStop(0, 'rgba(235, 240, 248, 0.65)');
  grad.addColorStop(0.5, 'rgba(210, 220, 232, 0.28)');
  grad.addColorStop(1, 'rgba(200, 210, 225, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}
