// Web版のデータを Godot版（godot/）が読む JSON に書き出します。
// map.js（イベントマップ）や gelpyto-model.js（3D駒のモデル）を更新したら、作業フォルダで次を実行してください。
//   node tools/export-godot-data.cjs
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'godot', 'data');

function evaluate(file) {
    const sandbox = {};
    sandbox.window = sandbox;
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), vm.createContext(sandbox), { filename: file });
    return sandbox;
}

function exportMaps() {
    const data = evaluate('map.js');
    const maps = (Array.isArray(data.EVENT_MAPS) ? data.EVENT_MAPS : []).filter(map => map && Array.isArray(map.cells));
    const out = {
        simple_background: typeof data.SIMPLE_BOARD_BACKGROUND === 'string' ? data.SIMPLE_BOARD_BACKGROUND : '',
        event_maps: maps.map((map, index) => ({
            name: (typeof map.name === 'string' && map.name.trim()) || `イベント${index + 1}`,
            background: typeof map.background === 'string' ? map.background : '',
            cells: map.cells.map(row => row.map(value => String(value || '')))
        }))
    };
    return out;
}

function exportModel() {
    const data = evaluate('gelpyto-model.js');
    const model = data.GELPYTO_MODEL;
    if (!model) throw new Error('gelpyto-model.js から GELPYTO_MODEL を読み込めませんでした。');
    return model;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const maps = exportMaps();
fs.writeFileSync(path.join(OUT_DIR, 'event_maps.json'), JSON.stringify(maps, null, 1) + '\n', 'utf8');
const model = exportModel();
fs.writeFileSync(path.join(OUT_DIR, 'gelpyto_model.json'), JSON.stringify(model) + '\n', 'utf8');
console.log(`event_maps.json: ${maps.event_maps.length} マップ（${maps.event_maps.map(m => m.name).join('、')}）`);
console.log(`gelpyto_model.json: ${model.triangleCount} 三角形`);
