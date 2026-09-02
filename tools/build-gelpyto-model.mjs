// gelpyto-model.js の生成スクリプト。
// SolidWorks 製の gelpyto_3D_mod.gltf + .bin から、簡略化・量子化した
// 埋め込み用データ（gelpyto-model.js）を作ります。モデルを更新したときに再実行してください。
//
// 手順（gelpyto_3D_mod.gltf と .bin を同じフォルダに置いて実行）:
//   npx @gltf-transform/cli@4 prune    gelpyto_3D_mod.gltf p.glb
//   npx @gltf-transform/cli@4 dedup    p.glb d.glb
//   npx @gltf-transform/cli@4 weld     d.glb w.glb
//   npx @gltf-transform/cli@4 simplify w.glb s.glb --ratio 0.02 --error 0.005
//   node build-gelpyto-model.mjs s.glb gelpyto-model.js
//
// --ratio / --error を下げるほど三角形が減ります。目・くちばしが潰れない範囲で調整してください。
import fs from 'node:fs';

const SRC = process.argv[2] || 's_0.02_0.005.glb';
const OUT = process.argv[3] || 'gelpyto-model.js';
const TARGET_HEIGHT = 0.70;
// 顔の向き。格子の立方体は軸に平行なので、90の倍数にして向きを揃えます。
// 元モデルは -X 向き。90 で +Z、180 で +X、270 で -Z を向きます。
const FACE_ANGLE_DEG = 90;

function readGlb(path) {
  const buf = fs.readFileSync(path);
  let off = 12, json = null, bin = null;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(data));
    if (type === 0x004e4942) bin = Buffer.from(data);
    off += 8 + len;
  }
  return { json, bin };
}

const COMP = { 5121: ['readUInt8', 1], 5123: ['readUInt16LE', 2], 5125: ['readUInt32LE', 4], 5126: ['readFloatLE', 4] };
const NUM = { SCALAR: 1, VEC3: 3 };

function readAccessor(json, bin, index) {
  const acc = json.accessors[index];
  const view = json.bufferViews[acc.bufferView];
  const [fn, size] = COMP[acc.componentType];
  const n = NUM[acc.type];
  const stride = view.byteStride || size * n;
  const start = (view.byteOffset || 0) + (acc.byteOffset || 0);
  const out = new Float64Array(acc.count * n);
  for (let i = 0; i < acc.count; i += 1)
    for (let c = 0; c < n; c += 1)
      out[i * n + c] = bin[fn](start + i * stride + c * size);
  return out;
}

const { json, bin } = readGlb(SRC);
const prims = json.meshes.flatMap(m => m.primitives).sort((a, b) => a.material - b.material);

const positions = [];
const normals = [];
const indices = [];
const groups = [];
let vertexBase = 0;

for (const prim of prims) {
  const pos = readAccessor(json, bin, prim.attributes.POSITION);
  const nrm = readAccessor(json, bin, prim.attributes.NORMAL);
  const idx = readAccessor(json, bin, prim.indices);
  groups.push({ start: indices.length, count: idx.length, material: prim.material });
  for (let i = 0; i < idx.length; i += 1) indices.push(vertexBase + idx[i]);
  for (let i = 0; i < pos.length; i += 1) positions.push(pos[i]);
  for (let i = 0; i < nrm.length; i += 1) normals.push(nrm[i]);
  vertexBase += pos.length / 3;
}

// SolidWorks は Z-up。(x, y, z) -> (x, z, -y) で Y-up に直し、
// そのあと Y 軸まわりに回して顔が既定カメラの方を向くようにします。
const theta = (FACE_ANGLE_DEG * Math.PI) / 180;
const cos = Math.cos(theta);
const sin = Math.sin(theta);
const rotate = (x, y, z) => {
  const ux = x, uy = z, uz = -y;
  return [ux * cos + uz * sin, uy, -ux * sin + uz * cos];
};
for (let i = 0; i < positions.length; i += 3) {
  const [x, y, z] = rotate(positions[i], positions[i + 1], positions[i + 2]);
  positions[i] = x; positions[i + 1] = y; positions[i + 2] = z;
}
for (let i = 0; i < normals.length; i += 3) {
  const [x, y, z] = rotate(normals[i], normals[i + 1], normals[i + 2]);
  normals[i] = x; normals[i + 1] = y; normals[i + 2] = z;
}

const min = [Infinity, Infinity, Infinity];
const max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < positions.length; i += 3)
  for (let c = 0; c < 3; c += 1) {
    min[c] = Math.min(min[c], positions[i + c]);
    max[c] = Math.max(max[c], positions[i + c]);
  }
const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
const center = [(max[0] + min[0]) / 2, (max[1] + min[1]) / 2, (max[2] + min[2]) / 2];
const scale = TARGET_HEIGHT / size[1];
for (let i = 0; i < positions.length; i += 3)
  for (let c = 0; c < 3; c += 1)
    positions[i + c] = (positions[i + c] - center[c]) * scale;

let extent = 0;
for (const v of positions) extent = Math.max(extent, Math.abs(v));

const posQ = new Int16Array(positions.length);
for (let i = 0; i < positions.length; i += 1) posQ[i] = Math.round((positions[i] / extent) * 32767);
const nrmQ = new Int8Array(normals.length);
let badNormals = 0;
for (let i = 0; i < normals.length; i += 3) {
  const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
  if (Math.abs(len - 1) > 0.05) badNormals += 1;
  for (let c = 0; c < 3; c += 1) nrmQ[i + c] = Math.max(-127, Math.min(127, Math.round((normals[i + c] / len) * 127)));
}
const idxQ = new Uint16Array(indices);

const b64 = arr => Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString('base64');
const model = {
  vertexCount: positions.length / 3,
  triangleCount: indices.length / 3,
  extent: Number(extent.toFixed(6)),
  height: TARGET_HEIGHT,
  groups,
  position: b64(posQ),
  normal: b64(nrmQ),
  index: b64(idxQ)
};

const body = `// ゲルぴよ 3Dモデル（エキストラの駒）
// SolidWorks 製 gelpyto_3D_mod.gltf を簡略化・量子化して埋め込んだものです。
// 元: 19,966三角形 / 877KB  ->  現在: ${model.triangleCount}三角形。
// position は Int16、normal は Int8 の正規化値。position は extent 倍して使います。
// マテリアル番号: 0=くちばし 1=目 2=体（プレイヤー色） 3=くちばしの差し色
window.GELPYTO_MODEL = ${JSON.stringify(model)};
`;
fs.writeFileSync(OUT, body);

console.log(JSON.stringify({
  source: SRC,
  vertices: model.vertexCount,
  triangles: model.triangleCount,
  groups: groups.map(g => `m${g.material}:${g.count / 3}t`),
  bboxAfterRotate: size.map(v => +v.toFixed(5)),
  scale: +scale.toFixed(3),
  extent: model.extent,
  badNormals,
  bytes: { position: posQ.byteLength, normal: nrmQ.byteLength, index: idxQ.byteLength },
  outputKB: +(fs.statSync(OUT).size / 1024).toFixed(1)
}, null, 2));
